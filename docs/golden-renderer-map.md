# Phase 0 — Golden Renderer Map

Structural map of `templates/remotion/` in the golden repo (`brsctncnbrk-ops/YouTube_pepline`
at commit `9affbd2494d8197a564c4a552b879fadb0e14a4a`), the canonical renderer source, and its
relationship to the generated `projects/<id>/remotion/render_ready_project/` tree.

## 1. Tree

```
templates/remotion/
├── .gitignore
├── package.json                (name "factforge-render")
├── package-lock.json
├── remotion.config.ts
├── tsconfig.json
└── src/
    ├── index.ts                 registerRoot entry point
    ├── Root.tsx                 single <Composition> registration
    ├── Video.tsx                 root component "FactForgeVideo"
    ├── Scene.tsx                  per-shot renderer/dispatcher
    ├── CaptionLayer.tsx
    ├── EditorialOverlay.tsx
    ├── EvidenceVisual.tsx
    ├── EmphasisCard.tsx
    ├── OrvyqGraphic.tsx
    ├── PrimaryEvidence.tsx        dead code — types only reused, component unused
    ├── PrimaryEvidenceV2.tsx      actually wired into Scene.tsx
    └── data/                      placeholder JSON, overwritten per-project at build time
        ├── asset_map.json
        ├── captions.json
        ├── edit_plan.json         ({"shots": []})
        └── scene_config.json      (1-scene, 60-frame placeholder)
```

No `TODO`/`FIXME`/`HACK`/`XXX` comments exist anywhere under `templates/remotion/`.

## 2. Composition registration — the one clean seam

`src/index.ts` calls `registerRoot(RemotionRoot)`, standard Remotion entry, nothing else.

`src/Root.tsx` (22 lines) registers **exactly one** `<Composition>`:

```tsx
<Composition id="FactForgeVideo" component={FactForgeVideo}
  durationInFrames={sceneConfig.duration_frames} fps={sceneConfig.fps}
  width={sceneConfig.width} height={sceneConfig.height} />
```

All four numeric values come from `src/data/scene_config.json` — **not** from any code
constant. The file's own comment states this is intentional: *"A single composition driven
entirely by the per-project scene_config.json … This file never needs per-project edits — all
the numbers come from the JSON."*

**There is only one composition — no separate proof vs full composition id, and no fork in
`Root.tsx`/`index.ts`/`Video.tsx` between modes.** Proof vs full is applied entirely at the
Remotion CLI layer: `npx remotion render src/index.ts FactForgeVideo out.mp4 --frames=0-4499`
for proof, the same command with no `--frames` flag for full. This is exactly the "ONE
renderer / render mode = frame-range parameter" architecture the task requires, and it is
**already satisfied by this layer** in the golden system. The work needed to reach that same
standard is entirely upstream, in the data-generation pipeline — see
`docs/migration-plan.md` §2.

## 3. Component-by-component

**`Video.tsx`** (20 lines) — root component `FactForgeVideo`. Imports `assetMap`,
`captionsData`, `editPlan` directly via `resolveJsonModule`. Discriminated shot union
(`FootageShot | GraphicShot | EvidenceShot`) keyed on `asset_type`. Renders one global
`<Audio src={staticFile(audioSrc)}/>` where `audioSrc = plan.audio_mix_asset ||
assetMap.audio_asset`. Maps `plan.shots` to `<Sequence>` elements; for `evidence`/`graphic`
shots past frame 0, backs the sequence start up by a fixed 8-frame `overlapFrames` to create a
cross-dissolve window. Renders `<CaptionLayer>` once, globally, above all sequences. No
proof-only literals.

