#!/usr/bin/env node
// buildFullProductionPlan() -- generates direction/editorial_blueprint.json's
// full_production.shots array from real data only: the resolved evidence
// claims (research/evidence_map.json + evidence_resolutions.json, via
// loadResolvedEvidenceMap), each claim's real spoken position located in
// voice/narration_alignment.json (the same real ASR word timestamps
// scripts/lib/orvyq-pause-resolver.mjs uses for pause anchors), and the
// resolved full-film pause windows themselves.
//
// Every second of the narration timeline is assigned to exactly one claim
// (no gaps): claim i's coverage runs from the end of claim i-1's own quoted
// excerpt to the start of claim i+1's quoted excerpt, so connective
// narration between two quoted claims stays visually attached to the
// claim that just finished speaking rather than being left unplanned.
//
// No footage is referenced here. Full-production contextual/hook footage
// has not been acquired for this project (a real, separate content gap --
// see docs/full-production-guide.md) and this script will NOT fabricate a
// footage reference to a file that does not exist (buildCanonicalEditPlan's
// pathExists check would catch that anyway). Every claim beat is rendered
// as asset_type "evidence" using a NATIVE_KINDS kind (concept_map,
// comparison, evidence_chain, boundary, source_timeline, source_article) --
// derived from that claim's own visual_treatment.{primary,secondary,metaphor}
// fields, which are real editorial content already present in the resolved
// evidence map, not invented here. Each section opens with a short graphic
// title card. This produces a schema-valid, gap-free, zero-placeholder full
// shot list; it does NOT satisfy the golden project's contextual-footage
// visual-variety requirement, which remains a genuine, separately reported
// content gap until real footage is acquired.
import path from "node:path";
import { projectDir, readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { loadResolvedEvidenceMap } from "./lib/orvyq-evidence.mjs";
import { resolveFullFilmPauses, tokenizeWords, tokenizeAnchorText, findAnchorMatch } from "./lib/orvyq-pause-resolver.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const TARGET_SHOT_SECONDS = 6;
const TITLE_CARD_SECONDS = 2.5;
const DEFAULT_FONT_PX = 32;

// Maps the editorial visual_treatment vocabulary already present in the
// resolved evidence claims onto the renderer's NATIVE_KINDS enum
// (schemas/shot.schema.json / scripts/orvyq_edit_plan.mjs). Built by hand
// from the real, exhaustive set of values in research/evidence_map.json +
// evidence_resolutions.json -- not a fuzzy keyword guess.
const KIND_BY_TREATMENT = {
  evidence_mosaic: "concept_map",
  comparison_overlay: "comparison",
  process_timeline: "source_timeline",
  document_evidence: "source_article",
  evidence_recreation: "evidence_chain",
  dual_evidence_chart: "comparison",
  threat_report_evidence: "source_article",
  campaign_phase_diagram: "evidence_chain",
  safety_level_diagram: "concept_map",
  exposure_vs_outcome: "comparison",
  evidence_comparison: "comparison",
  critical_inputs_map: "concept_map",
  two_track_policy_matrix: "comparison",
  cost_stack_diagram: "concept_map",
  balanced_tradeoff_matrix: "comparison",
  evaluation_pipeline: "evidence_chain",
  safeguard_stack: "concept_map",
  evidence_recap_montage: "source_timeline",
  evidence_chain: "evidence_chain",
  frontier_infrastructure: "concept_map",
  institutional_context: "concept_map",
  governance_context: "source_article",
  experiment_diagram: "evidence_chain",
  decision_tree: "evidence_chain",
  document_closeup: "source_article",
  dated_release_context: "source_timeline",
  attack_chain_diagram: "evidence_chain",
  reported_metric: "comparison",
  policy_document: "source_article",
  occupation_task_matrix: "comparison",
  cloud_market_evidence: "source_article",
  systemic_risk_threshold: "boundary",
  policy_context: "source_article",
  report_evidence: "source_article",
  government_methodology: "source_article",
  incident_flow: "evidence_chain",
  human_decision_context: "concept_map",
  report_frame: "source_article"
};

export function kindFor(treatmentValue) {
  return KIND_BY_TREATMENT[treatmentValue] || "boundary";
}

export function titleCase(sectionId) {
  return sectionId
    .replace(/^SEC_\d+_/, "")
    .split("_")
    .map((word) => word[0] + word.slice(1).toLowerCase())
    .join(" ");
}

const MIN_CLAIM_MATCH_RATIO = 0.4;
// Common short words are unreliable anchors for greedy in-order matching:
// "a" or "to" recurs constantly, so matching one can jump the search
// cursor to a coincidental, unrelated occurrence and strand every
// following (genuinely distinctive) claim word. These are skipped when
// locating a claim's position -- they still appear in the excerpt text
// itself, just not used to anchor its position.
const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "in", "on", "at", "and", "or", "but", "is", "it", "its",
  "this", "that", "these", "those", "they", "them", "he", "she", "we", "you", "i", "as",
  "by", "be", "been", "being", "was", "were", "are", "for", "with", "from", "not", "no",
  "so", "if", "then", "than", "into", "over", "under", "up", "down", "out", "about", "can",
  "will", "would", "could", "should", "has", "have", "had", "do", "does", "did", "may", "might"
]);

