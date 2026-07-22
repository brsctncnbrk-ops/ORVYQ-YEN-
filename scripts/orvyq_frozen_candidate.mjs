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
import { projectDir, readJson, writeJsonAtomic, pathExists, parseArgs, printJson } from "./lib/fs-utils.mjs";

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

function resolveRendererCommitSha() {
  try {
    return execSync("git log -1 --format=%H -- templates/remotion").toString().trim() || null;
  } catch {
    return null;
  }
}

async function sha256OfFileIfExists(absPath) {
  if (!(await pathExists(absPath))) return null;
  return sha256OfFile(absPath);
}

async function readOptionalJson(absPath) {
  if (!(await pathExists(absPath))) return null;
  return readJson(absPath);
}

// Exported separately from buildCanonicalFrozenCandidate (which writes the
// result to qa/frozen_candidate.json) so scripts/orvyq_verify_approval.mjs
// can recompute what the CURRENT real files on disk would hash to and
// compare against the committed candidate, without ever overwriting it --
// verification must never have a side effect that could silently "fix" a
// stale approval.
export async function computeCanonicalFrozenCandidate(projectId = PROJECT_ID) {
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

  // Optional hardened fields (schemas/frozen_candidate.schema.json) -- added
  // without touching the required core fields above, so a frozen_candidate
  // produced before this hardening (and any proof_approval.json already
  // hashed against it) keeps validating and keeps its real, already-reviewed
  // approval; scripts/orvyq_verify_approval.mjs checks each of these when
  // present rather than requiring every historical candidate to have them.
  const rendererCommitSha = resolveRendererCommitSha();
  const pauseMapHash = await sha256OfFileIfExists(path.join(dir, "direction", "editorial_pause_map.json"));
  const scriptHash = await sha256OfFileIfExists(path.join(dir, "voice", "voice_script.txt"));
  const narrationStatus = await readOptionalJson(path.join(dir, "voice", "narration_status.json"));

  const candidate = {
    project_id: projectId,
    source_commit_sha: resolveSourceCommitSha(),
    renderer_version: await resolveRendererVersion(),
    timeline_hash: sha256OfJson(timeline),
    edit_plan_hash: await sha256OfFile(editPlanPath),
    caption_hash: await sha256OfFile(captionsPath),
    audio_mix_hash: await sha256OfFile(audioMixPath),
    asset_registry_hash: await sha256OfFile(assetRegistryPath),
    approval_version: "2.0-hash-hardened",
    ...(rendererCommitSha ? { renderer_commit_sha: rendererCommitSha } : {}),
    ...(narrationStatus?.narration_sha256 ? { narration_sha256: narrationStatus.narration_sha256 } : {}),
    ...(pauseMapHash ? { pause_map_hash: pauseMapHash } : {}),
    ...(scriptHash ? { script_hash: scriptHash } : {}),
    selected_render_range: editPlan.frame_range,
    mode: editPlan.mode,
    created_at: new Date().toISOString()
  };

  return candidate;
}

export async function buildCanonicalFrozenCandidate(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const candidate = await computeCanonicalFrozenCandidate(projectId);
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
