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

orvyq_speech_qa.py --project-id <id> [--media <path>] [--max-seconds N]
  reads   assets/audio/final_mix.mp3 (or --media), voice/voice_script.txt,
          direction/editorial_blueprint.json (canonical minimum_script_similarity)
  writes  qa/speech_transcript.json

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

## QA chain (Phase 4)

Pre-render gates, run after `orvyq_edit_plan.mjs` (`npm run orvyq:audits`):
`orvyq_evidence_audit.mjs` → `qa/evidence_coverage.json`,
`orvyq_evidence_asset_audit.mjs` → `qa/evidence_asset_audit.json`,
`orvyq_semantic_visual_audit.mjs` → `qa/semantic_visual_audit.json`,
`orvyq_pacing_audit.mjs` → `qa/pacing_audit.json`,
`orvyq_mobile_legibility_audit.mjs` → `qa/mobile_legibility_audit.json`,
`orvyq_music_cue_audit.mjs` → `qa/music_cue_audit.json`.

Then (`npm run orvyq:qa` runs `orvyq:audits` plus these three):
`orvyq_edit_plan_tests.mjs` (whole-pipeline smoke test over the plan + all of the above),
`orvyq_license_audit.mjs` → `qa/license_audit.json`,
`orvyq_alignment_score.mjs` → `qa/alignment_readiness.json` (pre-render readiness only, explicitly
not the final human-reviewed Aperture alignment score).

Post-render gates, run against the rendered MP4 (require `ffmpeg`, CI-only):
`orvyq_media_qa.mjs --video <path>` → `qa/orvyq_preview_media_qa.json`,
`orvyq_brightness_repair.mjs --video <path>` → `qa/orvyq_brightness_repair.json` (mutates the
video in place if it finds and repairs isolated corrupted frames).

Every QA script exits non-zero and sets `pass: false` in its written report on a blocking
failure — verified for all 12 (see Phase 4 commit). One structural fix vs golden:
`orvyq_license_audit.mjs` now accumulates into `{pass, failures[]}` like the other 11, instead of
throwing at the first failed check with no `pass`/`failures` field in the written report (see
`docs/source-audit.md` §3). Another: the `script_similarity >= 0.85` threshold, previously
hardcoded independently in three places (`orvyq_speech_qa.py`'s own 0.55 default,
`orvyq_edit_plan_tests.mjs`, `orvyq_media_qa.mjs`), now reads
`editorial_blueprint.json.global_rules.minimum_script_similarity` in all three.

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

## Verified in Phase 4

Ran the full pure-JS QA chain end-to-end against the real generated proof plan (real
`direction/`/`research/`/`voice/` data, realistically-sized stub footage/evidence/audio
binaries): `orvyq_evidence_audit` (weighted coverage 100%), `orvyq_evidence_asset_audit` (11
official captures, all SHA-256/byte-size verified), `orvyq_semantic_visual_audit`
(evidence_archive_fraction 0.579, contextual_body_footage_fraction 0.318, emphasis_beat_count 4,
maximum_uninterrupted_evidence_seconds 12.73 — all real numbers computed from the actual
generated shot plan, each correctly inside the required range), `orvyq_pacing_audit`,
`orvyq_mobile_legibility_audit`, `orvyq_music_cue_audit` (continuous 5-state coverage, confirming
the `start_seconds`/`end_seconds` field rename is consistent end to end), `orvyq_license_audit`,
and `orvyq_alignment_score` (readiness 88.06, above the 82 minimum) — all PASS.
`orvyq_edit_plan_tests.mjs` executed through every check up to the footage-duration
cross-reference, which needs real `ffprobe` (unavailable in this sandbox — the only remaining
blocker, not a logic gap). `orvyq_media_qa.mjs`/`orvyq_brightness_repair.mjs`/`orvyq_speech_qa.py`
need a real rendered video / real ASR and are deferred to Phase 5's CI run.
