# Full-Production Pipeline Guide

This documents the full-mode (~840s) pipeline built on top of the recovered
proof (Phases 0-6, see `docs/migration-plan.md`). It covers what is now
real and working, what remains a genuine content gap, and how to proceed.
Everything here goes through the exact same renderer, `buildCanonicalEditPlan()`,
schemas, and shot components as proof mode — proof is limited only by
`--frames=<range>` against the same edit plan; there is no second renderer,
composition, or edit-plan schema for full mode.

## 1. Pipeline overview

| Stage | Script | What it does in full mode |
|---|---|---|
| Narration alignment | `scripts/orvyq_narration_alignment.mjs` | Real per-word ASR timestamps for the full 804.36s narration recording, committed as `voice/narration_alignment.json` (schema `narration_alignment.schema.json`). Produced once, in CI, from the real uploaded recording — never regenerated narration or TTS. |
| Claim resolution | `scripts/lib/orvyq-evidence.mjs` (`loadResolvedEvidenceMap`) | Merges `research/evidence_map.json` with `research/evidence_resolutions.json`'s `source_additions`/`claim_additions`/`claim_overrides`. All 4 previously-blocking claims (and CLM_021) already resolve through this existing merge with real, independently-verified sources (Stanford HAI 2025 AI Index, UK CMA Foundation Models report + update, UK CMA Cloud Services investigation). |
| Editorial pause resolution | `scripts/lib/orvyq-pause-resolver.mjs` (`resolveFullFilmPauses`) | Resolves `direction/editorial_pause_map.json`'s `full_film_pause_anchors` (text-anchored, not pre-timed) against the real ASR words in `narration_alignment.json`, into real `source_time_seconds` values — completely independent of proof's fixed 4-pause `proof.pauses` list. Uses bag-of-words + span-penalized matching to survive ASR noise (homophones, hyphen-splitting) and ordinary ASR transcription variance. |
| Full production shot list | `scripts/orvyq_full_production_plan.mjs` | Builds `direction/editorial_blueprint.json`'s `full_production.shots` from real data only: every claim's real spoken window (located via the same text-matching approach as pause resolution), section title cards, resolved pause shots as dedicated beats, and the same real, licensed motion-hook footage proof mode uses (`direction/motion_hook.json`) as the film's cold open. Zero placeholder shots; zero unplanned time gaps (every second of narration is covered by exactly one claim). |
| Edit plan | `scripts/orvyq_edit_plan.mjs` (`buildCanonicalEditPlan`, `mode: "full"`) | Validates `full_production.shots` against the same per-shot rules as proof (`IMAGE_KINDS`/`NATIVE_KINDS`/`ALLOWED_ROLES`/`ALLOWED_TRANSITIONS`), the same `auditMotionHook()`, the same `edit_plan.schema.json`. Now also validates full-mode footage (hook/contextual) with the same licensing/provenance checks proof's footage branch already had — this branch previously had no support for `hook_footage`/`contextual_footage` at all. |
| Audio mix | `scripts/orvyq_audio_mix.mjs` (`mode: "full"`) | Uses `resolveFullFilmPauses()` for real pause timing (previously silently read `proof.pauses` regardless of mode). Uses `direction/music_cue_sheet.json`'s real 9-state `full_cues` (rescaled proportionally onto the real output duration) instead of the proof's 5-section structure rescaled. Still requires a real `assets/music/approved_bed.mp3` full-length track — see gap 1 below. |
| Parity/isolation | `scripts/orvyq_parity_check.mjs` | Static check that `buildProofPlan`/`buildFullPlan` stay isolated (each reads only its own mode's files) and both still flow through the one shared `buildCanonicalEditPlan`, one schema, one `auditMotionHook`. Run via `npm run orvyq:parity-check`, wired into `npm run orvyq:qa` and CI. |
| Approval hardening | `scripts/orvyq_verify_approval.mjs` | Replaces the `approved === true`-only gate in `orvyq-full-render.yml` with real hash verification: the approval's `frozen_candidate_hash` must match the sha256 of the *currently committed* `qa/frozen_candidate.json` (stage `early`), the candidate's `mode` must be `full`, its `source_commit_sha` must match the commit being rendered, and (stage `late`, after the pipeline rebuilds its outputs) every hash must still match a freshly recomputed candidate. See gap 2 below for a real, pre-existing case this already catches. |

## 2. Known, explicit blocking gaps (not faked, not auto-completable)

1. **No real full-length licensed music.** `direction/music_cue_sheet.json`'s
   9 `full_cues` are real, already-authored music *states* (instrumentation,
   energy arc, function) but every one is `status: "spec_ready_asset_pending"`
   — no actual audio has been composed or licensed yet. `orvyq_audio_mix.mjs`
   already refuses to proceed for full mode without a real
   `assets/music/approved_bed.mp3` (`"Full ORVYQ render requires an approved
   full-duration music bed"`) and additionally now refuses if the cue sheet's
   own `full_render_requires_all_cues_ready` policy isn't satisfied. This is a
   real content-acquisition task for a human (compose or license ~840s of
   music matching the 9 states), not something this pipeline can synthesize
   without either faking a pass or blind-looping the 150s proof track — both
   explicitly forbidden.
2. **No full-mode frozen candidate has ever been approved.** The only
   `qa/proof_approval.json`/`qa/frozen_candidate.json` on record approve the
   150s **proof** specifically (`mode: "proof"`), with the approval's own
   notes explicitly stating it does not unblock full render.
   `orvyq_verify_approval.mjs --mode=full` correctly fails on this today.
   Separately, hash verification surfaces a **real, still-current integrity
   gap in this repo's own history**, re-verified as of this session:
   `qa/proof_approval.json`'s `frozen_candidate_hash` (`cb5346cb...`) was
   recorded against the `qa/frozen_candidate.json` committed by proof run
   `29921936297` (commit `b448869`) — the run the user actually watched and
   approved. Two later successful proof runs have since overwritten
   `qa/frozen_candidate.json` with different candidates without a matching
   re-approval: `29924729353` (commit `36540fe`), and now the run cited as
   this task's "latest successful proof," `29954982404` (commit `89fb3fa`,
   current HEAD). Running `node scripts/orvyq_verify_approval.mjs
   --project-id=001-the-ai-race-no-one-can-afford-to-win --mode=proof
   --stage=early` against the currently committed files still fails today
   with exactly this mismatch (committed candidate hash `a5714101c0...` vs.
   approved hash `cb5346cb...`). Under the previous `approved === true`-only
   gate this would have silently passed; `orvyq_verify_approval.mjs` now
   correctly fails on it every time. This does not affect the proof video
   that was actually reviewed and approved — it means the approval record
   and the currently committed frozen candidate have drifted apart (twice
   now) and a human should either re-approve the current candidate after
   confirming the rendered proof is unchanged in substance, or restore the
   originally approved one. This is independent of, and does not block on,
   gap 1 — it concerns proof-mode approval bookkeeping, not full-mode
   readiness.
