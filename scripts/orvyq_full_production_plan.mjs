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
import { buildEvidenceContent } from "./lib/orvyq-evidence-authoring.mjs";
import { FPS, END_CARD_SECONDS } from "./lib/orvyq-timeline.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const TARGET_SHOT_SECONDS = 6;
const TITLE_CARD_SECONDS = 2.5;
const DEFAULT_FONT_PX = 32;
export { END_CARD_SECONDS };

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
// Every entry now carries an explicit `role` (never auto-rotated) and, for
// any asset that appears more than once across this table (and/or
// HOOK_PRELOADED_USAGE below), an explicit `reuse_reason` on every
// occurrence sharing that asset -- task requirement: a second use of the
// same stock file is only allowed as a deliberate, named callback, never an
// unexplained repeat. No asset in this table is used a third time anywhere
// (verified by scripts/orvyq_duplicate_footage_audit.mjs).
export const FOOTAGE_ASSIGNMENTS = {
  CLM_003_GOVERNANCE_LAG: {
    0: { asset: "assets/footage/scene_001_52c2ebe35b131555e20a5ab5.mp4", trimInRatio: 0.12, motion: "drift_right", role: "context", reuse_reason: "Opening motion-hook clip returns once, later, under the governance-lag claim it originally introduced -- a direct visual callback to the film's own opening, not a new unrelated selection." }
  },
  CLM_004_AGENTIC_MISALIGNMENT_TEST: {
    0: { asset: "assets/footage/scene_022_740741da33e14d6a45468490.mp4", trimInRatio: 0.1, motion: "push", role: "context", reuse_reason: "Reused once more, at a different trim window, in the film's closing synthesis section (CLM_020), which explicitly recaps earlier evidence rather than introducing new claims." }
  },
  CLM_005_BLACKMAIL_SCENARIO: {
    0: { asset: "assets/footage/scene_012_d356fd9efe14c61c8594ff1f.mp4", trimInRatio: 0.12, motion: "hold", role: "context", reuse_reason: "A second, different trim window of the same clip is used later under CLM_017's open/closed governance framing; the two claims sit far apart in the film." }
  },
  CLM_006_NO_REAL_WORLD_INCIDENT: {
    0: { asset: "assets/footage/scene_013_d8d3231e6f0b69b7def0fd48.mp4", trimInRatio: 0.1, motion: "hold", role: "context", reuse_reason: "A later trim window of the same clip returns under CLM_011; both claims are part of the same controlled-evaluation evidence arc (SEC_02)." }
  },
  CLM_007_MARKET_PRESSURE: {
    // occurrence 0's real narration window contains the "But a fire drill
    // still tells you something about the building." editorial pause --
    // handled as a contiguous continuation shot (see the pause-insertion
    // pass below), not a second reference to the clip.
    0: { asset: "assets/footage/scene_009_8366baffbbfa53ec1a18715e.mp4", trimInRatio: 0.12, motion: "push", role: "context" },
    1: { asset: "assets/footage/scene_009_8366baffbbfa53ec1a18715e.mp4", trimInRatio: 0.55, motion: "pull", role: "context", reuse_reason: "Same clip, a different trim window, within this claim's own coverage -- not a repeat of the same visual moment shown once already." }
  },
  CLM_009_CYBER_EXTORTION: {
    0: { asset: "assets/footage/scene_017_17388828bde9ac80bd22eb8e.mp4", trimInRatio: 0.15, motion: "hold", role: "context", reuse_reason: "Returns from the opening motion hook under the cyber-extortion claim, at a distinct trim window." },
    // occurrence 1's real narration window contains the "Slowing down alone
    // doesn't remove the risk..." editorial pause -- a contiguous
    // continuation shot (scene_014 has ample room for slice+pause).
    // Without a break here, CLM_009's own claim runs uninterrupted for
    // 47.5s -- well past the 15s cap -- so this occurrence is not left on
    // its default treatment.
    1: { asset: "assets/footage/scene_014_416086d1c7285d9e6a01fc67.mp4", trimInRatio: 0.3, motion: "hold", role: "context", reuse_reason: "Second use at a different trim window; both this claim and CLM_018 (its later reuse) sit in the film's evidence-and-safeguards arc." },
    2: { asset: "assets/footage/scene_011_bff417a92fed9423fe0dd580.mp4", trimInRatio: 0.35, motion: "drift_left", role: "context", reuse_reason: "Returns from the opening motion hook under this claim's third occurrence, at a distinct trim window." }
  },
  CLM_011_BIO_SAFEGUARD_THRESHOLD: {
    0: { asset: "assets/footage/scene_013_d8d3231e6f0b69b7def0fd48.mp4", trimInRatio: 0.55, motion: "hold", role: "context", reuse_reason: "A later trim window of the same clip used for CLM_006; both claims belong to the same controlled-evaluation evidence arc (SEC_02)." },
    1: { asset: "assets/footage/scene_015_ed4bf30c1279d75b6cfe8187.mp4", trimInRatio: 0.5, motion: "hold", role: "context", reuse_reason: "Second use at a later trim window; both this claim and CLM_021 (its later reuse) sit in the same evidence arc." }
  },
  CLM_021_INFORMATION_INTEGRITY: {
    0: { asset: "assets/footage/scene_015_ed4bf30c1279d75b6cfe8187.mp4", trimInRatio: 0.12, motion: "hold", role: "context", reuse_reason: "Second use at a later trim window across two claims in the same evidence arc as CLM_011." },
    1: { asset: "assets/footage/scene_027_57a43a4f4b65321112dfb0bf.mp4", trimInRatio: 0.6, motion: "hold", role: "context", reuse_reason: "Second use at a different trim window; both this claim and CLM_018 (its other reuse) belong to the same evaluations/safeguards section." }
  },
  CLM_012_JOB_FORECAST_DIVERGENCE: {
    0: { asset: "assets/footage/scene_029_94d5bdac38165c3c273344f7.mp4", trimInRatio: 0.12, motion: "hold", role: "context", reuse_reason: "Second use lands on the film's own final editorial pause (CLM_020 occurrence 5), immediately before the last line -- a deliberate visual return to a job-market image as the film closes, not an incidental repeat." }
  },
  CLM_013_JOB_EXPOSURE: {
    0: { asset: "assets/footage/scene_020_820a251a5b10ad8f5a63266f.mp4", trimInRatio: 0.12, motion: "hold", role: "context", reuse_reason: "Second use at a different trim window across two related governance/labor claims (this one and CLM_015)." }
  },
  CLM_015_EU_SYSTEMIC_RISK_THRESHOLD: {
    // occurrence 0's real narration window contains the "It's about who
    // gets to decide." editorial pause -- a contiguous continuation shot,
    // same as CLM_007 occurrence 0 above.
    0: { asset: "assets/footage/scene_020_820a251a5b10ad8f5a63266f.mp4", trimInRatio: 0.08, motion: "hold", role: "context", reuse_reason: "Second use at a different trim window across two related governance/labor claims (this one and CLM_013)." },
    1: { asset: "assets/footage/scene_021_d2e9e57773ef446f8e402456.mp4", trimInRatio: 0.12, motion: "hold", role: "context", reuse_reason: "Reused once more in the closing synthesis section (CLM_020), which explicitly recaps earlier evidence rather than introducing new claims." },
    2: { asset: "assets/footage/scene_019_bdc83a162db95b4b9eba43f9.mp4", trimInRatio: 0.12, motion: "drift_left", role: "context", reuse_reason: "Reused once more in the closing synthesis section (CLM_020), which explicitly recaps earlier evidence rather than introducing new claims." }
  },
  CLM_016_COMPLIANCE_INCUMBENCY: {
    0: { asset: "assets/footage/scene_018_f681c3057e36f147005d2652.mp4", trimInRatio: 0.12, motion: "hold", role: "context", reuse_reason: "Reused once more in the closing synthesis section (CLM_020), which explicitly recaps earlier evidence rather than introducing new claims." }
  },
  CLM_017_OPEN_CLOSED_TRADEOFF: {
    0: { asset: "assets/footage/scene_012_d356fd9efe14c61c8594ff1f.mp4", trimInRatio: 0.55, motion: "pull", role: "context", reuse_reason: "A second, different trim window of the clip used earlier for CLM_005; the two claims sit far apart in the film." },
    1: { asset: "assets/footage/scene_003_d69cde76dfac1e29bd6f9946.mp4", trimInRatio: 0.12, motion: "hold", role: "context", reuse_reason: "Second use at a different trim window across two claims in the same governance arc (this one and CLM_018)." }
  },
  CLM_018_INDEPENDENT_EVALUATIONS: {
    0: { asset: "assets/footage/scene_027_57a43a4f4b65321112dfb0bf.mp4", trimInRatio: 0.12, motion: "hold", role: "context", reuse_reason: "Second use at a different trim window; both this claim and CLM_021 (its other reuse) belong to the same evaluations/safeguards section." },
    // scene_024's monitoring-room footage (its second, brief use beyond the
    // shared motion hook) fits "a second set of eyes" directly.
    1: { asset: "assets/footage/scene_024_6e6f4af26cad60cc78930d6d.mp4", trimInRatio: 0.06, motion: "hold", role: "context", reuse_reason: "Second, brief use of the shared monitoring-room motion-hook footage -- fits 'a second set of eyes' directly." },
    2: { asset: "assets/footage/scene_014_416086d1c7285d9e6a01fc67.mp4", trimInRatio: 0.12, motion: "drift_right", role: "context", reuse_reason: "Second use at a different trim window; both this claim and CLM_009 (its other reuse) sit in the film's evidence-and-safeguards arc." },
    3: { asset: "assets/footage/scene_003_d69cde76dfac1e29bd6f9946.mp4", trimInRatio: 0.55, motion: "hold", role: "context", reuse_reason: "Second use at a different trim window across two claims in the same governance arc (this one and CLM_017)." }
  },
  CLM_020_SYSTEMIC_INCENTIVE_FINAL: {
    0: { asset: "assets/footage/scene_019_bdc83a162db95b4b9eba43f9.mp4", trimInRatio: 0.55, motion: "hold", role: "context", reuse_reason: "This is the film's closing synthesis claim (see evidence_requirements: 'a recap ... rather than a new factual claim'), so all five footage occurrences here are deliberate visual recaps of earlier evidence, not new selections." },
    1: { asset: "assets/footage/scene_018_f681c3057e36f147005d2652.mp4", trimInRatio: 0.55, motion: "hold", role: "context", reuse_reason: "Closing synthesis recap of CLM_016's footage -- see occurrence 0's note." },
    2: { asset: "assets/footage/scene_022_740741da33e14d6a45468490.mp4", trimInRatio: 0.55, motion: "push", role: "context", reuse_reason: "Closing synthesis recap of CLM_004's footage -- see occurrence 0's note." },
    3: { asset: "assets/footage/scene_021_d2e9e57773ef446f8e402456.mp4", trimInRatio: 0.55, motion: "hold", role: "context", reuse_reason: "Closing synthesis recap of CLM_015's footage -- see occurrence 0's note." },
    // occurrence 4 is deliberately left unassigned: this claim's own runs
    // are already kept under the uninterrupted-evidence cap by occurrences
    // 0/1/2/3/5; scripts/orvyq_duplicate_footage_audit.mjs and the
    // uninterrupted-evidence-run check (below) both fail loudly, rather
    // than silently backfilling, if that ever stops being true.
    // occurrence 5's real narration window contains the film's own final
    // editorial pause ("That work hasn't been done yet.") right up against
    // the last word of narration -- a contiguous continuation shot.
    5: { asset: "assets/footage/scene_029_94d5bdac38165c3c273344f7.mp4", trimInRatio: 0.45, motion: "hold", role: "context", reuse_reason: "Closing synthesis recap of CLM_012's footage, deliberately timed to land on the film's final editorial pause -- see occurrence 0's note." }
  }
};

