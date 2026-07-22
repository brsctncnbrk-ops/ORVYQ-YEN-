# 001-the-ai-race-no-one-can-afford-to-win

Canonical (non-generated, non-obsolete, non-binary) source data recovered from the golden
repository per `docs/file-classification.md`. This is Phase 2/3 input material, not yet wired
into a working pipeline in this repo.

Recovered: `direction/` (excluding `edit_plan.json`, which is generated output — see
`docs/golden-renderer-map.md`), `research/`, `voice/`, `config/`, `manifest.json`.

**Not recovered, deliberately:** `fact_audit/` (needs reconciliation with
`research/evidence_map.json`'s claims before it can join the canonical evidence registry — see
`schemas/evidence_registry.schema.json`), `prompts/` (likely obsolete AI-image prompt library,
pending confirmation), `qa/*.json` (generated at CI runtime), `remotion/render_ready_project/`
(always-regenerate build output), any file listed as obsolete in
`docs/file-classification.md` §11, and all Git LFS binaries (`assets/footage/*.mp4`,
`assets/audio/*.mp3`, `assets/evidence/*.png`, etc.) — those arrive with the pipeline recovery
in Phase 3/5, tracked via Git LFS once `.gitattributes` is set up (see `docs/source-audit.md`
§4).

`direction/proof_preview_cut.json` is included for historical reference only — it is a
superseded 120-second zero-footage proof design; the approved 150-second proof was produced from
`direction/cinematic_proof_cut.json` + `direction/cinematic_revision_plan.json`.
