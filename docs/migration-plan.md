# Phase 0 — Migration Plan

## 1. Architectural verdict

The task's core requirement is: **ONE renderer, ONE canonical pipeline; proof and full differ
only by a frame-range parameter.**

Direct inspection of the golden repo shows this standard is **already met at the Remotion
render layer** (`docs/golden-renderer-map.md` §2) — one composition (`FactForgeVideo`), one
`Root.tsx`, one `Video.tsx`; the only proof/full difference is the presence or absence of
`--frames=0-4499` on the `remotion render` CLI invocation.

It is **not** met at the upstream data-generation layer. Concrete evidence
(`docs/source-audit.md` §7, full detail in agent research):

1. `scripts/orvyq_edit_plan.mjs:16-17` — `if (previewFrames > 0) return
   buildOrvyqPreviewPlan(projectId);` is a hard dispatch to an entirely separate module
   (`orvyq_preview_plan.mjs`), not a parameter passed into one function.
2. The two paths read from **disjoint sets** of `direction/*.json` files
   (`proof_preview_cut.json`/`cinematic_proof_cut.json`/`motion_hook.json`/
   `primary_evidence_manifest.json` for preview, vs `editorial_blueprint.json.
   full_production.shots` for full) and use different evidence-authority files
   (`primary_evidence_manifest.json`+runtime manifest vs `evidence_map.json`+
   `evidence_resolutions.json`).
3. `edit_plan.json`'s `schema_version` literally differs by branch (`"7.0-cinematic-proof"` /
   `"6.3-motion-hook-evidence-proof"` / `"5.1-evidence-led-full"`), each with a different
   `quality_policy` field set.
4. `lib/orvyq-motion-hook.mjs`'s `auditMotionHook()` only performs real validation when
   `plan.preview === true`; for full plans it trivially passes — a structurally different,
   currently-unenforced code path for full.
5. `orvyq_audio_mix.mjs`'s music-arc timing (`musicVolumeExpression`, SFX `adelay` offsets) is
   made of literal 150-second-proof-specific absolute-second breakpoints that **do not rescale**
   for other durations — a latent correctness bug for any future full-length render, not just an
   architectural inconsistency.
6. `orvyq-preview.yml` runs `orvyq_brightness_repair.mjs` as a proof-only post-render patch step
   that `render.yml` never runs.

**Conclusion:** the rebuild's real consolidation work is in Area 2 (edit-plan/audio/caption
generation), not Area 1 (the renderer). The renderer can be recovered close to verbatim in
Phase 1. The generator scripts must be re-architected in Phase 3 into one parameterized
pipeline, per the task's `buildCanonicalEditPlan()`-style model — while first proving that the
new pipeline reproduces the exact 150s proof output before any further refactor is trusted.

## 2. Canonical function model — mapping golden scripts onto the target shape

| Target canonical function | Golden-repo source(s) it replaces/unifies |
|---|---|
| `buildCanonicalEditPlan(project, {mode, frameRange})` | `orvyq_preview_plan.mjs` (cinematic + non-cinematic branches) + `orvyq_edit_plan.mjs`'s full-production branch, unified into one generator reading from one shot-authoring source, parameterized by target duration/frame range instead of forking on `ORVYQ_CINEMATIC_PROOF`/`ORVYQ_PREVIEW_FRAMES` |
| `buildCanonicalCaptions(editPlan, transcript, {frameRange})` | `orvyq_caption_build.mjs` — already close to the target shape; its `ORVYQ_PREVIEW_FRAMES` use (capping `maxFrame`) is legitimately just a frame-range parameter and should carry forward as-is, only renamed off the env-var-branch pattern |
| `buildCanonicalAudioMix(project, {mode, frameRange})` | `orvyq_audio_mix.mjs` — needs the biggest rework: `PROOF_SECONDS`/`PROOF_MUSIC_SECTIONS`/SFX offsets must become duration-scale-invariant functions of the actual canonical music-cue data (`music_cue_sheet.json`), not literal 150s constants |
| `buildCanonicalAssetRegistry(project)` | New — unifies `research/evidence_map.json` + `evidence_resolutions.json` + `research/primary_evidence_manifest.json` + `evidence_asset_manifest.json` + `fact_audit/claims.json` (reconciled) + footage provenance files into the single registry shape specified in the task (§9) |
| `buildRenderProject(project, editPlan, captions, audioMix, assetRegistry)` | `scripts/remotion_build.mjs` (`derive-configs` + `build-project`) — already close to the target shape structurally; keep the destructive-regenerate pattern (never hand-edit output) |
| Frame-range render dispatch | Already correct at the Remotion CLI layer — preserve `--frames=0..N` for proof, no flag for full, against the same `src/index.ts`/`FactForgeVideo` composition |

## 3. Phase-by-phase execution plan

**Phase 0 — Repository audit (this phase).** Deliverables:
`docs/source-audit.md`, `docs/golden-renderer-map.md`, `docs/file-classification.md`, this file.
Commit and push. *No renderer/pipeline code changes in this phase.*