// The full catalog of licensed footage clips materialized by
// scripts/orvyq_materialize_footage.mjs and inspected frame-by-frame before
// any use (see the commit message). This is documentation of what is
// licensed and available, used by scripts/orvyq_duplicate_footage_audit.mjs
// and the missing-coverage report below to know which additional clips a
// human editor could still hand-assign -- it is NOT consulted by this script
// to pick footage automatically. Every clip that actually appears in the
// candidate must come from an explicit FOOTAGE_ASSIGNMENTS entry; a claim
// window with no such entry renders as ordinary evidence, and an
// uninterrupted-evidence run that exceeds the cap with no assignment inside
// it fails the build with a report, rather than being silently patched from
// this list.
export const FULL_FOOTAGE_POOL = [
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
export const HOOK_PRELOADED_USAGE = {
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

// Splits one claim's real coverage window into the minimum number of
// equal-length slices needed to keep every slice at or under
// maxShotSeconds -- a technical necessity (the renderer/schema cap a single
// shot's length), not a creative decision. There is deliberately no
// artificial duration jitter here: two adjacent claims of different real
// lengths already produce different slice durations, and a claim that
// legitimately needs 3+ equal-length slices is allowed to have them --
// scripts/orvyq_pacing_audit.mjs's "no 3 identical durations in a row" rule
// is enforced honestly against whatever this produces, not gamed by nudging
// durations a few frames in either direction.
//
// Every slice defaults to plain "evidence" (this claim's own primary
// visual_treatment, via kindFor) -- there is no automatic evidence -> context
// -> metaphor rotation and no automatic "boundary" tension card. A slice
// only becomes footage/context if buildFullProductionPlan finds a matching,
// hand-authored FOOTAGE_ASSIGNMENTS entry for it (see footageCandidateSlot
// below); everything else stays real, source-backed evidence.
export function sliceClaimWindow(claim, coverStart, coverEnd, maxShotSeconds) {
  const duration = coverEnd - coverStart;
  const sliceCount = Math.max(1, Math.ceil(duration / Math.min(maxShotSeconds, TARGET_SHOT_SECONDS + 2)));
  const sliceSeconds = duration / sliceCount;
  const slices = [];
  let cursor = coverStart;
  for (let i = 0; i < sliceCount; i += 1) {
    const start = cursor;
    const end = i === sliceCount - 1 ? coverEnd : cursor + sliceSeconds;
    cursor = end;
    slices.push({
      start,
      end,
      kind: kindFor(claim.visual_treatment?.primary),
      // A stable, deterministic position (every third slice, 0-based index
      // 2/5/8/...) that FOOTAGE_ASSIGNMENTS' existing occurrence numbering
      // targets -- preserved only so the human-authored footage placements
      // already chosen against real narration content keep landing at the
      // same point in each claim's coverage window as before. This index no
      // longer implies any visual decision by itself (contrast the removed
      // roleRotation/kindRotation): a footageCandidateSlot with no matching
      // FOOTAGE_ASSIGNMENTS entry is still ordinary "evidence", never an
      // automatic "metaphor" role or "boundary" graphic.
      footageCandidateSlot: i % 3 === 2
    });
  }
  return slices;
}

// Snaps every shot's duration to an exact frame boundary, and footage
// trims to match -- mutates `shots` in place and returns it.
//
// buildCanonicalEditPlan (scripts/orvyq_edit_plan.mjs) assigns every shot's
// start_frame/end_frame from a single cumulative Math.round(cursor * FPS)
// walk across the WHOLE film -- cursor itself is a running float, never
// itself rounded, only the frame numbers read off it are. A shot's own
// float `duration` can therefore drift from its real on-screen
// (frame-quantized) length by up to half a frame at each of its two
// boundaries, and those two independent roundings can combine to exceed
// scripts/orvyq_edit_plan_tests.mjs's 0.02s footage trim-vs-actual-length
// tolerance even when buildCanonicalEditPlan's own single-shot check (trim
// vs. the float duration alone, same 0.02s tolerance) already passed --
// both checks cannot be satisfied at once while `duration` itself carries
// sub-frame drift.
//
// The real fix is upstream of trims: round(x + n) = round(x) + n for any
// integer n, so once a shot's OWN `duration` is itself an exact whole
// number of frames, its contribution to ANY later cumulative
// Math.round(cursor * FPS) boundary is exactly that many frames --
// regardless of the cursor's value when this shot starts, including
// sub-frame drift already carried in from any untouched shots earlier in
// the same film (e.g. the real, separately-curated motion_hook.json
// footage that precedes `shots` in the final full_production.shots array).
// Using the exact float frames/fps here (not rounded to milliseconds)
// matters: rounding `duration` itself to 3 decimals would reintroduce a
// smaller version of the same cumulative-drift problem across 100+ shots.
export function quantizeShotsToFrames(shots, fps = FPS) {
  for (const shot of shots) {
    const frames = Math.round(shot.duration * fps);
    shot.duration = frames / fps;
    if (shot.asset_type === "footage") shot.trim_out_sec = Math.round((shot.trim_in_sec + frames / fps) * 1000) / 1000;
  }
  return shots;
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
    let footageOccurrence = 0;
    for (const [sliceIndex, slice] of slices.entries()) {
      const footageAssignment = slice.footageCandidateSlot ? FOOTAGE_ASSIGNMENTS[window.claim.claim_id]?.[footageOccurrence] : undefined;
      if (slice.footageCandidateSlot) footageOccurrence += 1;
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
          role: footageAssignment.role || "context",
          reuseReason: footageAssignment.reuse_reason || null,
          asset: footageAssignment.asset,
          trimInSec: trimIn,
          trimOutSec: Math.round((trimIn + sliceDuration) * 1000) / 1000,
          motion: footageAssignment.motion,
          dissolveIn: isFirstWindowOverall && sliceIndex === 0
        });
        if (deferTitleCard && sliceIndex === 0) rawShots.push(titleCardShot);
        continue;
      }
      // No authored footage assignment for this slice: it stays ordinary,
      // source-backed evidence -- never an automatic "metaphor" role or
      // "boundary" graphic (see sliceClaimWindow's docstring above).
      rawShots.push({
        kind: "evidence",
        evidenceKind: slice.kind,
        section_id: window.claim.section_id,
        claim_id: window.claim.claim_id,
        start: slice.start,
        end: slice.end,
        role: "evidence",
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
  // research/evidence_map.json's own sections[] (title + dramatic_function),
  // NOT blueprint.full_production.sections (which only carries
  // target_seconds/music_state/visual_strategy/deliverables) -- the two
  // arrays share section_id keys but not shape.
  const sectionById = new Map(evidenceMap.sections.map((s) => [s.section_id, s]));
  const sourceById = new Map(evidenceMap.source_catalog.map((s) => [s.source_id, s]));
  // Counts how many shots have already been built for one (claim_id, kind)
  // pair so buildEvidenceContent can rotate which real fact leads each
  // repeat shot's eyebrow/title/body -- see scripts/lib/orvyq-evidence-
  // authoring.mjs. Keyed on the pair, not just claim_id, since a claim's
  // primary/secondary kinds are authored independently of each other.
  const evidenceOccurrenceByClaimKind = new Map();
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
      ...(shot.emphasis
        ? {
            emphasis_card: { eyebrow: (shot.emphasis.purpose || "EMPHASIS").toUpperCase().slice(0, 60), title: shot.emphasis.anchor_text, accent: null },
            // The real, authored sound cue for this exact pause anchor
            // (direction/editorial_pause_map.json's full_film_pause_anchors,
            // threaded through by resolveFullFilmPauses) -- not previously
            // carried from here into the blueprint shot spec at all, which
            // is why buildCanonicalEditPlan (scripts/orvyq_edit_plan.mjs)
            // had nothing to read and hardcoded sound_cue to null for every
            // shot, including emphasis beats that scripts/orvyq_edit_plan_
            // tests.mjs requires to carry a real "low_impact"/"tonal_bloom"
            // cue.
            sound_cue: shot.emphasis.sound_cue
          }
        : {}),
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
        generic_stock: true,
        ...(shot.reuseReason ? { reuse_reason: shot.reuseReason } : {})
      };
    }
    const claim = usableClaims.find((c) => c.claim_id === shot.claim_id);
    const ownSourceIds = (claim.source_ids || []).filter((id) => validSourceIds.has(id));
    const isRecap = ownSourceIds.length === 0;
    const sourceIds = isRecap ? recapSourceIds : ownSourceIds;
    const occurrenceKey = `${shot.claim_id}:${shot.evidenceKind}`;
    const occurrence = evidenceOccurrenceByClaimKind.get(occurrenceKey) || 0;
    evidenceOccurrenceByClaimKind.set(occurrenceKey, occurrence + 1);
    const content = buildEvidenceContent({
      claim,
      kind: shot.evidenceKind,
      role: shot.role,
      displaySources: sourceIds.map((id) => sourceById.get(id)).filter(Boolean),
      ownSources: ownSourceIds.map((id) => sourceById.get(id)).filter(Boolean),
      section: sectionById.get(shot.section_id),
      occurrence
    });
    return {
      ...base,
      asset_type: "evidence",
      evidence: {
        kind: shot.evidenceKind,
        source_ids: sourceIds,
        source_label: isRecap ? "Multiple verified sources (recap)" : evidenceMap.source_catalog.find((s) => s.source_id === ownSourceIds[0])?.publisher || "Source",
        font_px: DEFAULT_FONT_PX,
        ...content
      }
    };
  });

  // ---- audit-only: uninterrupted evidence runs and pause placement ----
  // No automatic conversion happens here anymore -- there is no footage pool
  // to draw from and no graphic-tension-card fallback. Both checks are
  // read-only: if the film's real, hand-authored FOOTAGE_ASSIGNMENTS
  // coverage is not enough to keep every evidence run under the cap, or to
  // land every narration pause on footage, the build fails with a specific,
  // actionable report (claim_id + real time window) instead of silently
  // inventing a fix. A human editor resolves this by adding a
  // FOOTAGE_ASSIGNMENTS entry (or, if the licensed pool genuinely lacks a
  // fitting clip, by acquiring one) -- not by re-running this script.
  const MAX_EVIDENCE_RUN_SECONDS = Number(blueprint.global_rules?.max_uninterrupted_evidence_seconds) || 15;
  const missingCoverage = [];

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
    if (runSeconds > MAX_EVIDENCE_RUN_SECONDS) {
      const first = shots[runStartIndex];
      const last = shots[i];
      missingCoverage.push(
        `Uninterrupted evidence run of ${runSeconds.toFixed(1)}s (> ${MAX_EVIDENCE_RUN_SECONDS}s cap) from ${first.shot_id || first.claim_id} to ${last.shot_id || last.claim_id} ` +
          `(claims ${[...new Set(shots.slice(runStartIndex, i + 1).map((s) => s.claim_id))].join(", ")}) has no FOOTAGE_ASSIGNMENTS entry to break it up -- ` +
          "add an authored footage assignment inside this window, or acquire an additional licensed clip if the pool has none left to assign."
      );
      runSeconds = 0;
      runStartIndex = i + 1;
    }
  }

  // A pause must land on footage (the picture holds still and breathes;
  // scripts/orvyq_edit_plan_tests.mjs requires every emphasis_card shot to
  // be asset_type "footage") -- report any pause that doesn't, rather than
  // auto-converting it.
  for (const shot of shots) {
    if (shot.emphasis_card && shot.asset_type !== "footage") {
      missingCoverage.push(
        `Editorial pause "${shot.emphasis_card.title}" (claim ${shot.claim_id}) lands on a ${shot.asset_type} shot, not footage -- ` +
          "add a FOOTAGE_ASSIGNMENTS entry for this claim occurrence so the pause holds on real footage instead of an evidence/graphic card."
      );
    }
  }

  if (missingCoverage.length) {
    throw new Error(`Full production plan has ${missingCoverage.length} unresolved creative-coverage gap(s):\n- ${missingCoverage.join("\n- ")}`);
  }

  quantizeShotsToFrames(shots);

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