**`Scene.tsx`** (16 lines) — per-shot dispatcher (`assetType: "footage"|"ai_fallback"|
"graphic"|"evidence"`). `computeTransform()` drives Ken-Burns zoom/pan for AI-fallback stills.
`footageTransform()` is a separate table for real footage (`push`/`pull`/`drift_left`/
`drift_right`/default `hold`), fixed scale/translate magnitudes (design constants, not
proof-specific). `fadeFrames = min(15, max(1, floor(duration/4)))`. Dispatch: `graphic →
OrvyqGraphic`, `evidence → PrimaryEvidenceV2` (not V1), `footage → OffthreadVideo`, else →
`Img`.

**`CaptionLayer.tsx`** (53 lines) — single active caption at `useCurrentFrame()`, fade over
`min(6, max(3, floor(duration/6)))` frames, bottom-center, `whiteSpace: nowrap` (no wrapping —
captions are pre-chunked short by `orvyq_caption_build.mjs`). No proof-only hardcoding.

**`EditorialOverlay.tsx`** (121 lines) — 12-way `type` union
(`source_mosaic|comparison|document|stat|process|email_recreation|quote|boundary|timeline|
bar_evidence|matrix|evidence_chain|node_map`); the last 5 delegate to `EvidenceVisual`.
`spring({damping:22, stiffness:100, mass:.9, durationInFrames: min(34,duration)})` reveal +
13-frame fade-out. Purely spec-driven, no hardcoded content.

**`EvidenceVisual.tsx`** (162 lines) — five sub-visualizations (`Timeline`, `BarEvidence`,
`Matrix`, `EvidenceChain`, `NodeMap`), each a `spring`-driven progress bar over spec-provided
data. No hardcoded evidentiary numbers.

**`EmphasisCard.tsx`** (101 lines) — full-bleed title card, `{eyebrow, title, accent?}`,
18-frame enter / 16-frame exit via bezier `interpolate`. Font-size heuristic (`title.length >
25 ? 82 : 94`px) is a generic design rule, not proof-specific.

**`OrvyqGraphic.tsx`** (125 lines) — full-screen graphic renderer; `modeFor()` maps
`spec.type` to one of `{brand, comparison, evidence, process, statement}` via a **hardcoded
whitelist of this video's own graphic-type vocabulary** (`brand_open/brand_close`,
`evaluation/scenario/fire_drill/open_closed/audit_tradeoff/defense_balance/
forecast_diverge`, `report_scan/compute_threshold`, `safeguards/compliance_stack/sunset`).
**Flag:** a truly generic renderer should not need to know ORVYQ's specific scene-type names;
this coupling should be addressed in Phase 3/1 by moving type-to-mode mapping into project data
or keeping it as an intentionally-documented "editorial vocabulary" contract rather than an
implicit code whitelist.

**`PrimaryEvidence.tsx`** (29 lines, dense single-line style) — **dead code**. `Scene.tsx`
imports `PrimaryEvidenceV2`, not this file; `PrimaryEvidenceV2.tsx` only reuses its exported
*types* (`PrimaryEvidenceSpec`, `EvidenceFocus`, `EvidenceItem`). Contains a hardcoded content
string (`"16"` + `"leading models stress-tested"`) baked directly into its `Article`
sub-renderer — ORVYQ-specific factual content that belongs in the data layer, not the
component. **Recommendation:** delete the component on recovery; move its type declarations to
a shared types module that `PrimaryEvidenceV2.tsx` imports from directly.

**`PrimaryEvidenceV2.tsx`** (167 lines) — the actually-used evidence renderer. A refactor of
V1 with different color tokens and componentized per-`kind` stage renderers
(`DocumentStage, SplitDocuments, FigureStage, ScreenStage, ImageSequence, Cards, TimelineStage,
ArticleStage, FlowStage, ComparisonStage, RecapStage`). Contains the **same hardcoded
`"16"`/`"leading models stress-tested"` literal** (duplicated verbatim from V1, confirming V2
was forked and the fork never cleaned up). `reveal = spring({damping:24, stiffness:96,
mass:.9, durationInFrames: min(38,duration)})`. **Recommendation:** replace the hardcode with
spec-driven fields (e.g. `headline_number`/`headline_label` on `EvidenceItem`).

