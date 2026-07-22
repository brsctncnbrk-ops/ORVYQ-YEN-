# scripts/ — canonical pipeline

One generator per concern, each exporting a `buildCanonicalX()` function callable both
programmatically and via CLI (`node scripts/orvyq_*.mjs [--flags]`). Every generator is
parameterized by `mode` (`"proof"|"full"`) where relevant — there is no env-var-gated fork to a
separate module the way the golden system had. See `docs/migration-plan.md` for the full
architectural rationale.

## Pipeline order

```
orvyq_fetch_primary_evidence.mjs   research/primary_evidence_manifest.json
  → writes assets/evidence/primary_evidence.runtime.json

orvyq_fetch_music.mjs              (proof mode; full mode needs real full-length music,
  → writes assets/music/approved_bed.mp3 + .provenance.json    blocked on Phase 6)

orvyq_audio_mix.mjs   buildCanonicalAudioMix(projectId, {mode, durationSeconds, ...})
  reads   assets/audio/final_voice.mp3, voice/audio_repair.json?,
          direction/editorial_pause_map.json (if editorialPauses),
          assets/music/approved_bed.mp3 (if present)
  writes  assets/audio/final_mix.mp3 + final_mix.metadata.json

  (qa/speech_transcript.json is produced by Phase 4's orvyq_speech_qa.py, not by
   anything in this directory -- it is an ASR/QA step, ported in Phase 4.)

orvyq_caption_build.mjs   buildCanonicalCaptions(projectId, {frameEnd})
  reads   direction/edit_plan.json, qa/speech_transcript.json,
          voice/voice_script.txt, assets/audio/final_mix.metadata.json
  writes  remotion/captions.json

orvyq_edit_plan.mjs   buildCanonicalEditPlan(projectId, {mode, frameEnd})
  mode=proof reads  direction/cinematic_proof_cut.json + proof_preview_cut.json +
                     motion_hook.json + research/primary_evidence_manifest.json +
                     assets/evidence/primary_evidence.runtime.json
  mode=full  reads  direction/editorial_blueprint.json's full_production.shots +
                     the resolved evidence map (research/evidence_map.json +
                     evidence_resolutions.json)
  writes  direction/edit_plan.json   (schema_version "1.0-canonical" in BOTH modes)

  NOTE: captions must be built AFTER the edit plan in a real pipeline run --
  the order above (captions before edit_plan) matches the golden repo's own
  step order for historical-command fidelity, but orvyq_caption_build.mjs
  reads the edit plan's frame_range, so run orvyq_edit_plan.mjs first.

orvyq_asset_registry.mjs   buildCanonicalAssetRegistry(projectId)
  reads   direction/edit_plan.json (which footage/evidence assets are actually used),
          direction/editorial_blueprint.json (reuse limit),
          research/primary_evidence_manifest.json, assets/audio/final_mix.metadata.json
  writes  assets/asset_registry.json

remotion_build.mjs derive-configs --project-id <id>
  reads   direction/edit_plan.json, config/video_config.json
  writes  remotion/scene_config.json, remotion/asset_map.json

remotion_build.mjs build-project --project-id <id>
  reads   templates/remotion/**, remotion/scene_config.json, remotion/asset_map.json,
          remotion/captions.json, direction/edit_plan.json
  writes  projects/<id>/remotion/render_ready_project/**  (always regenerated, never
          hand-committed -- see docs/golden-renderer-map.md section 5)
```

Render itself is a Remotion CLI invocation against the assembled `render_ready_project`,
selecting `direction/edit_plan.json`'s own `frame_range` (proof: `0..N`; full: `0..duration_frames`)
— see `docs/migration-plan.md` §2 for why this is the one place proof/full genuinely differ.

## What changed vs the golden scripts (docs/source-audit.md section 7 / migration-plan.md section 1)

- `orvyq_edit_plan.mjs` now contains BOTH the proof and full generation logic in one file, one
  function, parameterized by `mode` — replacing the golden `orvyq_preview_plan.mjs` +
  `orvyq_edit_plan.mjs`'s full branch (two files, env-var dispatch, three different
  `schema_version` strings).
- `orvyq_audio_mix.mjs`'s music-arc ducking curve and SFX placement are now derived from the
  same per-duration `musicSectionsForDuration()` output and from real `pauseWindows` data,
  instead of literal 150-second-proof breakpoints hardcoded a second time. Verified: at 150s the
  ducking curve reproduces the exact historical breakpoints; at other durations it rescales with
  no leftover 150s-only literals (see commit history for the dry-run proof).
- `scripts/lib/orvyq-motion-hook.mjs`'s `auditMotionHook()` no longer trivially passes for
  `mode: "full"` — the opening hook is validated regardless of mode, since it's the cold open of
  the canonical timeline either way.
- `remotion_build.mjs` no longer reads `remotion/composition.json`. That file was a second,
  independent scene-authoring surface (from an earlier general-purpose "factforge-motion"
  workflow) that only needed to declare *some* duration long enough for `--frames` to be valid —
  it did not describe what `Video.tsx` actually renders (that always came from
  `direction/edit_plan.json`). `remotion/scene_config.json` (which really does drive
  `Root.tsx`'s `<Composition>` dimensions) is now derived directly from the canonical edit plan's
  own `fps`/`duration_frames` plus `config/video_config.json`'s `width`/`height` — one
  authoring surface, not two that could silently disagree.

## Verified in Phase 3 (see commit for full detail)

Ran the full chain end-to-end against real recovered project data (`direction/`, `research/`,
`voice/`, `config/`) plus locally-constructed stand-ins for the pieces that require network
fetch or `ffmpeg`/ASR (not available in this sandbox — genuinely require CI, matching the golden
system's own "render only happens on GitHub Actions" convention):
`buildCanonicalEditPlan(mode: "proof")` → 30 shots, exactly 4500 frames (150s @ 30fps, matching
the historical proof) → `buildCanonicalCaptions` → 61 caption chunks, correctly capped at the
plan's `frame_range` → `buildCanonicalAssetRegistry` → 22 registered assets, all schema-valid →
`derive-configs` + `build-project` → the assembled `render_ready_project` type-checks with zero
errors and its `FactForgeVideo` composition resolves to exactly `30fps 1920x1080 4500 frames
(150.00 sec)` in headless Chrome. `mode: "full"` correctly fails with the real, expected
blocker (`full_production.status=blocked_until_research_and_assets_complete`) — this is genuine
project state, not a bug.

Not yet run: `orvyq_audio_mix.mjs`'s actual `ffmpeg` execution (no `ffmpeg`/`ffprobe` in this
sandbox — syntax-checked only) and any step requiring real fetched binary assets. Both require
the CI environment and arrive with Phase 5.
