# templates/remotion — canonical renderer

Recovered from the golden repository (`brsctncnbrk-ops/YouTube_pepline`, commit
`9affbd2494d8197a564c4a552b879fadb0e14a4a`) per `docs/golden-renderer-map.md`. This is a
single Remotion app registering one composition, `FactForgeVideo`, whose
`durationInFrames`/`fps`/`width`/`height` come entirely from `src/data/scene_config.json` —
proof vs full render is applied only via the Remotion CLI `--frames` flag against this same
composition, never a second composition or a forked component tree.

`src/data/*.json` are placeholders, overwritten per-project at build time (see Phase 3).

## Deliberate deviation from the golden source

`src/PrimaryEvidence.tsx` (the "v1" evidence renderer) was **not** carried forward as a
component: it was confirmed dead code in the golden repo (`Scene.tsx` renders
`PrimaryEvidenceV2`, never `PrimaryEvidence`). Its exported types (`PrimaryEvidenceSpec`,
`EvidenceFocus`, `EvidenceItem`) were extracted byte-for-byte into `src/types/evidence.ts`,
which `Video.tsx`, `Scene.tsx`, and `PrimaryEvidenceV2.tsx` now import from instead. This is a
pure dead-code removal with no behavioral change — see `docs/migration-plan.md` §3 (Phase 1).

Everything else — including the `"16"` / `"leading models stress-tested"` hardcoded content
literal inside `PrimaryEvidenceV2.tsx`'s `ArticleStage` and the ORVYQ-specific graphic-type
whitelist inside `OrvyqGraphic.tsx` — is left exactly as in the golden source for this phase.
Those are tracked as Phase 3 cleanups (after golden-proof parity is established), not fixed now.

## Verified in this phase

- `npm ci` — installs cleanly (`remotion 4.0.489`, `react 18.3.1`, `typescript 5.9.3`)
- `npx tsc --noEmit` — passes with zero errors
- `npx remotion compositions src/index.ts` — resolves `FactForgeVideo 30fps 1920x1080` from the
  placeholder `scene_config.json` (60 frames / 2.00s)
- `npx remotion still src/index.ts FactForgeVideo out.png --frame=0` — renders successfully
  (solid background, since the placeholder `edit_plan.json` has `shots: []`)

No full render was performed — real project data arrives in Phase 3, and full-duration
rendering requires explicit human approval per the project's canonical freeze model.
