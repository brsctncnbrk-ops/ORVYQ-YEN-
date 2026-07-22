#!/usr/bin/env node
// buildCanonicalFrozenCandidate() -- snapshots exactly what a given render
// would produce, per schemas/frozen_candidate.schema.json (task section 10).
// Hashes are computed from the real, already-generated canonical outputs on
// disk (direction/edit_plan.json, remotion/captions.json,
// assets/audio/final_mix.metadata.json, assets/asset_registry.json) -- never
// invented. A proof_approval references this document by hashing it; full
// render is only permitted from the exact frozen_candidate a human approved.
import path from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { projectDir, readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";

async function sha256OfFile(absPath) {
  const buffer = await fs.readFile(absPath);
  return createHash("sha256").update(buffer).digest("hex");
}

function sha256OfJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function resolveSourceCommitSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  return execSync("git rev-parse HEAD").toString().trim();
}

async function resolveRendererVersion() {
  const pkg = await readJson(path.resolve("templates/remotion/package.json"));
  return `templates/remotion@${pkg.version}`;
}

export async function buildCanonicalFrozenCandidate(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const editPlanPath = path.join(dir, "direction", "edit_plan.json");
  const captionsPath = path.join(dir, "remotion", "captions.json");
  const audioMixPath = path.join(dir, "assets", "audio", "final_mix.metadata.json");
  const assetRegistryPath = path.join(dir, "assets", "asset_registry.json");

  const editPlan = await readJson(editPlanPath);
  const timeline = {
    fps: editPlan.fps,
    duration_frames: editPlan.duration_frames,
    blacklisted_assets: editPlan.blacklisted_assets || [],
    shots: editPlan.shots
  };

  const candidate = {
    project_id: projectId,
    source_commit_sha: resolveSourceCommitSha(),
    renderer_version: await resolveRendererVersion(),
    timeline_hash: sha256OfJson(timeline),
    edit_plan_hash: await sha256OfFile(editPlanPath),
    caption_hash: await sha256OfFile(captionsPath),
    audio_mix_hash: await sha256OfFile(audioMixPath),
    asset_registry_hash: await sha256OfFile(assetRegistryPath),
    selected_render_range: editPlan.frame_range,
    mode: editPlan.mode,
    created_at: new Date().toISOString()
  };

  await writeJsonAtomic(path.join(dir, "qa", "frozen_candidate.json"), candidate);
  return candidate;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  buildCanonicalFrozenCandidate(args["project-id"] || PROJECT_ID)
    .then((candidate) => printJson({ ok: true, ...candidate }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