**Phase 1 — Golden renderer recovery.** Recover `templates/remotion/` into the new repo
near-verbatim: `Video.tsx`, `Scene.tsx`, `CaptionLayer.tsx`, `EditorialOverlay.tsx`,
`EvidenceVisual.tsx`, `EmphasisCard.tsx`, `OrvyqGraphic.tsx`, `PrimaryEvidenceV2.tsx`,
`Root.tsx`, `index.ts`, `remotion.config.ts`, `tsconfig.json`, `package.json`. Deliberate
deviations from verbatim recovery, decided now and recorded here rather than silently:
- `PrimaryEvidence.tsx` is **not** carried forward as a component (dead code); its
  `PrimaryEvidenceSpec`/`EvidenceFocus`/`EvidenceItem` types move to a shared
  `src/types/evidence.ts` that `PrimaryEvidenceV2.tsx` imports from.
- The `"16"`/`"leading models stress-tested"` hardcode in `PrimaryEvidenceV2.tsx` is left in
  place for Phase 1 (renderer recovery must first reproduce the exact historical proof
  byte-for-byte in behavior) and only spec-driven out in Phase 3, once parity is established,
  per the task's explicit sequencing ("refactor naming and behavior only after proving parity").
Run `npx tsc --noEmit`. Do not render yet.

**Phase 2 — Canonical data contracts.** Define JSON Schemas / TypeScript types for: canonical
project, shots, timeline, edit plan, captions, editorial pauses, music cues, audio mix metadata,
asset registry, evidence registry, frozen candidate, proof approval. Validate all recovered
Phase 0/1 project source data (`direction/*.json`, `research/*.json`) against these schemas as a
correctness check before Phase 3 touches the generator logic.

**Phase 3 — Timeline and audio recovery.** Recover the generator scripts, merging
`orvyq_preview_plan.mjs` + `orvyq_edit_plan.mjs`'s full branch into the single
`buildCanonicalEditPlan()` per §2 above, and making `orvyq_audio_mix.mjs`'s music/SFX timing
scale-invariant. This phase must preserve the exact historical 150s proof output — verified in
Phase 5, not assumed here.

**Phase 4 — QA recovery.** Port all 12 QA scripts, normalize `orvyq_license_audit.mjs` to the
common `{pass, failures[]}` report shape used by the other 11, and consolidate the
`script_similarity` threshold (currently drifted between 0.55 in `orvyq_speech_qa.py`'s own CLI
default and 0.85 hardcoded twice downstream) into one canonical policy value in
`editorial_blueprint.json.global_rules`. Proof and full mode must share one QA engine,
parameterized by frame range like everything else.

**Phase 5 — Golden parity proof.** Generate a new 150s/4500-frame/30fps proof from the new
repo's pipeline using the exact golden project inputs, and produce an actual proof artifact
(rendered MP4 + contact sheets + QA reports) for human comparison against the approved
historical proof (artifact `orvyq-cinematic-proof-150s-29655003486`). No claim of parity is made
from passing tests alone.

**Phase 6 — Full-duration readiness (blocked).** Only after the user explicitly approves the
Phase 5 proof: verify full-film shot/asset coverage, run full preflight, and stop — full render
requires a further explicit human approval that is out of scope for this task to grant.

## 4. Key decisions recorded so far

- **System name vs project name:** the underlying system is called FactForge; ORVYQ is this
  specific video project's codename. The new repo should probably keep "FactForge" as the
  system name (consistent with `package.json`, `CLAUDE.md`, and the render composition id
  `FactForgeVideo`) rather than renaming everything to "ORVYQ," unless the user prefers
  otherwise — flagged as an open question, not yet decided unilaterally.
- **`render_ready_project`-equivalent will not be hand-committed** as a source of truth; it is
  always-regenerate build output (see `docs/golden-renderer-map.md` §5).
- **`prompts/` (AI-image-generation) tree defaults to excluded** from migration pending
  confirmation, since the project pivoted to licensed footage + official evidence.
- **`fact_audit/claims.json` vs `research/evidence_map.json`'s claims** need reconciliation in
  Phase 2's canonical asset/evidence registry design, not blind duplication.
- **`direction/proof_preview_cut.json`** (120s zero-footage cut) is historical reference only;
  `cinematic_proof_cut.json` + `cinematic_revision_plan.json` are what actually produced the
  approved 150s proof and are the canonical proof inputs for parity work.

## 5. Open risks / questions to surface to the user before or during later phases

1. Full-film narration is explicitly **not yet approved** in the golden source
   (`voice/narration_status.json`: `full_narration_approved: false`,
   `full_narration_requires_regeneration: true`) — Phase 6 full-duration readiness will hit this
   real gate, not a rebuild artifact.
2. Large binary assets (footage, audio, evidence images) are Git LFS pointers in the golden repo
   — the new repo will need its own LFS setup, and fetching/rendering may require network access
   to the same external hosts (`scottbuckley.com.au` for music, `www-cdn.anthropic.com` /
   `storage.googleapis.com` for evidence PDFs) currently allowlisted in
   `primary_evidence_manifest.json.policy.allowed_hosts`.
3. Whether to import `prompts/` at all — recommend excluding by default (see above); will not
   import unless the user says otherwise.
