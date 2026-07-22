#!/usr/bin/env node
// buildRenderProject() -- assembles the render-ready Remotion app from the
// canonical edit plan. Always regenerate before use; never hand-edit the
// output (see docs/golden-renderer-map.md section 5).
//
// Deliberate simplification vs the golden source: the golden pipeline had
// TWO independent scene-authoring surfaces feeding the renderer --
// remotion/composition.json (a generic, project-agnostic 33-scene format
// authored by the older "factforge-motion" skill, never updated for the
// ORVYQ-specific proof/full split) drove Root.tsx's Composition
// dimensions via a derived scene_config.json, while direction/edit_plan.json
// (the actual ORVYQ shot list) drove Video.tsx's rendered content. These
// could disagree -- composition.json only needed to declare a duration long
// enough for `--frames` to be valid, not to describe what actually renders.
// That redundant surface is gone here: scene_config.json's fps/duration_frames
// come directly from the canonical edit plan, and width/height come from
// config/video_config.json. There is exactly one place the timeline's shape
// is authored.
import path from "node:path";
import { promises as fs } from "node:fs";
import { TEMPLATES_DIR, projectDir, pathExists, readJson, writeJsonAtomic, copyDir, parseArgs, printJson, CliError } from "./lib/fs-utils.mjs";

function isPathInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export async function assertSafeBundleOutput({ publicDir, outputDir, sourceRoot }) {
  const resolvedPublic = path.resolve(publicDir);
  const resolvedOutput = path.resolve(outputDir);
  const resolvedSource = path.resolve(sourceRoot);
  if (resolvedOutput === resolvedPublic) throw new CliError("Bundle output directory cannot equal the Remotion public directory", "RENDER_CONFIG_MISSING");
  if (isPathInside(resolvedOutput, resolvedPublic)) throw new CliError("Bundle output directory cannot be inside the Remotion public directory", "RENDER_CONFIG_MISSING");
  if (isPathInside(resolvedPublic, resolvedOutput)) throw new CliError("Remotion public directory cannot be inside the bundle output directory", "RENDER_CONFIG_MISSING");
  if (resolvedOutput === resolvedSource || isPathInside(resolvedOutput, resolvedSource)) throw new CliError("Bundle output directory cannot be inside the source tree", "RENDER_CONFIG_MISSING");
  return { public_dir: resolvedPublic, output_dir: resolvedOutput, source_root: resolvedSource };
}

async function loadEditPlan(projectId) {
  const editPlanPath = path.join(projectDir(projectId), "direction", "edit_plan.json");
  if (!(await pathExists(editPlanPath))) throw new CliError(`direction/edit_plan.json not found for ${projectId} -- run buildCanonicalEditPlan first`, "RENDER_CONFIG_MISSING");
  return readJson(editPlanPath);
}

export async function deriveConfigs({ projectId }) {
  const dir = projectDir(projectId);
  const [editPlan, videoConfig] = await Promise.all([
    loadEditPlan(projectId),
    readJson(path.join(dir, "config", "video_config.json"))
  ]);
  const sceneConfig = { fps: editPlan.fps, width: videoConfig.width, height: videoConfig.height, duration_frames: editPlan.duration_frames };
  const assetMap = { audio_asset: editPlan.audio_mix_asset };
  await writeJsonAtomic(path.join(dir, "remotion", "scene_config.json"), sceneConfig);
  await writeJsonAtomic(path.join(dir, "remotion", "asset_map.json"), assetMap);
  return { project_id: projectId, derived: ["remotion/scene_config.json", "remotion/asset_map.json"], mode: editPlan.mode, frame_range: editPlan.frame_range, duration_frames: sceneConfig.duration_frames };
}

async function refreshAssetManifest(projectId, editPlan) {
  const dir = projectDir(projectId);
  const mixMetadataPath = path.join(dir, "assets", "audio", "final_mix.metadata.json");
  const mixMetadata = (await pathExists(mixMetadataPath)) ? await readJson(mixMetadataPath) : null;

  const music = mixMetadata?.music_asset
    ? [{ file: mixMetadata.music_asset, status: (await pathExists(path.join(dir, mixMetadata.music_asset))) ? "available" : "missing", source: mixMetadata.music_profile === "approved_licensed_bed" ? "User-approved licensed music bed" : "Unknown" }]
    : [];
  const sfx = mixMetadata
    ? await Promise.all((mixMetadata.sfx_assets || []).filter(Boolean).map(async (file) => ({ file, status: (await pathExists(path.join(dir, file))) ? "available" : "missing", source: "Approved sound design asset" })))
    : [];

  const visuals = [];
  for (const shot of editPlan.shots) {
    if (shot.asset_type === "footage") {
      visuals.push({ shot_id: shot.shot_id, asset_type: "footage", file: shot.video_asset, status: (await pathExists(path.join(dir, shot.video_asset))) ? "available" : "missing" });
    } else if (shot.asset_type === "evidence") {
      for (const image of shot.evidence?.image_assets || []) {
        visuals.push({ shot_id: shot.shot_id, asset_type: "evidence", file: image, status: (await pathExists(path.join(dir, image))) ? "available" : "missing" });
      }
    }
  }

  const manifest = {
    audio: {
      main_voice: { path: "assets/audio/final_voice.mp3", status: (await pathExists(path.join(dir, "assets", "audio", "final_voice.mp3"))) ? "available" : "missing" },
      final_mix: mixMetadata ? { path: mixMetadata.mix_asset, status: (await pathExists(path.join(dir, mixMetadata.mix_asset))) ? "available" : "missing" } : null
    },
    visuals,
    music,
    sfx,
    captions: { file: "remotion/captions.json", status: (await pathExists(path.join(dir, "remotion", "captions.json"))) ? "available" : "missing" }
  };
  await writeJsonAtomic(path.join(dir, "assets", "asset_manifest.json"), manifest);
  return manifest;
}

