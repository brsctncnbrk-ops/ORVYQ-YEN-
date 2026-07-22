import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { deriveConfigs, assertSafeBundleOutput } from "./remotion_build.mjs";
import { PROJECTS_DIR, readJson, pathExists, writeJsonAtomic } from "./lib/fs-utils.mjs";

// deriveConfigs() is the one place that turns a canonical edit plan into the
// Remotion composition's own inputs (scene_config.json/asset_map.json). The
// task's core architectural requirement is that proof and full render
// through the exact same composition, differing only by frame range/data --
// these tests prove deriveConfigs contains no mode branch at all: it reads
// editPlan.fps/duration_frames/audio_mix_asset and video_config.width/height
// verbatim regardless of whether editPlan.mode is "proof" or "full".
const FIXTURE_PROJECT_ID = "999-parity-fixture-project";

async function withFixtureProject(editPlan, videoConfig, run) {
  const dir = path.join(PROJECTS_DIR, FIXTURE_PROJECT_ID);
  await fs.rm(dir, { recursive: true, force: true });
  try {
    await fs.mkdir(path.join(dir, "direction"), { recursive: true });
    await fs.mkdir(path.join(dir, "config"), { recursive: true });
    await writeJsonAtomic(path.join(dir, "direction", "edit_plan.json"), editPlan);
    await writeJsonAtomic(path.join(dir, "config", "video_config.json"), videoConfig);
    return await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("deriveConfigs derives scene_config.json identically for proof and full mode edit plans (same function, no mode branch)", async () => {
  const videoConfig = { target_duration_sec: 999, fps: 30, width: 1920, height: 1080 };
  const proofPlan = { mode: "proof", fps: 30, duration_frames: 4500, audio_mix_asset: "assets/audio/final_mix.mp3", frame_range: { start_frame: 0, end_frame: 4500 } };
  const fullPlan = { mode: "full", fps: 30, duration_frames: 25599, audio_mix_asset: "assets/audio/final_mix.mp3", frame_range: { start_frame: 0, end_frame: 25599 } };

  const proofResult = await withFixtureProject(proofPlan, videoConfig, async (dir) => {
    const result = await deriveConfigs({ projectId: FIXTURE_PROJECT_ID });
    const sceneConfig = await readJson(path.join(dir, "remotion", "scene_config.json"));
    const assetMap = await readJson(path.join(dir, "remotion", "asset_map.json"));
    return { result, sceneConfig, assetMap };
  });

  const fullResult = await withFixtureProject(fullPlan, videoConfig, async (dir) => {
    const result = await deriveConfigs({ projectId: FIXTURE_PROJECT_ID });
    const sceneConfig = await readJson(path.join(dir, "remotion", "scene_config.json"));
    const assetMap = await readJson(path.join(dir, "remotion", "asset_map.json"));
    return { result, sceneConfig, assetMap };
  });

  // Same composition dimensions/fps source (config/video_config.json) for both modes.
  assert.equal(proofResult.sceneConfig.width, 1920);
  assert.equal(fullResult.sceneConfig.width, 1920);
  assert.equal(proofResult.sceneConfig.height, fullResult.sceneConfig.height);

  // duration_frames/fps come straight from each mode's own edit plan -- the
  // ONLY difference between the two derived configs -- proving frame range
  // is a data parameter, not a second code path.
  assert.equal(proofResult.sceneConfig.duration_frames, 4500);
  assert.equal(fullResult.sceneConfig.duration_frames, 25599);
  assert.equal(proofResult.result.mode, "proof");
  assert.equal(fullResult.result.mode, "full");

  // Same asset_map derivation rule (audio_mix_asset passthrough) for both.
  assert.equal(proofResult.assetMap.audio_asset, "assets/audio/final_mix.mp3");
  assert.equal(fullResult.assetMap.audio_asset, "assets/audio/final_mix.mp3");
});

test("deriveConfigs throws before writing anything if direction/edit_plan.json is missing (fails closed, does not silently fall back)", async () => {
  const dir = path.join(PROJECTS_DIR, FIXTURE_PROJECT_ID);
  await fs.rm(dir, { recursive: true, force: true });
  try {
    await fs.mkdir(path.join(dir, "config"), { recursive: true });
    await writeJsonAtomic(path.join(dir, "config", "video_config.json"), { fps: 30, width: 1920, height: 1080 });
    await assert.rejects(() => deriveConfigs({ projectId: FIXTURE_PROJECT_ID }), /edit_plan\.json not found/);
    assert.equal(await pathExists(path.join(dir, "remotion", "scene_config.json")), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("assertSafeBundleOutput rejects an output dir nested inside the Remotion public dir", async () => {
  await assert.rejects(
    () => assertSafeBundleOutput({ publicDir: "/tmp/project", outputDir: "/tmp/project/out", sourceRoot: "/tmp/project/remotion" }),
    /cannot be inside the Remotion public directory/
  );
});

test("assertSafeBundleOutput accepts a properly separated public/output/source layout", async () => {
  const result = await assertSafeBundleOutput({ publicDir: "/tmp/project", outputDir: "/tmp/build-out", sourceRoot: "/tmp/project/remotion" });
  assert.equal(result.public_dir, path.resolve("/tmp/project"));
  assert.equal(result.output_dir, path.resolve("/tmp/build-out"));
});
