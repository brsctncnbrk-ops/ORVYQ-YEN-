# schemas/ — canonical data contracts

Twelve JSON Schemas (draft 2020-12) covering the shapes named in `docs/migration-plan.md`
Phase 2: `canonical_project`, `shot`, `timeline`, `edit_plan`, `captions`, `editorial_pauses`,
`music_cues`, `audio_mix`, `asset_registry`, `evidence_registry`, `frozen_candidate`,
`proof_approval`.

Validated by `scripts/validate_canonical.mjs` (`npm run validate:canonical`).

## Design notes

- **`edit_plan.schema.json` is the deliberate unification target.** The golden system wrote
  three different `schema_version` strings depending on which of two independent code paths
  produced the plan (`"7.0-cinematic-proof"` / `"6.3-motion-hook-evidence-proof"` /
  `"5.1-evidence-led-full"`), with different field sets per branch. This schema replaces that
  with one constant `schema_version: "1.0-canonical"` and an explicit `mode` (`proof`|`full`) +
  `frame_range` pair. `duration_frames` is always the canonical full-timeline length in both
  modes — only `frame_range.end_frame` differs. Validated against all 109 real shots from the
  golden repo's `direction/edit_plan.json` during Phase 2 (all passed).
- **`audio_mix.schema.json` requires seconds-relative-to-duration timing**, not literal
  constants — this is the schema-level fix for the concrete bug found in
  `docs/source-audit.md` §7, where the golden `orvyq_audio_mix.mjs` hardcoded 150-second-proof
  absolute-second breakpoints into its FFmpeg ducking expression, which did not rescale for
  longer durations.
- **`asset_registry.schema.json`** matches the task's asset/provenance model verbatim (asset_id,
  type, path, source, source_url, license, attribution, duration_seconds, width, height, sha256,
  semantic_keywords, editorial_roles, allowed_reuse_count).
- **`evidence_registry.schema.json`** unifies `research/evidence_map.json` (sources + claims),
  `research/evidence_resolutions.json` (the delta layered on top), and the two evidence-asset
  manifests. Per `docs/file-classification.md` §9, `fact_audit/claims.json` is a second,
  differently-schemed claim registry — reconciling it into this shape (not duplicating it) is a
  Phase 3 task, not yet done.
- **`frozen_candidate.schema.json`** / **`proof_approval.schema.json`** implement the task's
  canonical freeze model (section 10): a frozen candidate is identified by hashes of every
  canonical input, and a proof approval references a frozen candidate by hash. Full render is
  only permitted when the current frozen candidate's hash matches an existing approval exactly.

## What's intentionally not here

The golden repo's general FactForge pipeline schemas (`research.schema.json`,
`script.schema.json`, `storyboard.schema.json`, `visual_prompts.schema.json`,
`fact_audit.schema.json`, `fact_registry_entry.schema.json`, `footage_manifest.schema.json`,
`packaging.schema.json`, `manifest.schema.json`, `composition.schema.json`) cover earlier
content-generation pipeline stages (research → script → storyboard → images → packaging) that
are out of scope for this task — the task is specifically the render/proof system (canonical
timeline through to a frame-range-limited render), not the upstream editorial pipeline that
produces the direction data this system consumes. Not importing them is a scope decision, not
an oversight.

## Verified in Phase 2

`npm run validate:canonical` — 13/13 checks pass: 2 real recovered project files
(`editorial_pause_map.json`, `music_cue_sheet.json`) validate against their schemas as-is; 1
`canonical_project` object assembled from recovered config files validates; and 10 fixture
examples (schema-shape proofs built from real golden content, not invented data) validate
against the remaining schemas that have no real instance in this repo yet — those become real
Phase 3/5 outputs, re-validated against these same schemas once produced.

Separately (not part of the committed validator, since it depends on the golden repo checkout
that won't exist in later sessions): every one of the 109 real shots in the golden repo's
`direction/edit_plan.json`, wrapped in a synthetic canonical envelope, validated cleanly against
`shot.schema.json` and `edit_plan.schema.json` with zero changes to either schema.