export async function buildProject({ projectId }) {
  const dir = projectDir(projectId);
  const editPlan = await loadEditPlan(projectId);
  for (const rel of ["remotion/scene_config.json", "remotion/asset_map.json", "remotion/captions.json"]) {
    if (!(await pathExists(path.join(dir, rel)))) throw new CliError(`${rel} missing - run deriveConfigs and buildCanonicalCaptions first`, "RENDER_CONFIG_MISSING");
  }
  const templateDir = path.join(TEMPLATES_DIR, "remotion");
  if (!(await pathExists(templateDir))) throw new CliError("templates/remotion/ is missing from the repo", "RENDER_CONFIG_MISSING");
  const dest = path.join(dir, "remotion", "render_ready_project");
  const previousHumanNotesPath = path.join(dest, "src", "data", "human_notes.json");
  const previousHumanNotes = (await pathExists(previousHumanNotesPath)) ? await fs.readFile(previousHumanNotesPath) : null;
  await fs.rm(dest, { recursive: true, force: true });
  await copyDir(templateDir, dest);
  const dataDir = path.join(dest, "src", "data");
  await fs.mkdir(dataDir, { recursive: true });
  await fs.copyFile(path.join(dir, "remotion", "scene_config.json"), path.join(dataDir, "scene_config.json"));
  await fs.copyFile(path.join(dir, "remotion", "asset_map.json"), path.join(dataDir, "asset_map.json"));
  await fs.copyFile(path.join(dir, "remotion", "captions.json"), path.join(dataDir, "captions.json"));
  await fs.copyFile(path.join(dir, "direction", "edit_plan.json"), path.join(dataDir, "edit_plan.json"));
  if (previousHumanNotes) await fs.writeFile(path.join(dataDir, "human_notes.json"), previousHumanNotes);
  const assetManifest = await refreshAssetManifest(projectId, editPlan);
  const missingAssets = [
    ...(assetManifest.audio.main_voice.status === "missing" ? [assetManifest.audio.main_voice.path] : []),
    ...(assetManifest.audio.final_mix?.status === "missing" ? [assetManifest.audio.final_mix.path] : []),
    ...assetManifest.visuals.filter((visual) => visual.status === "missing").map((visual) => visual.file),
    ...assetManifest.music.filter((item) => item.status === "missing").map((item) => item.file),
    ...assetManifest.sfx.filter((item) => item.status === "missing").map((item) => item.file),
    ...(assetManifest.captions.status === "missing" ? [assetManifest.captions.file] : [])
  ];
  return {
    project_id: projectId,
    mode: editPlan.mode,
    frame_range: editPlan.frame_range,
    render_ready_project: "remotion/render_ready_project",
    copied_configs: ["src/data/scene_config.json", "src/data/asset_map.json", "src/data/edit_plan.json", "src/data/captions.json"],
    asset_manifest_refreshed: true,
    missing_assets: missingAssets
  };
}

async function validateBundleOutputCommand(args) {
  return assertSafeBundleOutput({ publicDir: args["public-dir"], outputDir: args["output-dir"], sourceRoot: args["source-root"] || process.cwd() });
}

const SUBCOMMANDS = { "derive-configs": deriveConfigs, "build-project": buildProject, "validate-bundle-output": validateBundleOutputCommand };
async function main() {
  const [subcommand, ...rest] = process.argv.slice(2);
  const handler = SUBCOMMANDS[subcommand];
  if (!handler) {
    console.log("Usage: node scripts/remotion_build.mjs <derive-configs|build-project> --project-id <id>");
    process.exitCode = subcommand ? 1 : 0;
    return;
  }
  const args = parseArgs(rest);
  try {
    const result = subcommand === "validate-bundle-output" ? await handler(args) : await handler({ projectId: args["project-id"] });
    printJson({ ok: true, ...result });
  } catch (error) {
    printJson({ ok: false, error_code: error.code || "UNKNOWN_ERROR", message: error.message });
    process.exitCode = 1;
  }
}
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main();
