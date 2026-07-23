# Full-Production Pipeline Guide

This documents the full-mode (~857.29s) pipeline. Proof and full now share
one edit-plan data model end to end: `buildCanonicalEditPlan()` always
builds from `direction/editorial_blueprint.json`'s `full_production.shots`
(`scripts/orvyq_edit_plan.mjs`'s `buildFullPlan`), the same
`edit_plan.schema.json`, the same per-shot validation rules, and the same
`quality_policy`. Proof mode differs only in `frame_range.end_frame` — it is
a genuine frame-prefix of the full candidate (see `resolveProofBoundaryFrame`
in `scripts/orvyq_edit_plan.mjs`), not a separately-authored cut. There is no
second renderer, composition, edit-plan schema, or content model for full
mode.

## 1. Pipeline overview

| Stage | Script | What it does |
|---|---|---|
| Narration alignment | `scripts/orvyq_narration_alignment.mjs` | Real per-word ASR timestamps for the full 804.36s narration recording, committed as `voice/narration_alignment.json`. |
| Claim resolution | `scripts/lib/orvyq-evidence.mjs` (`loadResolvedEvidenceMap`) | Merges `research/evidence_map.json` with `research/evidence_resolutions.json`. All claims resolve through this merge with real, independently-verified sources. |
| Editorial pause resolution | `scripts/lib/orvyq-pause-resolver.mjs` (`resolveFullFilmPauses`) | Resolves `direction/editorial_pause_map.json`'s `full_film_pause_anchors` (text-anchored) against the real ASR words, into real `source_time_seconds` values. |
| Footage materialization | `scripts/orvyq_materialize_footage.mjs` + `projects/*/migration/external_assets.json` | Recovers the real, licensed footage set (opening motion hook + full contextual body footage) from one pinned, immutable source commit, with per-file Git LFS pointer sha256/size verification. The only footage-recovery mechanism any workflow uses — see `.github/workflows/orvyq-proof.yml`, `orvyq-full-plan-validate.yml`, `orvyq-full-render.yml`. |
| Full production shot list | `scripts/orvyq_full_production_plan.mjs` | Builds `full_production.shots` from real data: every claim's real spoken window, section title cards, resolved pause shots, the shared motion hook as the cold open, and contextual footage placed across the whole film (`FOOTAGE_ASSIGNMENTS` + an automated run-length-breaking backfill pass, `FULL_FOOTAGE_POOL`). Zero placeholder shots; zero unplanned time gaps. |
| Edit plan | `scripts/orvyq_edit_plan.mjs` (`buildCanonicalEditPlan`) | Both modes call `buildFullPlan` unconditionally. `mode: "proof"` additionally resolves a real shot boundary (`resolveProofBoundaryFrame`) and truncates only `frame_range.end_frame`; `duration_frames`, `shots`, and `quality_policy` are identical in both modes. |
| Music resolution | `scripts/orvyq_music_resolve.mjs` | Full mode resolves nine distinct per-cue tracks (`direction/music_cue_sheet.json`'s `full_cues`, each with its own `track_id`) against `music_library/registry.json`, trims each to its cue's real duration with a short edge fade at cue boundaries, and concatenates them into one physical `assets/music/approved_bed.mp3`. No network fetch at render time. |
| Audio mix | `scripts/orvyq_audio_mix.mjs` | Uses `resolveFullFilmPauses()` for real pause timing and `music_cue_sheet.json`'s real per-cue sections (real absolute seconds, no proportional rescaling). A proof run builds the exact same full mix and truncates only the final output to the proof boundary (`--allow-prefix-truncation`) — there is no separate proof-only soundtrack. |
| Parity check | `scripts/orvyq_parity_check.mjs` | Static check that `buildProofPlan` has not been reintroduced and that `buildCanonicalEditPlan` still calls `buildFullPlan` unconditionally for both modes — guards the frame-prefix architecture, not proof/full data isolation (which no longer applies). |
| Approval hardening | `scripts/orvyq_verify_approval.mjs` | The approval's `frozen_candidate_hash` must match the sha256 of the currently committed `qa/frozen_candidate.json`, the candidate's `mode` must match what's expected, its `source_commit_sha` must match the commit being rendered, and (stage `late`) every hash must still match a freshly recomputed candidate. |

## 2. Current state (re-verify against a real CI run, not this file)

1. **Footage:** real and wired in. All 25 contextual clips + the motion hook
   are recovered by `scripts/orvyq_materialize_footage.mjs` from one pinned
   source commit in every workflow that needs them.
2. **Music:** partially real. `sb_signal_to_noise` (CUE_06_REGULATION_PARADOX,
   "Signal to Noise" Full Mix) is vendored, hash-verified, and
   `approved_for_full: true`. The other eight cues (CUE_01, 02, 03, 04, 05,
   07, 08, 09) declare their real intended `track_id`s in
   `direction/music_cue_sheet.json` but remain `status:
   "spec_ready_asset_pending"` until `.github/workflows/orvyq-music-acquisition.yml`
   downloads, verifies, and vendors them (real network access, GitHub-hosted
   runner only — never from this sandbox). `orvyq_audio_mix.mjs` /
   `orvyq_music_resolve.mjs` correctly refuse to build a full-mode mix until
   `full_render_requires_all_cues_ready` is satisfied.
3. **Approval:** no full-mode (or new proof-mode) frozen candidate has been
   approved yet. `orvyq_verify_approval.mjs --mode=full` correctly fails
   until one is recorded.

## 3. Validating the full edit plan without rendering

`.github/workflows/orvyq-full-plan-validate.yml` (manual `workflow_dispatch`
only) materializes the real footage set, regenerates `full_production.shots`,
and runs `buildCanonicalEditPlan({ mode: "full" })` — no video frame is ever
rendered, and this is entirely separate from `orvyq-full-render.yml` (the
gated, human-approval-only final render workflow).

## 4. What a human needs to do next

1. Run `.github/workflows/orvyq-music-acquisition.yml` (if not already run)
   to vendor the remaining eight tracks and flip their cues to `status:
   "ready"`.
2. Review a rendered proof artifact from `orvyq-proof.yml` and record a
   matching `qa/proof_approval.json`.
3. Once a `mode: "full"` frozen candidate exists and is approved,
   `orvyq-full-render.yml` can pass its `--stage=early` gate.