// Not every claim's narration_excerpt is a verbatim quote -- some (mostly
// the ones evidence_resolutions.json never touched) are a paraphrase of the
// real script line, sometimes with words inserted/dropped/reordered, and
// real ASR output adds its own noise on top (homophone slips like "steal"
// heard as "steel", hyphenated compounds like "high-risk" transcribed as
// two separate words, dropped suffixes like "Established" heard as
// "Establish"). An exact-substring match is tried first since it is the
// common case and gives the tightest possible span; if that fails, this
// falls back to the bag-of-words window scorer below. At least
// MIN_CLAIM_MATCH_RATIO of the claim's own significant words must be found
// in the best window, or the claim is reported as unlocatable rather than
// guessed at.
export function locateClaimWindow(tokens, claim, searchFromTokenIndex) {
  const claimTokens = tokenizeAnchorText(claim.narration_excerpt);
  if (!claimTokens.length) throw new Error(`${claim.claim_id} has an empty narration_excerpt`);

  const exactMatchIndex = findAnchorMatch(tokens, claimTokens, searchFromTokenIndex);
  if (exactMatchIndex !== -1) {
    return {
      matchStart: tokens[exactMatchIndex].start,
      matchEnd: tokens[exactMatchIndex + claimTokens.length - 1].end,
      nextSearchTokenIndex: exactMatchIndex + claimTokens.length
    };
  }

  // A strict in-order match is fragile against real ASR/paraphrase text in
  // two different ways: a common word (e.g. "capital") can coincidentally
  // match an earlier, unrelated occurrence and strand every later claim
  // word behind it; and some editorial rewrites reorder clauses entirely
  // (e.g. CLM_016 says "Compliance costs may be easier for established
  // companies to absorb" where the real line says "Established companies
  // may... be able to absorb the complex compliance... costs" -- the same
  // words, in a different order). So this scores every candidate window by
  // bag-of-words containment (order-independent, each significant claim
  // word counted at most once) and keeps the best-scoring, earliest,
  // narrowest span -- still real word-for-word evidence, just not
  // requiring the claim's exact clause order to match the spoken order.
  const significantClaimTokens = [...new Set(claimTokens.filter((token) => !STOPWORDS.has(token)))];
  const tokensToMatch = significantClaimTokens.length ? significantClaimTokens : [...new Set(claimTokens)];
  const denominator = tokensToMatch.length;
  const windowLen = Math.max(40, tokensToMatch.length * 4);
  // Bounds how far past the search cursor a fallback match may be found --
  // generous enough for the largest real gap observed between two claims
  // (a whole removed claim's connecting narration, ~140 tokens) without
  // letting the scorer wander into some unrelated later claim's territory.
  const scanLimit = Math.min(tokens.length, searchFromTokenIndex + 400);

  let best = { count: 0, score: -Infinity, firstIndex: -1, lastIndex: -1 };
  for (let start = searchFromTokenIndex; start < scanLimit; start += 1) {
    const end = Math.min(tokens.length, start + windowLen);
    const found = new Set();
    let firstIndex = -1;
    let lastIndex = -1;
    for (let i = start; i < end; i += 1) {
      if (tokensToMatch.includes(tokens[i].norm) && !found.has(tokens[i].norm)) {
        found.add(tokens[i].norm);
        if (firstIndex === -1) firstIndex = i;
        lastIndex = i;
      }
    }
    if (firstIndex === -1) continue;
    const span = lastIndex - firstIndex;
    // Score, don't just count: a raw word-count max lets a stray word that
    // coincidentally belongs to a LATER claim (found only because the
    // window reached that far) beat a tighter, more localized match with
    // one fewer word -- observed for real, where CLM_018's own excerpt
    // ("before systems ship" -- the real line says "before THEY ship")
    // could only complete its full count by reaching into CLM_019's "when
    // SYSTEMS misbehave", overshooting the cursor past CLM_019's real
    // position entirely. Subtracting the normalized span prefers a
    // slightly-lower-count but tightly-clustered real phrase instead.
    const score = found.size - (span / tokensToMatch.length) * 0.4;
    if (score > best.score) {
      best = { count: found.size, score, firstIndex, lastIndex };
      if (found.size === tokensToMatch.length && span === tokensToMatch.length - 1) break;
    }
  }

  const matchRatio = best.count / denominator;
  if (best.firstIndex === -1 || matchRatio < MIN_CLAIM_MATCH_RATIO) {
    throw new Error(
      `${claim.claim_id}'s narration_excerpt ("${claim.narration_excerpt}") could not be located in voice/narration_alignment.json ` +
        `(best in-order match found only ${Math.round(matchRatio * 100)}% of its words, need ${Math.round(MIN_CLAIM_MATCH_RATIO * 100)}%) at or after the previous claim's position -- ` +
        "claims must appear in the same order as research/evidence_map.json lists them, matching the real narration"
    );
  }
  return { matchStart: tokens[best.firstIndex].start, matchEnd: tokens[best.lastIndex].end, nextSearchTokenIndex: best.lastIndex + 1 };
}

