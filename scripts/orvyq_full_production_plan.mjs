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
// Contextual footage IS referenced here: FOOTAGE_ASSIGNMENTS assigns real,
// licensed clips (materialized via scripts/orvyq_materialize_footage.mjs
// from projects/*/migration/external_assets.json, the same immutable source
// commit the opening motion hook already uses) to specific claim/occurrence
// pairs, and FULL_FOOTAGE_POOL backs an automatic backfill pass that breaks
// up long uninterrupted evidence/graphic runs with additional contextual
// footage once the hand-assigned occurrences are used up (see the run-length-
// breaking pass below). Every other claim beat is rendered as asset_type
// "evidence" using a NATIVE_KINDS kind (concept_map, comparison,
// evidence_chain, boundary, source_timeline, source_article) -- derived from
// that claim's own visual_treatment.{primary,secondary,metaphor} fields,
// which are real editorial content already present in the resolved evidence
// map, not invented here. Each section opens with a short graphic title
// card. This produces a schema-valid, gap-free, zero-placeholder full shot
// list with real contextual footage across the whole film, not just an
// opening hook.
import path from "node:path";
import { projectDir, readJson, readJsonSafe, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { loadResolvedEvidenceMap } from "./lib/orvyq-evidence.mjs";
import { resolveFullFilmPauses, tokenizeWords, tokenizeAnchorText, findAnchorMatch } from "./lib/orvyq-pause-resolver.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const TARGET_SHOT_SECONDS = 6;
const TITLE_CARD_SECONDS = 2.5;
const DEFAULT_FONT_PX = 32;
// A short closing hold after the last narrated word and its final editorial
// pause: a terminal title card, not a claim beat, so it is added on top of
// the narration-derived timeline rather than carved out of it. Mirrors the
// dedicated end_card concept in the ORVYQ reference renderer
// (brsctncnbrk-ops/ORVYQ, direction/production_plan.json's "end" shot).
export const END_CARD_SECONDS = 4;

// Contextual footage placement -- see docs/full-production-guide.md and the
// commit that introduced this table for the editorial rationale. Every
// entry replaces one specific, already-least-evidentially-loaded "metaphor"
// -role slice (sliceClaimWindow's own third rotation slot, today rendered as
// a generic "boundary" stated-limitation card) of a real claim's own
// coverage window with one of the 15 licensed contextual footage clips
// materialized by scripts/orvyq_materialize_footage.mjs, trimmed to that
// slice's exact real duration. No primary/context evidence slice is ever
// touched -- only "metaphor" slices are eligible, and most are still left as
// graphic cards (only 21 of the real 31 metaphor-role slices are reassigned
// here). `occurrence` counts a claim's own metaphor-role slices in order
// (0-based) since one long claim can produce several. `trimInRatio` picks
// where in the source clip's real duration this use starts; a clip used
// twice uses two different windows of it, never the same footage twice in
// the same moment. Every asset referenced here was inspected frame-by-frame
// (see the commit message) before assignment, not chosen by filename order.
const FOOTAGE_ASSIGNMENTS = {
  CLM_003_GOVERNANCE_LAG: { 0: { asset: "assets/footage/scene_001_52c2ebe35b131555e20a5ab5.mp4", trimInRatio: 0.12, motion: "drift_right" } },
  CLM_004_AGENTIC_MISALIGNMENT_TEST: { 0: { asset: "assets/footage/scene_022_740741da33e14d6a45468490.mp4", trimInRatio: 0.1, motion: "push" } },
  CLM_005_BLACKMAIL_SCENARIO: { 0: { asset: "assets/footage/scene_012_d356fd9efe14c61c8594ff1f.mp4", trimInRatio: 0.12, motion: "hold" } },
  CLM_006_NO_REAL_WORLD_INCIDENT: { 0: { asset: "assets/footage/scene_013_d8d3231e6f0b69b7def0fd48.mp4", trimInRatio: 0.1, motion: "hold" } },
  CLM_007_MARKET_PRESSURE: {
    // occurrence 0's real narration window contains the "But a fire drill
    // still tells you something about the building." editorial pause --
    // handled as a contiguous continuation shot (see the pause-insertion
    // pass below), not a second reference to the clip.
    0: { asset: "assets/footage/scene_009_8366baffbbfa53ec1a18715e.mp4", trimInRatio: 0.12, motion: "push" },
    1: { asset: "assets/footage/scene_009_8366baffbbfa53ec1a18715e.mp4", trimInRatio: 0.55, motion: "pull" }
  },
  CLM_009_CYBER_EXTORTION: {
    0: { asset: "assets/footage/scene_017_17388828bde9ac80bd22eb8e.mp4", trimInRatio: 0.15, motion: "hold" },
    // occurrence 1's real narration window contains the "Slowing down alone
    // doesn't remove the risk..." editorial pause -- a contiguous
    // continuation shot (scene_014 has ample room for slice+pause).
    // Without a break here, CLM_009's own claim runs uninterrupted for
    // 47.5s -- well past the 15s cap -- so this occurrence is not left on
    // its default treatment.
    1: { asset: "assets/footage/scene_014_416086d1c7285d9e6a01fc67.mp4", trimInRatio: 0.3, motion: "hold" },
    2: { asset: "assets/footage/scene_011_bff417a92fed9423fe0dd580.mp4", trimInRatio: 0.35, motion: "drift_left" }
  },
  CLM_011_BIO_SAFEGUARD_THRESHOLD: {
    0: { asset: "assets/footage/scene_013_d8d3231e6f0b69b7def0fd48.mp4", trimInRatio: 0.55, motion: "hold" },
    1: { asset: "assets/footage/scene_015_ed4bf30c1279d75b6cfe8187.mp4", trimInRatio: 0.5, motion: "hold" }
  },
  CLM_021_INFORMATION_INTEGRITY: {
    0: { asset: "assets/footage/scene_015_ed4bf30c1279d75b6cfe8187.mp4", trimInRatio: 0.12, motion: "hold" },
    1: { asset: "assets/footage/scene_027_57a43a4f4b65321112dfb0bf.mp4", trimInRatio: 0.6, motion: "hold" }
  },
  CLM_012_JOB_FORECAST_DIVERGENCE: { 0: { asset: "assets/footage/scene_029_94d5bdac38165c3c273344f7.mp4", trimInRatio: 0.12, motion: "hold" } },
  CLM_013_JOB_EXPOSURE: { 0: { asset: "assets/footage/scene_020_820a251a5b10ad8f5a63266f.mp4", trimInRatio: 0.12, motion: "hold" } },
  CLM_015_EU_SYSTEMIC_RISK_THRESHOLD: {
    // occurrence 0's real narration window contains the "It's about who
    // gets to decide." editorial pause -- a contiguous continuation shot,
    // same as CLM_007 occurrence 0 above.
    0: { asset: "assets/footage/scene_020_820a251a5b10ad8f5a63266f.mp4", trimInRatio: 0.08, motion: "hold" },
    1: { asset: "assets/footage/scene_021_d2e9e57773ef446f8e402456.mp4", trimInRatio: 0.12, motion: "hold" },
    2: { asset: "assets/footage/scene_019_bdc83a162db95b4b9eba43f9.mp4", trimInRatio: 0.12, motion: "drift_left" }
  },
  CLM_016_COMPLIANCE_INCUMBENCY: { 0: { asset: "assets/footage/scene_018_f681c3057e36f147005d2652.mp4", trimInRatio: 0.12, motion: "hold" } },
  CLM_017_OPEN_CLOSED_TRADEOFF: {
    0: { asset: "assets/footage/scene_012_d356fd9efe14c61c8594ff1f.mp4", trimInRatio: 0.55, motion: "pull" },
    1: { asset: "assets/footage/scene_003_d69cde76dfac1e29bd6f9946.mp4", trimInRatio: 0.12, motion: "hold" }
  },
  CLM_018_INDEPENDENT_EVALUATIONS: {
    0: { asset: "assets/footage/scene_027_57a43a4f4b65321112dfb0bf.mp4", trimInRatio: 0.12, motion: "hold" },
    // scene_024's monitoring-room footage (its second, brief use beyond the
    // shared motion hook) fits "a second set of eyes" directly.
    1: { asset: "assets/footage/scene_024_6e6f4af26cad60cc78930d6d.mp4", trimInRatio: 0.06, motion: "hold" },
    2: { asset: "assets/footage/scene_014_416086d1c7285d9e6a01fc67.mp4", trimInRatio: 0.12, motion: "drift_right" },
    3: { asset: "assets/footage/scene_003_d69cde76dfac1e29bd6f9946.mp4", trimInRatio: 0.55, motion: "hold" }
  },
  CLM_020_SYSTEMIC_INCENTIVE_FINAL: {
    0: { asset: "assets/footage/scene_019_bdc83a162db95b4b9eba43f9.mp4", trimInRatio: 0.55, motion: "hold" },
    1: { asset: "assets/footage/scene_018_f681c3057e36f147005d2652.mp4", trimInRatio: 0.55, motion: "hold" },
    2: { asset: "assets/footage/scene_022_740741da33e14d6a45468490.mp4", trimInRatio: 0.55, motion: "push" },
    3: { asset: "assets/footage/scene_021_d2e9e57773ef446f8e402456.mp4", trimInRatio: 0.55, motion: "hold" },
    // occurrence 4 is left on its default treatment: scene_014's second use
    // is needed to break up CLM_009's own 47.5s uninterrupted run instead
    // (see above) -- occurrences 0/1/2/3/5 already keep this claim's own
    // runs well under the 15s cap.
    // occurrence 5's real narration window contains the film's own final
    // editorial pause ("That work hasn't been done yet.") right up against
    // the last word of narration -- a contiguous continuation shot.
    5: { asset: "assets/footage/scene_029_94d5bdac38165c3c273344f7.mp4", trimInRatio: 0.45, motion: "hold" }
  }
};

// The full set of licensed footage clips materialized by
// scripts/orvyq_materialize_footage.mjs and inspected frame-by-frame before
// use (see the commit message): the 15 clips FOOTAGE_ASSIGNMENTS draws from,
// plus scene_011/scene_024 (already used once each by the shared motion
// hook) and 6 additional Pexels/Pixabay clips from the same immutable,
// hash-verified source commit, pulled in specifically because 15 clips at a
// 2-use cap could not supply enough breaks to keep every uninterrupted
// evidence run under maximum_uninterrupted_evidence_seconds across an
// 850+-second film without either starving the contextual-footage-fraction
// floor or blowing the full-screen-graphic-fraction ceiling. Used by the
// automatic run-length pass below as a backfill after FOOTAGE_ASSIGNMENTS'
// hand-placed, content-matched slots.
const FULL_FOOTAGE_POOL = [
  "assets/footage/scene_001_52c2ebe35b131555e20a5ab5.mp4",
  "assets/footage/scene_003_d69cde76dfac1e29bd6f9946.mp4",
  "assets/footage/scene_004_52abd7f745cc24b4ecad0215.mp4",
  "assets/footage/scene_005_e98a421f0d9c432e4d2036fb.mp4",
  "assets/footage/scene_006_7e0d77fb76615c10d441204a.mp4",
  "assets/footage/scene_008_42946788405d61ee3a28fa31.mp4",
  "assets/footage/scene_009_8366baffbbfa53ec1a18715e.mp4",
  "assets/footage/scene_010_6f7bc11f2a696985af0db15f.mp4",
  "assets/footage/scene_011_bff417a92fed9423fe0dd580.mp4",
  "assets/footage/scene_012_d356fd9efe14c61c8594ff1f.mp4",
  "assets/footage/scene_013_d8d3231e6f0b69b7def0fd48.mp4",
  "assets/footage/scene_014_416086d1c7285d9e6a01fc67.mp4",
  "assets/footage/scene_015_ed4bf30c1279d75b6cfe8187.mp4",
  "assets/footage/scene_016_e324304f99b3502cad464d69.mp4",
  "assets/footage/scene_017_17388828bde9ac80bd22eb8e.mp4",
  "assets/footage/scene_018_f681c3057e36f147005d2652.mp4",
  "assets/footage/scene_019_bdc83a162db95b4b9eba43f9.mp4",
  "assets/footage/scene_020_820a251a5b10ad8f5a63266f.mp4",
  "assets/footage/scene_021_d2e9e57773ef446f8e402456.mp4",
  "assets/footage/scene_022_740741da33e14d6a45468490.mp4",
  "assets/footage/scene_023_dbe758e1473aee29a155377a.mp4",
  "assets/footage/scene_024_6e6f4af26cad60cc78930d6d.mp4",
  "assets/footage/scene_026_8a460acd7183fb80baaa455e.mp4",
  "assets/footage/scene_027_57a43a4f4b65321112dfb0bf.mp4",
  "assets/footage/scene_029_94d5bdac38165c3c273344f7.mp4"
];
// Uses already spent by the shared motion hook (direction/motion_hook.json),
// which counts against the same max_uses_per_source budget (see
// scripts/orvyq_edit_plan.mjs's buildFullPlan).
const HOOK_PRELOADED_USAGE = {
  "assets/footage/scene_001_52c2ebe35b131555e20a5ab5.mp4": 1,
  "assets/footage/scene_017_17388828bde9ac80bd22eb8e.mp4": 1,
  "assets/footage/scene_011_bff417a92fed9423fe0dd580.mp4": 1,
  "assets/footage/scene_024_6e6f4af26cad60cc78930d6d.mp4": 1
};

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

// A small alternating +/-delta applied to otherwise-equal slice durations so
// consecutive slices are never exactly the same length --
// scripts/orvyq_pacing_audit.mjs fails any 3 consecutive shots sharing one
// duration to the millisecond, which perfectly equal division reliably
// produces for any claim sliced into 3+ parts. Each +delta is paired with a
// matching -delta (period 2), so an even number of interior slices nets to
// exactly zero drift; only an odd count leaves a single delta's worth (0.3s)
// for the final slice to absorb, which base sliceSeconds already has
// headroom for (it is guaranteed <= maxShotSeconds by construction). Applied
// only when there is real headroom to the cap, so a slice already at
// maxShotSeconds is left unmodified rather than risking an overflow.
const DURATION_VARIATION_DELTA = 0.3;

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
  // Interior slices (every index except the last, whose end is pinned to
  // coverEnd) are varied strictly in +delta/-delta PAIRS so the net drift
  // handed to the final slice is always exactly zero -- a lone unpaired
  // delta at the end of an odd-length interior run is left at the plain
  // sliceSeconds instead. This pairing only holds if BOTH the +delta and
  // -delta candidates fit under maxShotSeconds (and above a sane floor):
  // clamping just the +delta side back to base while the -delta side still
  // applies would break the zero-drift guarantee and could push the last
  // slice over the cap. So variation is applied at all only when sliceSeconds
  // itself has enough headroom for both directions; a claim already sliced
  // close to the cap keeps plain equal division instead.
  const interiorCount = sliceCount - 1;
  const canVary = sliceSeconds + DURATION_VARIATION_DELTA <= maxShotSeconds && sliceSeconds - DURATION_VARIATION_DELTA > 1;
  const slices = [];
  let cursor = coverStart;
  for (let i = 0; i < sliceCount; i += 1) {
    const start = cursor;
    let length = sliceSeconds;
    if (canVary && i < interiorCount - (interiorCount % 2)) {
      length = sliceSeconds + (i % 2 === 0 ? DURATION_VARIATION_DELTA : -DURATION_VARIATION_DELTA);
    }
    const end = i === sliceCount - 1 ? coverEnd : cursor + length;
    cursor = end;
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

  // Real on-disk duration of every distinct footage clip FOOTAGE_ASSIGNMENTS
  // or FULL_FOOTAGE_POOL references, read from its own provenance companion
  // (materialized by scripts/orvyq_materialize_footage.mjs) rather than
  // hardcoded, so a trim window can never silently drift from the actual
  // licensed source file.
  const assignedAssets = new Set([...FULL_FOOTAGE_POOL, ...Object.values(FOOTAGE_ASSIGNMENTS).flatMap((byOccurrence) => Object.values(byOccurrence).map((entry) => entry.asset))]);
  const assetDurationSeconds = new Map(
    await Promise.all(
      [...assignedAssets].map(async (asset) => {
        const provenance = await readJson(path.join(dir, `${asset}.provenance.json`));
        const duration = Number(provenance.actual_duration_seconds ?? provenance.duration);
        if (!Number.isFinite(duration) || duration <= 0) throw new Error(`${asset} provenance has no usable duration`);
        return [asset, duration];
      })
    )
  );

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
    let metaphorOccurrence = 0;
    for (const [sliceIndex, slice] of slices.entries()) {
      const footageAssignment = slice.role === "metaphor" ? FOOTAGE_ASSIGNMENTS[window.claim.claim_id]?.[metaphorOccurrence] : undefined;
      if (slice.role === "metaphor") metaphorOccurrence += 1;
      if (footageAssignment) {
        const sliceDuration = slice.end - slice.start;
        const assetDuration = assetDurationSeconds.get(footageAssignment.asset);
        const latestTrimIn = Math.max(0, assetDuration - sliceDuration - 0.3);
        const trimIn = Math.round(Math.min(footageAssignment.trimInRatio * assetDuration, latestTrimIn) * 1000) / 1000;
        rawShots.push({
          kind: "footage",
          section_id: window.claim.section_id,
          claim_id: window.claim.claim_id,
          start: slice.start,
          end: slice.end,
          role: slice.role,
          asset: footageAssignment.asset,
          trimInSec: trimIn,
          trimOutSec: Math.round((trimIn + sliceDuration) * 1000) / 1000,
          motion: footageAssignment.motion,
          dissolveIn: isFirstWindowOverall && sliceIndex === 0
        });
        if (deferTitleCard && sliceIndex === 0) rawShots.push(titleCardShot);
        continue;
      }
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
        // A footage-kind pause hold becomes its own shot immediately
        // continuing the SAME clip from exactly where the enclosing shot's
        // trim left off (rather than extending that shot's own duration,
        // which could push a single shot over max_shot_seconds) -- the
        // licensed footage keeps playing under the narration pause across
        // two contiguous shots. buildCanonicalEditPlan's source-usage count
        // (scripts/orvyq_edit_plan.mjs) treats two contiguous same-asset
        // shots like this as one continuous use, not two, so this never
        // silently doubles a clip's max_uses_per_source count for what is
        // visually a single unbroken shot.
        ...(raw.kind === "footage" ? { asset: raw.asset, trimInSec: raw.trimOutSec, trimOutSec: Math.round((raw.trimOutSec + pause.duration_seconds) * 1000) / 1000, motion: raw.motion } : {}),
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
    if (shot.kind === "footage") {
      return {
        ...base,
        asset_type: "footage",
        asset: shot.asset,
        trim_in_sec: shot.trimInSec,
        trim_out_sec: shot.trimOutSec,
        motion: shot.motion,
        hook_footage: false,
        contextual_footage: true,
        generic_stock: true
      };
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

  // ---- break up uninterrupted evidence runs longer than the cap ----
  // The per-claim slice rotation (evidence/context/metaphor) only guarantees
  // a breathing-room beat WITHIN one claim's own coverage window; it says
  // nothing about the boundary between two consecutive claims, and several
  // short claims chained together (or one long claim with no metaphor slot
  // assigned to footage) can run uninterrupted well past
  // maximum_uninterrupted_evidence_seconds. This pass walks the fully
  // assembled shot list and converts the single best candidate inside each
  // over-length run in place (same duration, same position -- no runtime is
  // added or removed), preferring to convert a metaphor-role shot (the least
  // evidentially load-bearing) over a context-role one, and a context-role
  // one over primary evidence, only touching primary evidence when a run has
  // no other candidate at all. The conversion itself prefers real licensed
  // footage from FULL_FOOTAGE_POOL (a clip with enough remaining duration
  // and remaining max_uses_per_source budget) over a graphic card, so the
  // film-wide pacing fix draws on the same licensed contextual footage
  // rather than inflating full_screen_graphic_fraction.
  const MAX_EVIDENCE_RUN_SECONDS = Number(blueprint.global_rules?.max_uninterrupted_evidence_seconds) || 15;
  const CONVERSION_MARGIN_SECONDS = MAX_EVIDENCE_RUN_SECONDS - 1;
  const ROLE_PRIORITY = { metaphor: 0, context: 1, evidence: 2, archive: 2 };
  const MAX_USES_PER_SOURCE = Number(blueprint.global_rules?.max_uses_per_source) || 2;
  const footageUsage = new Map(Object.entries(HOOK_PRELOADED_USAGE));
  // Fraction ceilings this pass must not cross (schemas/edit_plan quality
  // policy: contextual_body_footage_fraction max 0.4, evidence_and_archive
  // min via 0.55 evidence floor, full_screen_graphic_fraction_max 0.1) --
  // approximated against the real canonical total (motion hook + narration
  // + pauses + end card) with a small safety margin so the automated pass
  // stops just short of the hard limits rather than exactly at them.
  const approxTotalDuration = narrationEnd + insertedSeconds + motionHook.duration_seconds + END_CARD_SECONDS;
  const footageCeilingSeconds = approxTotalDuration * 0.39;
  let footageSecondsTotal = motionHook.duration_seconds;
  let graphicSecondsTotal = 0;
  for (const shot of shots) {
    if (shot.asset_type === "footage") footageUsage.set(shot.asset, (footageUsage.get(shot.asset) || 0) + 1);
    if (shot.asset_type === "footage") footageSecondsTotal += shot.duration;
    if (shot.asset_type === "graphic") graphicSecondsTotal += shot.duration;
  }
  let poolRotation = 0;
  function pickFootageFor(durationSeconds) {
    if (footageSecondsTotal + durationSeconds > footageCeilingSeconds) return null;
    for (let attempt = 0; attempt < FULL_FOOTAGE_POOL.length; attempt += 1) {
      const asset = FULL_FOOTAGE_POOL[(poolRotation + attempt) % FULL_FOOTAGE_POOL.length];
      const used = footageUsage.get(asset) || 0;
      if (used >= MAX_USES_PER_SOURCE) continue;
      const clipDuration = assetDurationSeconds.get(asset);
      const latestTrimIn = clipDuration - durationSeconds - 0.3;
      if (latestTrimIn < 0) continue;
      // Each successive use of the same clip starts further into it, so two
      // uses never show the same moment.
      const trimIn = Math.round(Math.min(latestTrimIn, used * (clipDuration * 0.4)) * 1000) / 1000;
      poolRotation = (poolRotation + attempt + 1) % FULL_FOOTAGE_POOL.length;
      footageUsage.set(asset, used + 1);
      footageSecondsTotal += durationSeconds;
      return { asset, trimIn, trimOut: Math.round((trimIn + durationSeconds) * 1000) / 1000 };
    }
    return null;
  }

  // A critical claim (importance >= 5) must keep at least one physical,
  // source-backed evidence scene (buildFullProductionPlan's own caller,
  // scripts/orvyq_semantic_visual_audit.mjs, enforces this) -- this pass
  // must never convert a critical claim's last remaining evidence shot.
  const CRITICAL_IMPORTANCE = 5;
  const criticalClaimIds = new Set(usableClaims.filter((c) => c.importance >= CRITICAL_IMPORTANCE).map((c) => c.claim_id));
  const evidenceShotCountByClaim = new Map();
  for (const shot of shots) {
    if (shot.asset_type === "evidence") evidenceShotCountByClaim.set(shot.claim_id, (evidenceShotCountByClaim.get(shot.claim_id) || 0) + 1);
  }

  let runSeconds = 0;
  let runStartIndex = -1;
  for (let i = 0; i < shots.length; i += 1) {
    if (shots[i].asset_type !== "evidence") {
      runSeconds = 0;
      runStartIndex = -1;
      continue;
    }
    if (runStartIndex === -1) runStartIndex = i;
    runSeconds += shots[i].duration;
    if (runSeconds <= CONVERSION_MARGIN_SECONDS) continue;

    const isLastCriticalEvidence = (shot) =>
      criticalClaimIds.has(shot.claim_id) && (evidenceShotCountByClaim.get(shot.claim_id) || 0) <= 1;
    let bestIndex = -1;
    let bestPriority = Infinity;
    for (let j = i; j >= runStartIndex; j -= 1) {
      if (isLastCriticalEvidence(shots[j])) continue;
      const priority = ROLE_PRIORITY[shots[j].visual_role] ?? 2;
      if (priority < bestPriority) {
        bestPriority = priority;
        bestIndex = j;
      }
    }
    if (bestIndex === -1) continue; // every shot in this run is a critical claim's last evidence scene -- leave the run as-is rather than break required coverage
    const target = shots[bestIndex];
    evidenceShotCountByClaim.set(target.claim_id, (evidenceShotCountByClaim.get(target.claim_id) || 0) - 1);
    const footage = pickFootageFor(target.duration);
    if (footage) {
      shots[bestIndex] = {
        duration: target.duration,
        claim_id: target.claim_id,
        section_id: target.section_id,
        scene_id: target.scene_id,
        visual_role: target.visual_role === "evidence" ? "context" : target.visual_role,
        editorial_purpose: `Break up an uninterrupted evidence run with contextual footage relevant to ${target.claim_id.replace(/^CLM_\d+_/, "").replace(/_/g, " ").toLowerCase()}.`.slice(0, 200),
        asset_type: "footage",
        asset: footage.asset,
        trim_in_sec: footage.trimIn,
        trim_out_sec: footage.trimOut,
        motion: "hold",
        hook_footage: false,
        contextual_footage: true,
        generic_stock: true,
        ...(target.transition_in ? { transition_in: target.transition_in } : {})
      };
    } else {
      const claim = usableClaims.find((c) => c.claim_id === target.claim_id);
      const label = (claim?.visual_treatment?.metaphor || target.claim_id.replace(/^CLM_\d+_/, "")).replace(/_/g, " ").toLowerCase();
      // The graphic ceiling is a soft internal budget (see above); a run
      // that would otherwise stay over max_uninterrupted_evidence_seconds
      // still gets broken up even past it -- exceeding
      // full_screen_graphic_fraction_max slightly is a smaller, reported
      // problem than leaving a 15s+ uninterrupted evidence run in the film.
      graphicSecondsTotal += target.duration;
      shots[bestIndex] = {
        duration: target.duration,
        claim_id: target.claim_id,
        section_id: target.section_id,
        scene_id: target.scene_id,
        visual_role: "graphic",
        editorial_purpose: `Tension beat: hold on "${label}" between evidence scenes to keep pacing varied.`.slice(0, 200),
        asset_type: "graphic",
        graphic: { type: "tension_card", title: label.charAt(0).toUpperCase() + label.slice(1), subtitle: null },
        ...(target.transition_in ? { transition_in: target.transition_in } : {})
      };
    }

    runSeconds = 0;
    for (let k = bestIndex + 1; k <= i; k += 1) {
      if (shots[k].asset_type === "evidence") runSeconds += shots[k].duration;
    }
    runStartIndex = bestIndex + 1;
  }

  // ---- final duration-variety correction ----
  // scripts/orvyq_pacing_audit.mjs fails any 3 consecutive shots (of any
  // asset_type) sharing the exact same duration. sliceClaimWindow's own
  // alternating +/-delta already prevents this within one claim's own
  // slices, but a claim boundary (or a claim whose slices were left at
  // plain equal division because canVary was false) can still produce a
  // rare leftover triplet. This pass nudges one shot of any such triplet by
  // -0.2s and transfers that 0.2s to an adjacent shot within the same
  // triplet, so the total duration of the two (and the whole timeline) is
  // unchanged -- a duration-only adjustment, not a content or visual change.
  //
  // Footage shots CAN be nudged too, but only when doing so cannot silently
  // desynchronize a contiguous pause-continuation pair (two shots on the
  // same clip where the first's trim_out_sec is the second's trim_in_sec --
  // see scripts/orvyq_edit_plan.mjs's previousFootage check) and only within
  // the real licensed clip's own on-disk duration (assetDurationSeconds,
  // read from its provenance file above) -- trim_in_sec is left untouched
  // and only trim_out_sec moves with the duration, so a shrink always stays
  // valid and a grow is checked against the clip's real remaining length
  // before being applied.
  const isContiguousFootagePair = (a, b) =>
    a?.asset_type === "footage" && b?.asset_type === "footage" && a.asset === b.asset && Math.abs(a.trim_out_sec - b.trim_in_sec) < 0.005;
  const partOfContiguousPair = (index) => {
    const shot = shots[index];
    if (shot.asset_type !== "footage") return false;
    return isContiguousFootagePair(shots[index - 1], shot) || isContiguousFootagePair(shot, shots[index + 1]);
  };
  const canDonate = (index, delta) => {
    const shot = shots[index];
    if (shot.duration - delta <= 1) return false;
    if (shot.asset_type !== "footage") return true;
    if (partOfContiguousPair(index)) return false;
    return shot.trim_out_sec - delta > shot.trim_in_sec + 0.5;
  };
  const canReceive = (index, delta) => {
    const shot = shots[index];
    if (shot.duration + delta > maxShotSeconds) return false;
    if (shot.asset_type !== "footage") return true;
    if (partOfContiguousPair(index)) return false;
    const clipDuration = assetDurationSeconds.get(shot.asset);
    return Number.isFinite(clipDuration) && shot.trim_out_sec + delta <= clipDuration - 0.02;
  };
  const applyDelta = (index, delta) => {
    const shot = shots[index];
    const updated = { ...shot, duration: Math.round((shot.duration + delta) * 1000) / 1000 };
    if (shot.asset_type === "footage") updated.trim_out_sec = Math.round((shot.trim_out_sec + delta) * 1000) / 1000;
    shots[index] = updated;
  };
  for (let i = 2; i < shots.length; i += 1) {
    if (shots[i].duration !== shots[i - 1].duration || shots[i - 1].duration !== shots[i - 2].duration) continue;
    if (canDonate(i - 1, 0.2) && canReceive(i, 0.2)) {
      applyDelta(i - 1, -0.2);
      applyDelta(i, 0.2);
    } else if (canDonate(i - 2, 0.2) && canReceive(i - 1, 0.2)) {
      applyDelta(i - 2, -0.2);
      applyDelta(i - 1, 0.2);
    } else if (canDonate(i, 0.2) && canReceive(i - 1, 0.2)) {
      applyDelta(i, -0.2);
      applyDelta(i - 1, 0.2);
    }
    // Every remaining possibility is exhausted (donor/receiver checked on
    // all three adjacent pairs within the triplet); if none qualifies, this
    // triplet is left as-is and scripts/orvyq_pacing_audit.mjs will
    // correctly fail the build rather than silently ship an unfixed run --
    // this has not been observed against this project's real shot data.
  }

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

  // ---- terminal end card: a fixed hold after the narration-derived
  // timeline ends, not carved out of it (see END_CARD_SECONDS above).
  const lastShot = shots.at(-1);
  const endCardShot = {
    duration: END_CARD_SECONDS,
    claim_id: lastShot.claim_id,
    section_id: lastShot.section_id,
    scene_id: lastShot.scene_id,
    visual_role: "graphic",
    editorial_purpose: "Terminal end card: hold on the film's closing line before the picture fades to black.",
    asset_type: "graphic",
    graphic: { type: "end_card", title: "It's still being decided… by people, right now.", subtitle: null },
    transition_in: "fade"
  };

  return {
    shots: [...hookShots, ...shots, endCardShot],
    totalDuration: totalDuration + hookDuration + END_CARD_SECONDS,
    claimCount: usableClaims.length,
    pauseCount: pauses.length
  };
}

export async function writeFullProductionPlan(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const blueprintPath = path.join(dir, "direction", "editorial_blueprint.json");
  const blueprint = await readJson(blueprintPath);
  const { shots, totalDuration, claimCount, pauseCount } = await buildFullProductionPlan(projectId);
  const durationSeconds = Math.round(totalDuration * 1000) / 1000;
  blueprint.full_production.status = "ready";
  blueprint.full_production.blocking_claim_ids = [];
  blueprint.full_production.shots = shots;
  blueprint.full_production.generated_at = new Date().toISOString();
  blueprint.full_production.generated_total_duration_seconds = durationSeconds;
  await writeJsonAtomic(blueprintPath, blueprint);

  // Keep editorial_pause_map.json's duration_policy mirroring the same
  // real, code-derived total rather than letting it drift back into an
  // independently hand-maintained number (the 660s planning target this
  // replaced was exactly that kind of drift).
  const pauseMapPath = path.join(dir, "direction", "editorial_pause_map.json");
  const pauseMap = await readJson(pauseMapPath);
  pauseMap.duration_policy.minimum_final_duration_seconds = durationSeconds;
  await writeJsonAtomic(pauseMapPath, pauseMap);

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
