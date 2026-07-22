# Phase 0 — Source Audit

This document is the ground-truth inventory of what exists in the golden source
repository, what the approved historical proof was built from, and exactly what
commands produced it. It is derived from a direct inspection of
`brsctncnbrk-ops/YouTube_pepline` at the merge commit GitHub Actions used for
PR #10, not from assumption.

## 1. Golden source coordinates

| Field | Value |
|---|---|
| Repository | `brsctncnbrk-ops/YouTube_pepline` |
| PR | [#10](https://github.com/brsctncnbrk-ops/YouTube_pepline/pull/10) — "Build ORVYQ 150-second cinematic proof" |
| PR state | **open, draft** (not merged) — base branch `claude/factforge-system-design-0pr3v3` |
| PR head branch | `agent/orvyq-video-revision` |
| PR head commit | `41ca17046acb795229950fd7a5a18463a2a97f85` |
| PR merge commit (used by Actions) | `9affbd2494d8197a564c4a552b879fadb0e14a4a` |
| Workflow | `.github/workflows/orvyq-preview.yml`, "ORVYQ 150-Second Cinematic Proof" |
| Workflow run | [29655003486](https://github.com/brsctncnbrk-ops/YouTube_pepline/actions/runs/29655003486), run #75, conclusion `success` |
| Artifact | `orvyq-cinematic-proof-150s-29655003486` (id `8432918866`) |
| Repo system name | The system is internally called **FactForge** (`package.json` name `"factforge"`); ORVYQ is the project/video codename, not the system name. This distinction is preserved throughout this audit. |

**Important correction to record:** PR #10 is **not merged**. The "PR merge commit" `9affbd2494d8...` is the synthetic `refs/pull/10/merge` commit GitHub creates for `pull_request`-triggered CI, not a commit that landed on any branch. This is expected/normal for a `pull_request` trigger and does not indicate missing data — the full tree at that commit is what was inspected for this audit (cloned and checked out directly).

## 2. Exact historical commands (transcribed from `orvyq-preview.yml`)

Job env (all six proof-mode environment variables, verbatim):

```yaml
env:
  PROJECT_ID: 001-the-ai-race-no-one-can-afford-to-win
  ORVYQ_PREVIEW_FRAMES: "4500"
  ORVYQ_AUDIO_LIMIT_SECONDS: "150"
  ORVYQ_NARRATION_LIMIT_SECONDS: "114.2"
  ORVYQ_EDITORIAL_PAUSES: "1"
  ORVYQ_CINEMATIC_PROOF: "1"
  ORVYQ_REQUIRE_APPROVED_MUSIC: "1"
```

Ordered step commands:

1. `actions/checkout@v4` with `lfs: true`
2. Lock exact source commit: `ACTUAL_SHA="$(git rev-parse HEAD)"; test "$ACTUAL_SHA" = "$GITHUB_SHA"` → `render-source-sha.txt`
3. `git lfs pull`
4. `actions/setup-node@v4` (`node-version: "20"`, `cache: npm`)
5. `actions/setup-python@v5` (`python-version: "3.11"`)
6. `npm ci`; `sudo apt-get install -y ffmpeg poppler-utils`; `python -m pip install faster-whisper==1.2.0 requests==2.32.5`
7. `node scripts/orvyq_fetch_primary_evidence.mjs`
8. `node scripts/orvyq_fetch_proof_music.mjs`
9. `node scripts/orvyq_audio_mix.mjs`
10. `python scripts/orvyq_speech_qa.py --project-id "$PROJECT_ID" --max-seconds 150` (diagnostic-capture pattern, `set +e` → status file → `exit 0`)
11. Upload narration diagnostics artifact
12. Gate: `test "$(cat narration-qa.status)" = "0"`
13. `node scripts/orvyq_caption_build.mjs; node scripts/orvyq_preview_plan.mjs`
14. `node scripts/orvyq_evidence_audit.mjs`; `orvyq_evidence_asset_audit.mjs`; `orvyq_semantic_visual_audit.mjs`; `orvyq_pacing_audit.mjs`; `orvyq_mobile_legibility_audit.mjs`; `orvyq_music_cue_audit.mjs` (hard-fail, `set -euo pipefail`)
15. `node scripts/remotion_build.mjs derive-configs --project-id "$PROJECT_ID"`; `node scripts/remotion_build.mjs build-project --project-id "$PROJECT_ID"`
16. `orvyq_edit_plan_tests.mjs`, `orvyq_license_audit.mjs`, `orvyq_alignment_score.mjs` (diagnostic-capture pattern)
17. Upload editorial diagnostics artifact
18. Gate: three `test ... = "0"` checks (editorial/license/alignment status)
19. `cd .../render_ready_project; npm ci --no-audit --no-fund; npx tsc --noEmit`
20. Resolve `google-chrome-stable`/`chromium` → export `FACTFORGE_REMOTION_BROWSER_EXECUTABLE`
21. **`npx remotion render src/index.ts FactForgeVideo out/orvyq_cinematic_proof_150s.mp4 --codec=h264 --frames=0-4499 --concurrency=1 --image-format=png`**
22. `node scripts/orvyq_brightness_repair.mjs --project-id "$PROJECT_ID" --video .../out/orvyq_cinematic_proof_150s.mp4` (hard gate)
23. `python scripts/orvyq_speech_qa.py --project-id "$PROJECT_ID" --media .../out/orvyq_cinematic_proof_150s.mp4 --max-seconds 150 --output-name speech_transcript.json` (hard gate, overwrites pre-render transcript)
24. `node scripts/orvyq_media_qa.mjs --project-id "$PROJECT_ID" --video .../out/orvyq_cinematic_proof_150s.mp4 --report .../qa/orvyq_preview_media_qa.json` (diagnostic-capture pattern)
25. Generate 4 ffmpeg contact sheets + `ffprobe` probe JSON (`if: always()`)
26. Upload final artifact `orvyq-cinematic-proof-150s-${{ github.run_id }}` (14-day retention) — includes the MP4, contact sheets, probe JSON, render stdout, and every QA JSON produced
27. Gate: `test "$(cat media-qa.status)" = "0"`

**The single place the 150s/4500-frame boundary is applied is step 21's `--frames=0-4499` CLI flag** against the same `src/index.ts` / `FactForgeVideo` composition used for full renders (`render.yml` has no `--frames` flag). This is the one clean "proof = frame-range-limited execution of the same renderer" seam already present in the golden system, and it is the seam the rebuild must preserve and generalize — see `docs/migration-plan.md` §2 for where the *upstream data pipeline* does **not** yet meet this bar.

`4500 frames / 30 fps = 150 seconds`, matching `ORVYQ_AUDIO_LIMIT_SECONDS=150`.

## 3. Required source files (by area)

### 3.1 Renderer core — `templates/remotion/`
Canonical (all to be recovered verbatim, then de-hardcoded where noted in `docs/migration-plan.md`):
`src/index.ts`, `src/Root.tsx`, `src/Video.tsx`, `src/Scene.tsx`, `src/CaptionLayer.tsx`,
`src/EditorialOverlay.tsx`, `src/EvidenceVisual.tsx`, `src/EmphasisCard.tsx`, `src/OrvyqGraphic.tsx`,
`src/PrimaryEvidenceV2.tsx`, `remotion.config.ts`, `tsconfig.json`, `package.json`, `package-lock.json`.

`src/PrimaryEvidence.tsx` is **dead code** (only its exported TypeScript types are reused by
`PrimaryEvidenceV2.tsx`; its own component is never imported by `Scene.tsx`) — see
`docs/golden-renderer-map.md` §4 for the recommended handling (types extracted to a shared
module, component itself not carried forward as a renderer).

### 3.2 Timeline/edit/audio/caption/evidence generator scripts — `scripts/`
`orvyq_preview_plan.mjs`, `orvyq_edit_plan.mjs`, `orvyq_caption_build.mjs`, `orvyq_audio_mix.mjs`,
`orvyq_fetch_proof_music.mjs`, `orvyq_fetch_primary_evidence.mjs`, `remotion_build.mjs`,
`lib/orvyq-evidence.mjs`, `lib/orvyq-motion-hook.mjs`, `lib/fs-utils.mjs` (shared helper, not
listed in the task but required by every script above).

### 3.3 QA chain — `scripts/`
`orvyq_edit_plan_tests.mjs`, `orvyq_evidence_audit.mjs`, `orvyq_evidence_asset_audit.mjs`,
`orvyq_semantic_visual_audit.mjs`, `orvyq_pacing_audit.mjs`, `orvyq_mobile_legibility_audit.mjs`,
`orvyq_music_cue_audit.mjs`, `orvyq_license_audit.mjs`, `orvyq_alignment_score.mjs`,
`orvyq_media_qa.mjs`, `orvyq_brightness_repair.mjs`, `orvyq_speech_qa.py`.

**Verified: none of the 12 QA scripts silently pass on a blocking condition.** Every script sets
`process.exitCode = 1` (Node) or raises `SystemExit` (Python) in its failure path. One structural
inconsistency was found (not a fail-to-exit defect): `orvyq_license_audit.mjs` throws directly at
each check site rather than accumulating into a `pass`/`failures[]` report shape like the other 11
scripts, so `qa/license_audit.json` alone cannot show *why* a failed run failed — the reason is
only visible in the captured log. The rebuild should normalize this to the common
`{pass, failures[]}` report shape.

**Threshold-drift flag:** `orvyq_speech_qa.py --min-similarity` defaults to **0.55**, while
`orvyq_edit_plan_tests.mjs` and `orvyq_media_qa.mjs` both independently re-check the same
`script_similarity` output field against **0.85**. The enforced floor currently lives in three
separate places. The rebuild should consolidate this into one canonical policy value
(`editorial_blueprint.json.global_rules`), not three hardcoded numbers.

### 3.4 Project data — `projects/001-the-ai-race-no-one-can-afford-to-win/`
See `docs/file-classification.md` for the full per-file classification. Canonical direction/
research/voice inputs required for proof parity:
`direction/cinematic_proof_cut.json`, `direction/editorial_blueprint.json`,
`direction/editorial_pause_map.json`, `direction/motion_hook.json`, `direction/music_cue_sheet.json`,
`direction/cinematic_revision_plan.json`, `research/primary_evidence_manifest.json`,
`research/evidence_asset_manifest.json`, `research/evidence_map.json`,
`research/evidence_resolutions.json`, `voice/voice_script.txt`, `voice/narration_status.json`,
plus `remotion/composition.json` and the full `assets/footage/*.mp4` + `*.provenance.json`,
`assets/audio/final_voice.mp3`, `assets/evidence/` sets (Git LFS binaries).

`direction/proof_preview_cut.json` (a **superseded, competing 120s zero-footage proof spec**,
`forbidden_asset_prefixes: ["assets/footage/"]`) is **not** what produced the approved 150s
proof — the 150s cinematic proof is driven by `cinematic_proof_cut.json` +
`cinematic_revision_plan.json` (`approval_status: "user_approved"`). Both files exist in the
golden repo; only the 150s cut is canonical for parity purposes. See
`docs/file-classification.md` §1.7 for detail.

### 3.5 Workflows — `.github/workflows/`
Legitimate, to be carried forward: `ci.yml` (generic CI gate), `orvyq-preview.yml` (proof
workflow — the one to reproduce), `render.yml` (full-render workflow, correctly gated behind
`quality_control_approved` + `approved_preview_run_id` inputs, never yet run to completion for
this project).

Obsolete, **not** to be carried forward: `orvyq-debug.yml` (targets a superseded 120s scope,
duplicates ~80% of `orvyq-preview.yml` with less diagnostic granularity, never renders),
`orvyq-debug-trigger.txt` (a dead manual-CI-nudge placeholder referencing an unrelated commit
SHA, not a valid workflow file, no automation reads it).

## 4. Dependencies (with resolved versions, for pinning)

### Root `package.json`
```json
{ "dependencies": { "ajv": "^8.17.1", "ajv-formats": "^3.0.1" } }
```
Resolved: `ajv 8.20.0`, `ajv-formats 3.0.1`. Node engine: `>=18`.

### `templates/remotion/package.json`
```json
{
  "dependencies": { "@remotion/cli": "^4.0.0", "react": "^18.3.1", "react-dom": "^18.3.1", "remotion": "^4.0.0" },
  "devDependencies": { "@types/react": "^18.3.1", "typescript": "^5.4.0" }
}
```
Resolved: `remotion 4.0.489`, `@remotion/cli 4.0.489`, `react 18.3.1`, `react-dom 18.3.1`,
`typescript 5.9.3`, `@types/react 18.3.31`.

### External tooling (system/CI-level, unpinned via apt today — flagged for the rebuild to pin more tightly where feasible)
- Node 20, Python 3.11
- `ffmpeg`, `poppler-utils` (`pdftoppm`) — apt, unpinned
- `faster-whisper==1.2.0`, `requests==2.32.5` — pip, pinned
- Git LFS (`.gitattributes`: `*.mp3 *.png *.mp4 *.wav *.jpg *.jpeg`)
- Chromium/Chrome, resolved at runtime via `FACTFORGE_REMOTION_BROWSER_EXECUTABLE` — `remotion.config.ts`
  hard-fails if this env var is unset, deliberately refusing Remotion's own browser auto-download.

## 5. Generated outputs (must never be hand-edited; always regenerated by scripts)

`remotion/scene_config.json`, `remotion/asset_map.json` (from `remotion_build.mjs derive-configs`);
`direction/edit_plan.json` (from `orvyq_preview_plan.mjs` or `orvyq_edit_plan.mjs`);
`remotion/captions.json` (from `orvyq_caption_build.mjs`);
`assets/audio/final_mix.mp3` + `.metadata.json` (from `orvyq_audio_mix.mjs`);
`assets/evidence/primary_evidence.runtime.json` (from `orvyq_fetch_primary_evidence.mjs`);
`assets/music/approved_bed.mp3` + `.provenance.json` (from `orvyq_fetch_proof_music.mjs`);
every `qa/*.json` report; `projects/<id>/remotion/render_ready_project/**` in full (destructive
`rm -rf` + copy from `templates/remotion/`, plus a `src/data/` overlay — see
`docs/golden-renderer-map.md` §5).

**The golden repo's checked-in `render_ready_project/` is stale and non-buildable** — it is
missing `CaptionLayer.tsx`, `EmphasisCard.tsx`, `PrimaryEvidence.tsx`, `PrimaryEvidenceV2.tsx`
entirely, its `EditorialOverlaySpec` union is missing the 5 evidence-visual types, and its
`scene_config.json` describes a completely different, older 21598-frame (≈720s) draft cut with
no evidence/graphic shots. This confirms it is disposable build output, not a hand-maintained
source, and the rebuild should not commit an equivalent generated tree at all (or must add a CI
check that it is byte-identical to a fresh build).

## 6. Obsolete / stale files found in the golden repo (not to be imported)

| File | Why |
|---|---|
| `qa/render_request_20260716T193950+03.json` | Orphaned manual-trigger file, added in the PR #10 merge commit itself; no script or workflow reads it. |
| `qa/editorial_revision_v2.json` | Paired with the above by `revision` name; also unreferenced anywhere in `scripts/` or `.github/workflows/`. |
| `assets/audio/.merge_work/concat.txt`, `concat_corrected.txt` | Leaked local-dev scratch state — absolute paths `/opt/youtube_pipeline/...` that don't exist in CI; zero references in `scripts/`. |
| `footage/missing_assets.json`, `footage/acquired_assets.json` | Embed a local-machine absolute path (`/root/factforge-footage-cleanup-audits/...`) in `last_cleanup_audit`; portability smell, currently benign content. |
| `footage/production_candidates.json` (411 KB, largest tracked file) | Regenerable raw API search-result cache, not curated content. |
| `.github/workflows/orvyq-debug.yml` | Superseded 120s-scope debug workflow, duplicates `orvyq-preview.yml` with less rigor, never renders. |
| `.github/workflows/orvyq-debug-trigger.txt` | Dead manual-CI-nudge placeholder, not a real workflow file. |
| `remotion/render_ready_project/.gitignore`'s `*.corrupt-617mb`, root `.gitignore`'s `src/*.corrupt-*` | Codified debris from a historical Remotion/Chrome rendering-corruption bug, patched around (`orvyq_brightness_repair.mjs`) rather than root-caused. Worth carrying the *repair QA step* forward (it's a legitimate hard gate in CI) but not the ignore-pattern debris framing. |
| `prompts/` tree (152 KB Leonardo/AI-image prompts) | Likely wholly obsolete — the project pivoted to licensed footage + official evidence captures; confirm before deciding whether to import any of it. |
| `direction/proof_preview_cut.json` | Superseded 120s zero-footage proof spec; the shipped 150s proof used `cinematic_proof_cut.json` instead. Historically informative, not canonical for parity. |
| `fact_audit/claims.json` vs `research/evidence_map.json`'s `claims[]` | Two parallel claim registries under different schemas — needs reconciliation, not blind duplication, in the canonical asset/evidence registry (Phase 2). |

## 7. Proof-only hardcoding found in code (to be removed per the task's Phase 3 example)

| Location | Hardcode |
|---|---|
| `scripts/orvyq_audio_mix.mjs:10` | `PROOF_SECONDS = 150` module constant |
| `scripts/orvyq_audio_mix.mjs:11-17` | `PROOF_MUSIC_SECTIONS` — absolute-second music-arc boundaries (35, 59.62, 93.4, 126.56, 150) |
| `scripts/orvyq_audio_mix.mjs:242-247` | `musicVolumeExpression()` — FFmpeg ducking curve with the same absolute-second breakpoints; **does not rescale** for non-150s durations (latent bug for a real full-length render) |
| `scripts/orvyq_audio_mix.mjs:257-262`, `349-355` | SFX `adelay` offsets and `sfxPlacements` hardcoded to 150s-proof-specific beats (11s, 23.74s, 52.62s, 93.4s, 126.56s), no scaling logic |
| `scripts/orvyq_audio_mix.mjs:307-308` | Any render `>150.1s` unconditionally requires approved licensed music (no fallback score) — a hard behavioral fork keyed on absolute duration |
| `scripts/orvyq_fetch_proof_music.mjs:22` | Downloaded track duration must be `>= 150s` — hardcoded proof-length floor baked into fetch verification itself |
| `scripts/orvyq_edit_plan.mjs:16-17` | `if (previewFrames > 0) return buildOrvyqPreviewPlan(...)` — a hard dispatch to an entirely separate module, not a parameterized call |
| `scripts/orvyq_preview_plan.mjs:358-360` | `edit_plan.json.schema_version` literally branches on `ORVYQ_CINEMATIC_PROOF` (`"7.0-cinematic-proof"` vs `"6.3-motion-hook-evidence-proof"`); `orvyq_edit_plan.mjs`'s full path writes a third value (`"5.1-evidence-led-full"`) |
| `scripts/lib/orvyq-motion-hook.mjs:23-32` | `auditMotionHook()` short-circuits to a trivial pass when `!plan.preview` — the hook-continuity audit is only ever meaningfully enforced on preview/proof plans |
| `templates/remotion/src/PrimaryEvidence.tsx:27`, `PrimaryEvidenceV2.tsx:115` | Literal narrative content string (`"16"` / `"leading models stress-tested"`) baked into the component instead of passed through the spec — duplicated verbatim in both files |
| `templates/remotion/src/OrvyqGraphic.tsx` (`modeFor()`) | Hardcoded whitelist of this-video's specific graphic `type` string literals (e.g. `brand_open`, `fire_drill`, `audit_tradeoff`) — couples a supposedly generic renderer to one video's editorial vocabulary |

These are cataloged for Phase 3 remediation, not fixed in Phase 0. Phase 0 makes no code
changes.

## 8. External tool dependency summary

| Tool | Used by | Purpose |
|---|---|---|
| Remotion CLI 4.0.489 | render step | Actual video rendering |
| Chromium/Chrome (env-resolved) | Remotion | Headless render browser |
| ffmpeg | `orvyq_audio_mix.mjs`, `orvyq_media_qa.mjs`, `orvyq_brightness_repair.mjs`, contact-sheet step | Audio mixing/mastering, media QA, frame repair, thumbnails |
| poppler-utils (`pdftoppm`) | `orvyq_fetch_primary_evidence.mjs` | Rasterize PDF evidence pages to PNG at 150dpi |
| faster-whisper 1.2.0 (Python) | `orvyq_speech_qa.py` | ASR transcription for narration/caption verification |
| Git LFS | checkout | All binary media (footage, audio, evidence images) |
