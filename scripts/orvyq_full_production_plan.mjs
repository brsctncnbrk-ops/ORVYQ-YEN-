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
// commit the opening motion hook already uses) to specific (claim_id,
// sliceIndex) pairs -- any slice of any claim's own coverage window is
// directly addressable, not restricted to a fixed positional pattern (see
// sliceClaimWindow/FOOTAGE_ASSIGNMENTS below). There is no automatic
// backfill: a long uninterrupted evidence/graphic run or an editorial pause
// that doesn't land on footage fails the build with a specific report
// (below) rather than being silently patched from FULL_FOOTAGE_POOL, which
// is documentation of the licensed catalog only. Every other claim beat is
// rendered as asset_type "evidence" using a NATIVE_KINDS kind (concept_map,
// comparison, evidence_chain, boundary, source_timeline, source_article) --
// derived from that claim's own visual_treatment.{primary,secondary,metaphor}
// fields, which are real editorial content already present in the resolved
// evidence map, not invented here. Each section opens with a short graphic
// title card. This produces a schema-valid, gap-free, zero-placeholder full
// shot list with real contextual footage across the whole film, not just an
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
// entry replaces ONE SPECIFIC, hand-chosen slice of a real claim's own
// coverage window with one of the licensed contextual footage clips
// materialized by scripts/orvyq_materialize_footage.mjs, trimmed to that
// slice's exact real duration.
//
// Keyed by (claim_id, sliceIndex) -- sliceIndex is the claim's own slice's
// raw 0-based position in the array sliceClaimWindow() returns for that
// claim, exactly as buildFullProductionPlan enumerates it. This used to be
// gated by a fixed "every third slice" positional rule
// (`footageCandidateSlot: i % 3 === 2`) -- footage could only ever land on
// slice 2, 5, 8, ...  regardless of which slice actually needed it. That
// mechanism has been removed: any slice of any claim is now directly
// addressable here, so a coverage gap (an uninterrupted-evidence run over
// the cap, or a pause that doesn't land on footage) is closed by adding a
// real assignment at the slice that actually needs one, not by hoping a
// human-authored occurrence happens to fall on a multiple-of-three slot.
// The table's pre-existing entries were remapped from their old
// occurrence-among-candidates numbering to their real, unchanged slice
// index (old occurrence k landed on slice 3k+2 under the removed rule) --
// every one of them still lands on the exact same real footage, at the
// exact same real narration moment, as before.
//
// `trimInRatio` picks where in the source clip's real duration this use
// starts; a clip used twice uses two different windows of it, never the
// same footage twice in the same moment. Every asset referenced here was
// inspected frame-by-frame (see the commit message) before assignment, not
// chosen by filename order. Every entry carries an explicit `role` (never
// auto-rotated) and, for any asset that appears more than once across this
// table (and/or HOOK_PRELOADED_USAGE below), an explicit `reuse_reason` on
// every occurrence sharing that asset -- a second use of the same stock
// file is only allowed as a deliberate, named callback, never an
// unexplained repeat (verified by scripts/orvyq_duplicate_footage_audit.mjs).
export const FOOTAGE_ASSIGNMENTS = {
  CLM_003_GOVERNANCE_LAG: {
    // Spans slices 0-2 with one continuous pass through the opening
    // motion-hook clip (task follow-up section 17): CLM_001+CLM_002's own
    // combined evidence run (14.9s) is already close to the 15s cap, so
    // CLM_003's own opening slice must be footage too, not just its third
    // slice, to avoid a real uninterrupted-evidence violation spanning
    // three claims. One continuous trim (not three separate uses) keeps
    // this within the asset's own max_uses_per_source budget.
    0: { asset: "assets/footage/scene_001_52c2ebe35b131555e20a5ab5.mp4", trimInRatio: 0.03, span: 3, motion: "drift_right", role: "context", reuse_reason: "Opening motion-hook clip returns once, later, under the governance-lag claim it originally introduced -- a direct visual callback to the film's own opening, not a new unrelated selection." }
  },
  CLM_004_AGENTIC_MISALIGNMENT_TEST: {
    // First amber-labeled "controlled evaluation" testing-room footage
    // (direction/direction_plan.md's own scene_004 description) -- this
    // claim IS that introduction, and this slice is also where the claim's
    // own editorial pause lands, so it must be footage regardless.
    // Real materialized duration of scene_004 (10.09s) is not long enough
    // to host both this slice (6.635s) and the editorial pause that lands
    // inside it (4s continuation of the same asset, 10.635s total needed)
    // -- confirmed live via CI's real footage_duration_report.json, not a
    // guess. scene_010 (abstract connective beat, no real-world entity
    // implied per direction/direction_plan.md) has ample real duration for
    // both.
    0: { asset: "assets/footage/scene_010_6f7bc11f2a696985af0db15f.mp4", trimInRatio: 0, motion: "push", role: "context" },
    2: { asset: "assets/footage/scene_022_740741da33e14d6a45468490.mp4", trimInRatio: 0.1, motion: "push", role: "context", reuse_reason: "Reused once more, at a different trim window, in the film's closing synthesis section (CLM_020), which explicitly recaps earlier evidence rather than introducing new claims." }
  },
  CLM_005_BLACKMAIL_SCENARIO: {
    // direction_plan.md's own scene_005 description is this exact claim:
    // "Depict the reported blackmail-style test case" / "the film's single
    // most sensitive reconstruction."
    0: { asset: "assets/footage/scene_005_e98a421f0d9c432e4d2036fb.mp4", trimInRatio: 0.1, motion: "hold", role: "context" },
    2: { asset: "assets/footage/scene_012_d356fd9efe14c61c8594ff1f.mp4", trimInRatio: 0.12, motion: "hold", role: "context", reuse_reason: "A second, different trim window of the same clip is used later under CLM_017's open/closed governance framing; the two claims sit far apart in the film." }
  },
  CLM_006_NO_REAL_WORLD_INCIDENT: {
    2: { asset: "assets/footage/scene_013_d8d3231e6f0b69b7def0fd48.mp4", trimInRatio: 0.1, motion: "hold", role: "context", reuse_reason: "A later trim window of the same clip returns under CLM_011; both claims are part of the same controlled-evaluation evidence arc (SEC_02)." }
  },
  CLM_007_MARKET_PRESSURE: {
    // slice 2's real narration window contains the "But a fire drill still
    // tells you something about the building." editorial pause -- handled
    // as a contiguous continuation shot (see the pause-insertion pass
    // below), not a second reference to the clip.
    2: { asset: "assets/footage/scene_009_8366baffbbfa53ec1a18715e.mp4", trimInRatio: 0.12, motion: "push", role: "context" },
    5: { asset: "assets/footage/scene_009_8366baffbbfa53ec1a18715e.mp4", trimInRatio: 0.55, motion: "pull", role: "context", reuse_reason: "Same clip, a different trim window, within this claim's own coverage -- not a repeat of the same visual moment shown once already." }
  },
  CLM_009_CYBER_EXTORTION: {
    // Spans slices 1-2 with one continuous pass (task follow-up section
    // 17): this claim's own slice width (7.7s) means any two adjacent
    // non-footage slices already exceed the 15s cap on their own, so a
    // single third-of-the-way footage slice is not enough by itself.
    1: { asset: "assets/footage/scene_017_17388828bde9ac80bd22eb8e.mp4", trimInRatio: 0.1, span: 2, motion: "hold", role: "context", reuse_reason: "Returns from the opening motion hook under the cyber-extortion claim, at a distinct trim window." },
    // Slice 5 (the last slice of this span) is where the "Land the
    // competitive incentive" editorial pause lands -- a real editorial
    // pause continues its enclosing slice's own asset from wherever that
    // slice's own trim ends, so this span's real source duration must cover
    // BOTH slices 4-5 AND the pause's own held duration, not just the two
    // slices alone (task follow-up section 17/19 -- confirmed live via a
    // real footage-trim-overrun CI failure at a different, tighter-margin
    // clip; scene_026's real duration comfortably covers this one).
    4: { asset: "assets/footage/scene_026_8a460acd7183fb80baaa455e.mp4", trimInRatio: 0.02, span: 2, motion: "hold", role: "context" },
    // Slice 7 is where the "Pivot from strategic pressure to documented
    // misuse" editorial pause lands -- same real-duration-must-cover-the-
    // pause-too requirement as slice 5 above; scene_006 (this claim's
    // original choice) was NOT long enough for slice 7 + Its own pause once
    // materialized for real (confirmed via CI), so this uses scene_014
    // instead (freed up here since it now only carries CLM_018's own
    // separate use, still within its 2-use budget).
    7: { asset: "assets/footage/scene_014_416086d1c7285d9e6a01fc67.mp4", trimInRatio: 0.1, motion: "hold", role: "context" },
    8: { asset: "assets/footage/scene_011_bff417a92fed9423fe0dd580.mp4", trimInRatio: 0.35, motion: "drift_left", role: "context", reuse_reason: "Returns from the opening motion hook under this claim's third footage slice, at a distinct trim window." }
  },
  CLM_010_CYBER_ESPIONAGE: {
    // Only slice 1 (of this claim's own 2 slices) becomes footage, breaking
    // the run into CLM_011's own dense evidence arc. Slice 0 is deliberately
    // left at its default (this claim's own visual_treatment.primary,
    // "campaign_phase_diagram" -> real source-backed "evidence_chain") --
    // this is a critical (importance 5), source-attributed claim
    // (SRC_ANTHROPIC_ESPIONAGE_2025), and scripts/orvyq_evidence_audit.mjs
    // hard-requires at least one physical, source-backed evidence shot per
    // critical claim; making BOTH slices footage (the original span:2 pass)
    // left this claim with zero evidence shots and failed that audit in
    // real CI (confirmed: "CLM_010_CYBER_ESPIONAGE has no physical,
    // source-backed visual evidence").
    1: { asset: "assets/footage/scene_026_8a460acd7183fb80baaa455e.mp4", trimInRatio: 0.05, motion: "hold", role: "context" }
  },
  CLM_011_BIO_SAFEGUARD_THRESHOLD: {
    2: { asset: "assets/footage/scene_013_d8d3231e6f0b69b7def0fd48.mp4", trimInRatio: 0.55, motion: "hold", role: "context", reuse_reason: "A later trim window of the same clip used for CLM_006; both claims belong to the same controlled-evaluation evidence arc (SEC_02)." },
    // Spans slices 5-6 with one continuous pass so the claim's own final
    // two slices (otherwise both evidence) don't chain into CLM_021's
    // opening slices as one long uninterrupted run.
    5: { asset: "assets/footage/scene_015_ed4bf30c1279d75b6cfe8187.mp4", trimInRatio: 0.05, span: 2, motion: "hold", role: "context", reuse_reason: "Second use at a later trim window; both this claim and CLM_021 (its later reuse) sit in the same evidence arc." },
    // This claim's own final slice, immediately before CLM_021 begins --
    // without it, CLM_011's last slice chains into CLM_021's first two
    // slices as one uninterrupted run past the cap.
    7: { asset: "assets/footage/scene_006_7e0d77fb76615c10d441204a.mp4", trimInRatio: 0.3, motion: "hold", role: "context", reuse_reason: "Second use at a different trim window; the same designed-test-vs-real-incident framing (CLM_009's own use of this clip) recurs here for the bio-safeguard claim." }
  },
  CLM_021_INFORMATION_INTEGRITY: {
    2: { asset: "assets/footage/scene_015_ed4bf30c1279d75b6cfe8187.mp4", trimInRatio: 0.12, motion: "hold", role: "context", reuse_reason: "Second use at a later trim window across two claims in the same evidence arc as CLM_011." },
    5: { asset: "assets/footage/scene_027_57a43a4f4b65321112dfb0bf.mp4", trimInRatio: 0.6, motion: "hold", role: "context", reuse_reason: "Second use at a different trim window; both this claim and CLM_018 (its other reuse) belong to the same evaluations/safeguards section." }
  },
  CLM_012_JOB_FORECAST_DIVERGENCE: {
    // This 2-slice claim's own footage assignment used to be keyed to an
    // occurrence number (the old i%3==2 rule's "occurrence 0") that
    // resolved to slice index 2 -- an index this 2-slice claim (indices 0
    // and 1 only) never actually has, so the assignment silently never
    // fired. Corrected to its real, existing slice index (task follow-up
    // section 17); same asset, same creative intent.
    1: { asset: "assets/footage/scene_029_94d5bdac38165c3c273344f7.mp4", trimInRatio: 0.12, motion: "hold", role: "context", reuse_reason: "Second use lands on the film's own final editorial pause (CLM_020 slice 13), immediately before the last line -- a deliberate visual return to a job-market image as the film closes, not an incidental repeat." }
  },
  CLM_013_JOB_EXPOSURE: {
    // Spans slices 2-3 (this claim's last two slices) so its own tail
    // doesn't chain into CLM_014 (which has no footage of its own) as one
    // long uninterrupted run.
    2: { asset: "assets/footage/scene_020_820a251a5b10ad8f5a63266f.mp4", trimInRatio: 0.12, span: 2, motion: "hold", role: "context", reuse_reason: "Second use at a different trim window across two related governance/labor claims (this one and CLM_015)." }
  },
  CLM_015_EU_SYSTEMIC_RISK_THRESHOLD: {
    // slice 2's real narration window contains the "It's about who gets to
    // decide." editorial pause -- a contiguous continuation shot, same as
    // CLM_007 slice 2 above.
    2: { asset: "assets/footage/scene_020_820a251a5b10ad8f5a63266f.mp4", trimInRatio: 0.08, motion: "hold", role: "context", reuse_reason: "Second use at a different trim window across two related governance/labor claims (this one and CLM_013)." },
    5: { asset: "assets/footage/scene_021_d2e9e57773ef446f8e402456.mp4", trimInRatio: 0.12, motion: "hold", role: "context", reuse_reason: "Reused once more in the closing synthesis section (CLM_020), which explicitly recaps earlier evidence rather than introducing new claims." },
    8: { asset: "assets/footage/scene_019_bdc83a162db95b4b9eba43f9.mp4", trimInRatio: 0.12, motion: "drift_left", role: "context", reuse_reason: "Reused once more in the closing synthesis section (CLM_020), which explicitly recaps earlier evidence rather than introducing new claims." }
  },
  CLM_016_COMPLIANCE_INCUMBENCY: {
    2: { asset: "assets/footage/scene_018_f681c3057e36f147005d2652.mp4", trimInRatio: 0.12, motion: "hold", role: "context", reuse_reason: "Reused once more in the closing synthesis section (CLM_020), which explicitly recaps earlier evidence rather than introducing new claims." }
  },
  CLM_017_OPEN_CLOSED_TRADEOFF: {
    2: { asset: "assets/footage/scene_012_d356fd9efe14c61c8594ff1f.mp4", trimInRatio: 0.55, motion: "pull", role: "context", reuse_reason: "A second, different trim window of the clip used earlier for CLM_005; the two claims sit far apart in the film." },
    5: { asset: "assets/footage/scene_003_d69cde76dfac1e29bd6f9946.mp4", trimInRatio: 0.12, motion: "hold", role: "context", reuse_reason: "Second use at a different trim window across two claims in the same governance arc (this one and CLM_018)." }
  },
  CLM_018_INDEPENDENT_EVALUATIONS: {
    // Spans slices 1-2 with one continuous pass through the auditors
    // clip -- see CLM_009's own note on why a single third-of-the-way slice
    // is not enough once a claim's own slice width sits close to half the
    // evidence-run cap.
    1: { asset: "assets/footage/scene_027_57a43a4f4b65321112dfb0bf.mp4", trimInRatio: 0.12, span: 2, motion: "hold", role: "context", reuse_reason: "Second use at a different trim window; both this claim and CLM_021 (its other reuse) belong to the same evaluations/safeguards section." },
    // Independent-researchers/open-repo footage -- direction_plan.md's own
    // scene_023 description -- fits "independent evaluations" directly.
    4: { asset: "assets/footage/scene_023_dbe758e1473aee29a155377a.mp4", trimInRatio: 0.1, motion: "cut", role: "context" },
    // scene_024's monitoring-room footage (its second, brief use beyond the
    // shared motion hook) fits "a second set of eyes" directly.
    5: { asset: "assets/footage/scene_024_6e6f4af26cad60cc78930d6d.mp4", trimInRatio: 0.06, motion: "hold", role: "context", reuse_reason: "Second, brief use of the shared monitoring-room motion-hook footage -- fits 'a second set of eyes' directly." },
    7: { asset: "assets/footage/scene_014_416086d1c7285d9e6a01fc67.mp4", trimInRatio: 0.05, span: 2, motion: "drift_right", role: "context", reuse_reason: "Second use at a different trim window; both this claim and CLM_009 (its other reuse) sit in the film's evidence-and-safeguards arc." },
    // Slice 9 stands alone (7.6s, under the cap by itself, between slice
    // 8's footage and slice 10's footage below) -- no assignment needed.
    // Slice 10 alone is where this claim's own editorial pause ("Hold the
    // open-versus-closed dilemma...") lands: a pause becomes its own
    // contiguous continuation shot on whatever asset its enclosing slice
    // used, so that slice's real source duration must cover BOTH the slice
    // itself AND the pause's own held duration -- confirmed via a real
    // footage-trim-overrun CI failure at a different clip (task follow-up
    // section 17/19); a single (not spanning) slice here keeps the real
    // duration this needs modest enough for scene_003 to comfortably cover.
    10: { asset: "assets/footage/scene_003_d69cde76dfac1e29bd6f9946.mp4", trimInRatio: 0.05, motion: "hold", role: "context", reuse_reason: "Second use at a different trim window across two claims in the same governance arc (this one and CLM_017)." },
    // A separate, non-contiguous second use of the independent-researchers
    // clip already introduced at slice 4 above -- this slice sits right
    // after the slice-9/10 span ends on the claim's own pause, so it cannot
    // itself continue that span's trim.
    11: { asset: "assets/footage/scene_023_dbe758e1473aee29a155377a.mp4", trimInRatio: 0.6, motion: "cut", role: "context", reuse_reason: "Second use at a different trim window, within this claim's own coverage -- not a repeat of the same visual moment shown once already." }
  },
  CLM_019_INCIDENT_REPORTING: {
    // This 2-slice claim's tail slice must be footage -- otherwise CLM_018's
    // own final (already-covered) slice plus this claim's evidence chains
    // into one long uninterrupted run.
    1: { asset: "assets/footage/scene_016_e324304f99b3502cad464d69.mp4", trimInRatio: 0.05, motion: "hold", role: "context", reuse_reason: "Second use, different trim window; a brief connective visual beat within the safety-architecture section, same as its first use under CLM_018's own final-evaluations slice." }
  },
  CLM_020_SYSTEMIC_INCENTIVE_FINAL: {
    // Every footage entry below spans 2-4 contiguous slices (one continuous
    // pass per clip, task follow-up section 17) rather than a single
    // isolated slice: this is the film's longest single claim (~134s,
    // 17 slices at this claim's own slice width), and a footage slice only
    // once every three slices (the old i%3==2 rule) always left two
    // adjacent evidence slices in between -- which, at this claim's own
    // slice width, always exceeds the 15s uninterrupted-evidence cap on its
    // own. Spanning multiple contiguous slices per real clip (each still
    // one continuous, single use of that asset) closes every one of those
    // gaps without needing additional distinct licensed clips beyond the
    // five this claim's own closing-synthesis recap already uses.
    1: { asset: "assets/footage/scene_019_bdc83a162db95b4b9eba43f9.mp4", trimInRatio: 0.05, span: 2, motion: "hold", role: "context", reuse_reason: "This is the film's closing synthesis claim (see evidence_requirements: 'a recap ... rather than a new factual claim'), so all footage slices here are deliberate visual recaps of earlier evidence, not new selections." },
    4: { asset: "assets/footage/scene_018_f681c3057e36f147005d2652.mp4", trimInRatio: 0.02, span: 2, motion: "hold", role: "context", reuse_reason: "Closing synthesis recap of CLM_016's footage -- see slice 1's note." },
    7: { asset: "assets/footage/scene_022_740741da33e14d6a45468490.mp4", trimInRatio: 0.02, span: 3, motion: "push", role: "context", reuse_reason: "Closing synthesis recap of CLM_004's footage -- see slice 1's note." },
    11: { asset: "assets/footage/scene_021_d2e9e57773ef446f8e402456.mp4", trimInRatio: 0.45, motion: "hold", role: "context", reuse_reason: "Closing synthesis recap of CLM_015's footage -- see slice 1's note." },
    // Slice 12 stands alone (under the cap by itself, between slice 11's
    // footage and slice 13's footage below) -- no assignment needed.
    // Slice 13 alone closes the run before the final span; a fresh,
    // ample-duration clip, not extended into 14 (kept separate from the
    // pause-hosting span below -- see its own note on why real duration
    // must cover the pause too, not just the covered slices).
    13: { asset: "assets/footage/scene_010_6f7bc11f2a696985af0db15f.mp4", trimInRatio: 0.3, motion: "hold", role: "context", reuse_reason: "Second use, different trim window; another brief abstract connective beat within the closing synthesis, same as its first use earlier in the film." },
    // Slices 15-16: slice 16 is where the film's own final TWO editorial
    // pauses land, back to back, right up against the last word of
    // narration ("That work hasn't been done yet.") -- both continue this
    // span's own asset from wherever its trim ends, so the real source
    // duration needed here is this 2-slice span PLUS both pause durations,
    // not just the two slices alone (confirmed via a real footage-trim-
    // overrun CI failure at a different, tighter-margin clip; this was
    // previously a 4-slice span starting at 13, which real materialized
    // duration could not cover once the trailing pauses were accounted
    // for -- slice 14 is left alone, under the cap by itself between 13
    // and 15's footage).
    15: { asset: "assets/footage/scene_029_94d5bdac38165c3c273344f7.mp4", trimInRatio: 0.02, span: 2, motion: "hold", role: "context", reuse_reason: "Closing synthesis recap of CLM_012's footage, deliberately timed to land on the film's final editorial pauses -- see slice 1's note." }
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

// Expands one claim's FOOTAGE_ASSIGNMENTS entries into a concrete
// sliceIndex -> {asset, trimInSec, trimOutSec, motion, role, reuseReason}
// map. Most entries cover exactly one slice (the default, `span: 1`,
// matching every entry's historical behavior exactly: trimInRatio picks
// where in the source clip this slice's content starts, clamped so its
// trim never overruns the clip's own real duration). An entry may instead
// declare `span: N > 1` to cover N contiguous slices with ONE real,
// continuously-trimmed pass through the same source clip -- the second and
// later slices continue exactly where the previous one's trim left off, so
// scripts/orvyq_duplicate_footage_audit.mjs's own contiguity rule (same
// asset, `trim_out_sec === trim_in_sec` within tolerance) recognizes the
// whole span as ONE use, not N separate ones. This is how a single
// licensed clip can break up a long claim's evidence run across several
// consecutive slices without spending several of that asset's limited
// max_uses_per_source budget -- the clip must actually be long enough to
// supply that much continuous real footage; expandFootageAssignments
// throws loudly, rather than silently clamping, if it is not.
export function expandFootageAssignments(claimId, sliceDurations, assetDurationSeconds, assignmentsTable = FOOTAGE_ASSIGNMENTS) {
  const declared = assignmentsTable[claimId];
  const expanded = new Map();
  if (!declared) return expanded;
  for (const [startIndexRaw, assignment] of Object.entries(declared)) {
    const startIndex = Number(startIndexRaw);
    const span = Math.max(1, Math.round(Number(assignment.span) || 1));
    const assetDuration = assetDurationSeconds.get(assignment.asset);
    if (!Number.isFinite(assetDuration)) throw new Error(`${claimId}: no known real duration for footage asset ${assignment.asset}`);

    if (span === 1) {
      const sliceIndex = startIndex;
      const sliceDuration = sliceDurations[sliceIndex];
      if (sliceDuration === undefined) throw new Error(`${claimId}: footage assignment at slice ${sliceIndex} does not exist (claim has ${sliceDurations.length} slices)`);
      if (expanded.has(sliceIndex)) throw new Error(`${claimId}: slice ${sliceIndex} has more than one footage assignment covering it`);
      const latestTrimIn = Math.max(0, assetDuration - sliceDuration - 0.3);
      const trimIn = Math.round(Math.min(assignment.trimInRatio * assetDuration, latestTrimIn) * 1000) / 1000;
      expanded.set(sliceIndex, { asset: assignment.asset, trimInSec: trimIn, trimOutSec: Math.round((trimIn + sliceDuration) * 1000) / 1000, motion: assignment.motion, role: assignment.role, reuseReason: assignment.reuse_reason || null });
      continue;
    }

    let trimCursor = Math.round(assignment.trimInRatio * assetDuration * 1000) / 1000;
    for (let offset = 0; offset < span; offset += 1) {
      const sliceIndex = startIndex + offset;
      const sliceDuration = sliceDurations[sliceIndex];
      if (sliceDuration === undefined) throw new Error(`${claimId}: footage span starting at slice ${startIndex} (span ${span}) reaches slice ${sliceIndex}, which does not exist (claim has ${sliceDurations.length} slices)`);
      if (expanded.has(sliceIndex)) throw new Error(`${claimId}: slice ${sliceIndex} has more than one footage assignment covering it`);
      const trimIn = trimCursor;
      const trimOut = Math.round((trimIn + sliceDuration) * 1000) / 1000;
      if (trimOut > assetDuration + 0.001)
        throw new Error(
          `${claimId}: footage span starting at slice ${startIndex} (asset ${assignment.asset}, real duration ${assetDuration}s) overruns that real duration at slice ${sliceIndex} (would need ${trimOut}s) -- ` +
            "shorten the span or pick a longer source clip"
        );
      expanded.set(sliceIndex, { asset: assignment.asset, trimInSec: trimIn, trimOutSec: trimOut, motion: assignment.motion, role: assignment.role, reuseReason: assignment.reuse_reason || null });
      trimCursor = trimOut;
    }
  }
  return expanded;
}

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
// -> metaphor rotation and no automatic "boundary" tension card, and no
// positional restriction on which slice may become footage: a slice becomes
// footage/context only if buildFullProductionPlan finds a matching,
// hand-authored FOOTAGE_ASSIGNMENTS[claim_id][sliceIndex] entry for its own
// real 0-based index in the array this function returns -- any index is
// eligible, not just a fixed "every third slice" position. Everything else
// stays real, source-backed evidence.
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
    slices.push({ start, end, kind: kindFor(claim.visual_treatment?.primary) });
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
    const sliceDurations = slices.map((slice) => slice.end - slice.start);
    const footageBySlice = expandFootageAssignments(window.claim.claim_id, sliceDurations, assetDurationSeconds);
    for (const [sliceIndex, slice] of slices.entries()) {
      const footageAssignment = footageBySlice.get(sliceIndex);
      if (footageAssignment) {
        rawShots.push({
          kind: "footage",
          section_id: window.claim.section_id,
          claim_id: window.claim.claim_id,
          start: slice.start,
          end: slice.end,
          role: footageAssignment.role || "context",
          reuseReason: footageAssignment.reuseReason,
          asset: footageAssignment.asset,
          trimInSec: footageAssignment.trimInSec,
          trimOutSec: footageAssignment.trimOutSec,
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
    // Chained trim cursor: if MORE THAN ONE pause lands inside the same
    // enclosing shot's window (both of the film's own final two pauses land
    // back-to-back inside the same terminal shot), each subsequent pause
    // must continue from the PREVIOUS pause's own trim_out, not restart
    // from the enclosing shot's trim_out every time -- otherwise two
    // pauses sharing one enclosing shot would both read the identical
    // trim window and register as a second, non-contiguous use of that
    // asset (confirmed via a real CI failure: "exceeds the 2-use limit"
    // on an asset used only twice, once per claim, because its second
    // claim's own two trailing pauses were not chained).
    let pauseTrimCursor = raw.trimOutSec;
    while (
      raw.kind !== "graphic" &&
      pauseCursor < pauses.length &&
      pauses[pauseCursor].source_time_seconds <= raw.end + 1e-6 &&
      pauses[pauseCursor].source_time_seconds >= raw.start
    ) {
      const pause = pauses[pauseCursor];
      const pauseOutputStart = raw.end + insertedSeconds;
      const pauseTrimIn = pauseTrimCursor;
      const pauseTrimOut = Math.round((pauseTrimIn + pause.duration_seconds) * 1000) / 1000;
      finalShots.push({
        kind: raw.kind,
        evidenceKind: raw.evidenceKind,
        section_id: raw.section_id,
        claim_id: raw.claim_id,
        role: raw.role,
        // A footage-kind pause hold becomes its own shot immediately
        // continuing the SAME clip from exactly where the enclosing shot's
        // trim (or the previous pause's own trim, if this is not the first
        // pause inside this shot) left off (rather than extending that
        // shot's own duration, which could push a single shot over
        // max_shot_seconds) -- the licensed footage keeps playing under the
        // narration pause(s) across contiguous shots. buildCanonicalEditPlan's
        // source-usage count (scripts/orvyq_edit_plan.mjs) treats a whole
        // chain of contiguous same-asset shots like this as one continuous
        // use, not several, so this never silently inflates a clip's
        // max_uses_per_source count for what is visually a single unbroken
        // shot.
        ...(raw.kind === "footage" ? { asset: raw.asset, trimInSec: pauseTrimIn, trimOutSec: pauseTrimOut, motion: raw.motion } : {}),
        outputStart: pauseOutputStart,
        outputEnd: pauseOutputStart + pause.duration_seconds,
        emphasis: pause
      });
      pauseTrimCursor = pauseTrimOut;
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