export function sliceClaimWindow(claim, coverStart, coverEnd, maxShotSeconds) {
  const duration = coverEnd - coverStart;
  const sliceCount = Math.max(1, Math.ceil(duration / Math.min(maxShotSeconds, TARGET_SHOT_SECONDS + 2)));
  const sliceSeconds = duration / sliceCount;
  const kindRotation = [
    kindFor(claim.visual_treatment?.primary),
    kindFor(claim.visual_treatment?.secondary),
    "boundary" // claim.visual_treatment.metaphor beats are rendered as a stated-limitation/tension card
  ];
  const roleRotation = ["evidence", "context", "metaphor"];
  const slices = [];
  for (let i = 0; i < sliceCount; i += 1) {
    const start = coverStart + i * sliceSeconds;
    const end = i === sliceCount - 1 ? coverEnd : coverStart + (i + 1) * sliceSeconds;
    slices.push({ start, end, kind: kindRotation[i % kindRotation.length], role: roleRotation[i % roleRotation.length] });
  }
  return slices;
}

export async function buildFullProductionPlan(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const [blueprint, pauseMap, alignment, evidenceMap, motionHook] = await Promise.all([
    readJson(path.join(dir, "direction", "editorial_blueprint.json")),
    readJson(path.join(dir, "direction", "editorial_pause_map.json")),
    readJson(path.join(dir, "voice", "narration_alignment.json")),
    loadResolvedEvidenceMap(dir),
    readJson(path.join(dir, "direction", "motion_hook.json"))
  ]);

  const maxShotSeconds = blueprint.global_rules.max_shot_seconds;
  const validSourceIds = new Set(evidenceMap.source_catalog.map((source) => source.source_id));

  // loadResolvedEvidenceMap() appends evidence_resolutions.json's
  // claim_additions to the END of the claims array (Map insertion order),
  // regardless of which section they narratively belong to -- CLM_021 (a
  // real addition) belongs to SEC_04, well before the film's final
  // sections, but without this sort it would be located last, after the
  // forward-only cursor has already passed its real position. Sorting by
  // each claim's section's position in full_production.sections (a stable
  // sort, so claims already correctly ordered within the same section keep
  // their relative order) fixes this without needing to touch the
  // resolution-merge logic itself.
  const sectionOrder = new Map(blueprint.full_production.sections.map((section, index) => [section.section_id, index]));
  const usableClaims = evidenceMap.claims
    .filter((claim) => claim.status !== "removed")
    .map((claim, originalIndex) => ({ claim, originalIndex }))
    .sort((a, b) => {
      const sectionDelta = (sectionOrder.get(a.claim.section_id) ?? 0) - (sectionOrder.get(b.claim.section_id) ?? 0);
      return sectionDelta !== 0 ? sectionDelta : a.originalIndex - b.originalIndex;
    })
    .map(({ claim }) => claim);

  const tokens = tokenizeWords(alignment.words);
  const narrationEnd = alignment.words.at(-1).end;

  const { pauses } = resolveFullFilmPauses({ words: alignment.words, anchors: pauseMap.full_film_pause_anchors });

  // ---- locate every claim's real spoken window, forward-only, zero gaps ----
  let cursorTokenIndex = 0;
  const windows = [];
  for (const claim of usableClaims) {
    const { matchStart, matchEnd, nextSearchTokenIndex } = locateClaimWindow(tokens, claim, cursorTokenIndex);
    windows.push({ claim, matchStart, matchEnd });
    cursorTokenIndex = nextSearchTokenIndex;
  }
  // A single boundary per claim pair: claim i's coverage runs from the end
  // of its own quoted excerpt back to where the PREVIOUS claim's own quote
  // ended (i.e. coverEnd[i] = matchEnd[i], and coverStart[i+1] = coverEnd[i]
  // -- the same value, not two independently-computed ones). Using
  // matchStart of the NEXT claim for coverEnd (as an earlier version of
  // this function did) double-counts the connecting narration between two
  // claims: once as claim i's tail (up to claim i+1's quote start) AND
  // again as claim i+1's own lead-in (from claim i's quote end) -- the two
  // windows would overlap by that entire gap. Here, any narration between
  // one claim's quote and the next belongs to the LATER claim, as its own
  // lead-in.
  for (let i = 0; i < windows.length; i += 1) {
    windows[i].coverStart = i === 0 ? 0 : windows[i - 1].matchEnd;
    windows[i].coverEnd = i === windows.length - 1 ? narrationEnd : windows[i].matchEnd;
    if (windows[i].coverEnd <= windows[i].coverStart)
      throw new Error(`${windows[i].claim.claim_id} has a non-positive coverage window -- claims are out of narration order`);
  }

  // ---- raw shots in SOURCE (pre-pause) time: title cards + claim slices ----
  const sections = blueprint.full_production.sections;
  const sectionFirstClaim = new Map();
  for (const window of windows) if (!sectionFirstClaim.has(window.claim.section_id)) sectionFirstClaim.set(window.claim.section_id, window.claim.claim_id);

  const rawShots = [];
  let currentSection = null;
  let isFirstWindowOverall = true;
  for (const window of windows) {
    const isNewSection = window.claim.section_id !== currentSection;
    // The film's real opening is the licensed motion hook (see below), which
    // must dissolve directly into primary evidence -- auditMotionHook
    // requires the very first post-hook shot to be asset_type "evidence",
    // not a graphic title card. So section 1 alone defers its title card
    // until right after that first evidence slice; every later section
    // still opens on its own title card as usual.
    const deferTitleCard = isNewSection && isFirstWindowOverall;
    let titleCardShot = null;
    if (isNewSection) {
      currentSection = window.claim.section_id;
      const section = sections.find((s) => s.section_id === currentSection);
      titleCardShot = {
        kind: "graphic",
        section_id: currentSection,
        claim_id: sectionFirstClaim.get(currentSection),
        start: window.coverStart,
        end: window.coverStart + TITLE_CARD_SECONDS,
        graphic: { type: "section_title", title: titleCase(currentSection), subtitle: section?.visual_strategy || null },
        role: "graphic"
      };
      // Whether pushed now or deferred until after the first evidence
      // slice, the title card always claims TITLE_CARD_SECONDS out of this
      // section's own coverage window (real narration keeps playing under
      // it) -- shrinking coverStart here, before slicing, keeps the total
      // raw-shot duration sum equal to the real narration length either way.
      // Pause matching is unaffected either way: graphic shots are always
      // skipped by the pause-insertion pass below regardless of their own
      // start/end or array position.
      if (!deferTitleCard) rawShots.push(titleCardShot);
      window.coverStart += TITLE_CARD_SECONDS;
    }
    const slices = sliceClaimWindow(window.claim, window.coverStart, window.coverEnd, maxShotSeconds);
    for (const [sliceIndex, slice] of slices.entries()) {
      rawShots.push({
        kind: "evidence",
        evidenceKind: slice.kind,
        section_id: window.claim.section_id,
        claim_id: window.claim.claim_id,
        start: slice.start,
        end: slice.end,
        role: slice.role,
        // Carries through to the shot spec's transition_in so it dissolves
        // directly out of the motion hook rather than defaulting to "cut".
        dissolveIn: isFirstWindowOverall && sliceIndex === 0
      });
      if (deferTitleCard && sliceIndex === 0) rawShots.push(titleCardShot);
    }
    isFirstWindowOverall = false;
  }

  // ---- second pass: insert real pause holds as their own dedicated shots ----
  // A pause must not simply extend its enclosing shot's duration -- that
  // shot could already be close to max_shot_seconds, and adding a 4-6s
  // pause on top would push it over the per-shot cap buildCanonicalEditPlan
  // enforces. Each pause becomes its own shot instead (holding the same
  // claim/kind/role, with the emphasis_card attached), inserted right after
  // the shot whose source-time range contains it, offsetting every
  // subsequent shot's output timing by the pause's real duration.
  let insertedSeconds = 0;
  let pauseCursor = 0;
  const finalShots = [];
  for (let i = 0; i < rawShots.length; i += 1) {
    const raw = rawShots[i];
    finalShots.push({ ...raw, outputStart: raw.start + insertedSeconds, outputEnd: raw.end + insertedSeconds, emphasis: null });
    // Title cards are a synthetic slice of bookkeeping time (not real
    // spoken narration), so a pause -- always anchored to a real word
    // timestamp -- should never conceptually land inside one; skip them
    // defensively anyway rather than emit an invalid graphic-typed pause
    // shot with no graphic content if a numeric edge case ever occurs.
    while (
      raw.kind !== "graphic" &&
      pauseCursor < pauses.length &&
      pauses[pauseCursor].source_time_seconds <= raw.end + 1e-6 &&
      pauses[pauseCursor].source_time_seconds >= raw.start
    ) {
      const pause = pauses[pauseCursor];
      const pauseOutputStart = raw.end + insertedSeconds;
      finalShots.push({
        kind: raw.kind,
        evidenceKind: raw.evidenceKind,
        section_id: raw.section_id,
        claim_id: raw.claim_id,
        role: raw.role,
        outputStart: pauseOutputStart,
        outputEnd: pauseOutputStart + pause.duration_seconds,
        emphasis: pause
      });
      insertedSeconds += pause.duration_seconds;
      pauseCursor += 1;
    }
  }
  if (pauseCursor !== pauses.length) throw new Error(`${pauses.length - pauseCursor} resolved pause(s) fell outside every shot's time range`);

  const totalDuration = narrationEnd + insertedSeconds;

  // A claim can be real editorial synthesis rather than a new factual
  // assertion (e.g. CLM_020_SYSTEMIC_INCENTIVE_FINAL's own
  // evidence_requirements: "Treat as the film's synthesis, visually built
  // from earlier verified evidence rather than a new factual claim") --
  // evidence_resolutions.json legitimately leaves such claims' source_ids
  // empty rather than attaching them to one arbitrary earlier source. But
  // buildCanonicalEditPlan still requires every evidence shot to carry
  // real, visible source attribution, and this must not be satisfied by
  // fabricating a source_id that was never actually cited. Since these
  // claims are explicitly a recap/montage of the film's own already-cited
  // evidence, attributing them to the real, deduplicated union of every
  // other usable claim's source_ids is truthful (it names exactly the
  // sources whose evidence is being recapped) without inventing anything.
  const recapSourceIds = [...new Set(usableClaims.flatMap((c) => c.source_ids || []).filter((id) => validSourceIds.has(id)))];

  // ---- assemble full_production.shots specs (buildCanonicalEditPlan's input shape) ----
  const shots = finalShots.map((shot, index) => {
    const duration = Math.round((shot.outputEnd - shot.outputStart) * 1000) / 1000;
    const base = {
      duration,
      claim_id: shot.claim_id,
      section_id: shot.section_id,
      scene_id: `scene_${String(sections.findIndex((s) => s.section_id === shot.section_id) + 1).padStart(3, "0")}`,
      visual_role: shot.role,
      editorial_purpose: shot.emphasis
        ? `Editorial pause beat: ${shot.emphasis.purpose || "emphasis hold"}.`.slice(0, 200)
        : `Present ${shot.claim_id.replace(/^CLM_\d+_/, "").replace(/_/g, " ").toLowerCase()} evidence for this section.`,
      ...(shot.emphasis ? { emphasis_card: { eyebrow: (shot.emphasis.purpose || "EMPHASIS").toUpperCase().slice(0, 60), title: shot.emphasis.anchor_text, accent: null } } : {}),
      ...(shot.dissolveIn ? { transition_in: "dissolve" } : {})
    };
    if (shot.kind === "graphic") {
      return { ...base, asset_type: "graphic", graphic: shot.graphic, visual_role: "graphic" };
    }
    const claim = usableClaims.find((c) => c.claim_id === shot.claim_id);
    const ownSourceIds = (claim.source_ids || []).filter((id) => validSourceIds.has(id));
    const isRecap = ownSourceIds.length === 0;
    const sourceIds = isRecap ? recapSourceIds : ownSourceIds;
    return {
      ...base,
      asset_type: "evidence",
      evidence: {
        kind: shot.evidenceKind,
        source_ids: sourceIds,
        source_label: isRecap ? "Multiple verified sources (recap)" : evidenceMap.source_catalog.find((s) => s.source_id === ownSourceIds[0])?.publisher || "Source",
        font_px: DEFAULT_FONT_PX
      }
    };
  });

  // ---- opening motion hook: the same real, licensed footage proof mode
  // uses (direction/motion_hook.json), not a second, full-mode-only asset.
  // auditMotionHook (scripts/lib/orvyq-motion-hook.mjs) runs unconditionally
  // against BOTH modes' shots and requires a contiguous 10-14s hook_footage
  // block starting at frame 0 -- this is genuinely shared opening footage,
  // not proof-specific hardcoding, so full mode reuses it exactly as
  // authored rather than fabricating a separate hook.
  const firstSectionId = sections[0]?.section_id;
  const hookShots = (motionHook.shots || []).map((hookShot) => ({
    duration: hookShot.duration,
    claim_id: hookShot.claim_id,
    section_id: firstSectionId,
    scene_id: "scene_001",
    visual_role: hookShot.visual_role,
    editorial_purpose: hookShot.editorial_purpose,
    asset_type: "footage",
    asset: hookShot.video_asset,
    trim_in_sec: hookShot.trim_in_sec,
    trim_out_sec: hookShot.trim_out_sec,
    motion: hookShot.motion_variant,
    hook_footage: true
  }));
  const hookDuration = hookShots.reduce((sum, hookShot) => sum + hookShot.duration, 0);
  if (hookDuration < motionHook.minimum_seconds || hookDuration > motionHook.maximum_seconds)
    throw new Error(`direction/motion_hook.json's own shots sum to ${hookDuration}s, outside its declared ${motionHook.minimum_seconds}-${motionHook.maximum_seconds}s range`);

  return { shots: [...hookShots, ...shots], totalDuration: totalDuration + hookDuration, claimCount: usableClaims.length, pauseCount: pauses.length };
}

export async function writeFullProductionPlan(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const blueprintPath = path.join(dir, "direction", "editorial_blueprint.json");
  const blueprint = await readJson(blueprintPath);
  const { shots, totalDuration, claimCount, pauseCount } = await buildFullProductionPlan(projectId);
  blueprint.full_production.status = "ready";
  blueprint.full_production.blocking_claim_ids = [];
  blueprint.full_production.shots = shots;
  blueprint.full_production.generated_at = new Date().toISOString();
  blueprint.full_production.generated_total_duration_seconds = Math.round(totalDuration * 1000) / 1000;
  await writeJsonAtomic(blueprintPath, blueprint);
  return { shot_count: shots.length, total_duration_seconds: totalDuration, claim_count: claimCount, pause_count: pauseCount };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  writeFullProductionPlan(args["project-id"] || PROJECT_ID)
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