## 4. `remotion.config.ts`

- **Hard-fails** if `FACTFORGE_REMOTION_BROWSER_EXECUTABLE` is unset: `throw new Error(...)` —
  a deliberate no-network-fallback safety rail (every workflow resolves and exports this var
  right before rendering). Not proof-specific; carry forward as-is.
- `Config.setPublicDir("../../")` — points two levels up from `render_ready_project/` at the
  **project root**, so `staticFile("assets/...")` resolves against the project's own `assets/`
  without duplicating large LFS binaries into `public/`.
- `Config.setVideoImageFormat("jpeg")`, `Config.setOverwriteOutput(true)`.

## 5. Relationship to `projects/<id>/remotion/render_ready_project/`

The **only** generator is `scripts/remotion_build.mjs`'s `buildProject()`:
1. Validates `remotion/scene_config.json`, `remotion/asset_map.json`, `remotion/captions.json`,
   `direction/edit_plan.json` all exist.
2. Preserves `src/data/human_notes.json` (persisted human QA notes) in memory if present.
3. **`fs.rm(dest, {recursive:true, force:true})`** then a full destructive copy of
   `templates/remotion/` into `dest` (`copyDir`, skipping `node_modules`/`.git`/`out`/
   `.remotion`).
4. Copies the four generated data files into `dest/src/data/`.
5. Restores `human_notes.json`.
6. Refreshes `assets/asset_manifest.json`; returns any missing referenced assets.

**Verdict: `templates/remotion/` is the canonical source; `render_ready_project/` is
disposable, always-regenerate-before-use build output** — confirmed both by this generator
logic and by direct inspection: the golden repo's *currently checked-in*
`render_ready_project/` is **stale and non-buildable**. It is missing `CaptionLayer.tsx`,
`EmphasisCard.tsx`, `PrimaryEvidence.tsx`, `PrimaryEvidenceV2.tsx` entirely; its
`EditorialOverlaySpec` union has only 8 of the current 12 members (missing all 5 evidence-visual
types... note: 5 delegate types plus a few base types, see §3); its `Scene.tsx` has no
`"evidence"` asset type and no `EmphasisCard` support; and its `scene_config.json` describes an
entirely different 21,598-frame (≈720s) draft cut with 33 footage-only scenes and no
evidence/graphic shots at all — an older cut predating the 150s cinematic proof.
`package.json`/`package-lock.json` are byte-identical to the current templates, so this
staleness is in the `.tsx` sources only, not the dependency pins.

Every CI workflow (`orvyq-preview.yml`, `orvyq-debug.yml`, `render.yml`) unconditionally
regenerates `render_ready_project/` via `derive-configs` + `build-project` before ever running
`npm ci`/`tsc`/`remotion render` — so this staleness has never actually broken a real run, but
it means the git history of `render_ready_project/` cannot be trusted as a reference and should
not be treated as a second source of truth.

**Rebuild decision:** do not hand-maintain a committed `render_ready_project/`-equivalent in
the new repo. Either `.gitignore` the generated tree entirely, or — if a canonical generated
artifact is intentionally version-controlled for inspection — add a CI check that it is
byte-identical to a fresh `build-project` run, so it can never silently drift the way the golden
repo's copy did.

## 6. Dependency versions (for pinning)

```json
"dependencies": { "@remotion/cli": "^4.0.0", "react": "^18.3.1", "react-dom": "^18.3.1", "remotion": "^4.0.0" },
"devDependencies": { "@types/react": "^18.3.1", "typescript": "^5.4.0" }
```
Resolved: `remotion 4.0.489`, `@remotion/cli 4.0.489`, `react 18.3.1`, `react-dom 18.3.1`,
`typescript 5.9.3`, `@types/react 18.3.31`. `tsconfig.json`: `target ES2020, module ESNext,
moduleResolution node, jsx react-jsx, strict true, resolveJsonModule true, lib [ES2020, DOM]`.