3. **Full-production contextual/hook body footage beyond the shared motion
   hook has not been acquired.** Every claim beat in `full_production.shots`
   is rendered as `asset_type: "evidence"` using a `NATIVE_KINDS` kind
   (data-driven graphics, no image file required) derived from each claim's
   own `visual_treatment` fields — real editorial content, zero placeholders
   — but this does not satisfy a documentary's usual visual-variety
   expectation of contextual live-action footage throughout. Acquiring and
   licensing that footage is separate, out-of-scope content work.
4. **`quality_policy.cinematic_body_footage` is hardcoded to `mode ===
   "proof"`** in `buildCanonicalEditPlan`'s shared assembly section, so full
   mode cannot use contextual (non-hook) body footage even though
   `buildFullPlan`'s footage branch now supports the field structurally.
   Surfaced by `orvyq_parity_check.mjs` as a warning. Whether full mode
   should ever use contextual body footage is an editorial policy decision,
   not a defect to fix by guessing.

## 3. Validating the full edit plan without rendering

`.github/workflows/orvyq-full-plan-validate.yml` (manual `workflow_dispatch`
only, never auto-triggered) recovers the same real motion-hook footage proof
mode uses from the golden reference, regenerates `full_production.shots`,
and runs `buildCanonicalEditPlan(mode: "full")` — no video frame is ever
rendered, and this is entirely separate from `orvyq-full-render.yml` (the
gated, human-approval-only final render workflow, which this task must never
trigger). This is the only way to prove the full edit plan passes end-to-end
without the missing footage/music assets on the local machine (this
sandbox's egress policy blocks `git-lfs`, so the real footage binaries can't
be pulled locally; only GitHub-hosted runners can recover them from the
golden reference, exactly as `orvyq-proof.yml` already does).

## 4. Verified as of this session (no code/architecture change)

Re-verified directly, not assumed from prior docs: `npm test` (55/55, including
new `scripts/remotion_build.test.mjs` coverage proving `deriveConfigs()` — the
one function that turns a canonical edit plan into the Remotion composition's
own `scene_config.json`/`asset_map.json` — takes no mode branch and derives
identical composition dimensions for a `mode: "proof"` and a `mode: "full"`
edit plan, differing only in `duration_frames`/`frame_range`), `npm run
validate:canonical` (15/15), `node scripts/orvyq_parity_check.mjs` (pass, only
the known gap-4 warning), `npx tsc --noEmit` in `templates/remotion` (clean),
and `npx remotion compositions src/index.ts` (bundles and lists exactly one
composition, `FactForgeVideo` — confirms no second, full-only composition
exists). `voice/narration_status.json` confirms `full_narration_approved:
true` (real ASR validation, run `29928374281`) — full narration is not a
blocker. `.github/workflows/orvyq-full-plan-validate.yml` was given the same
guarded self-referential push-to-index pattern already used by
`orvyq-music-intake.yml` (a plain push only indexes the workflow with GitHub;
the actual dry-run steps still require an explicit `workflow_dispatch`), so it
can now actually be dispatched to prove the full edit plan builds end-to-end
on a GitHub-hosted runner, exactly as designed in section 3 above.

## 5. What a human needs to do next

1. Compose or license ~840s of music matching `music_cue_sheet.json`'s 9
   `full_cues`, commit it as `assets/music/approved_bed.mp3` +
   `approved_bed.provenance.json`, and mark each cue `status: "ready"`.
2. Reconcile the `qa/frozen_candidate.json` / `qa/proof_approval.json` drift
   described in gap 2 above.
3. Once full audio mix inputs exist, run a full-mode equivalent of
   `orvyq-proof.yml`'s "compute + commit frozen candidate" step, review the
   result, and record a `mode: "full"` approval before `orvyq-full-render.yml`
   can ever pass its `--stage=early` gate.
4. Acquire real contextual/body footage if visual variety beyond
   data-driven graphics is wanted for the full film (optional; the current
   plan is schema-valid and gap-free without it).
