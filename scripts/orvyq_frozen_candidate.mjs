#!/usr/bin/env node
// buildCanonicalFrozenCandidate() -- snapshots exactly what a given render
// would produce, per schemas/frozen_candidate.schema.json (task section 10,
// hardened further per the follow-up task's section 10).
//
// Deterministic by construction: every field that varies run-to-run for
// otherwise-identical inputs (created_at, the approval_version label) lives
// under `operational_metadata`, OUTSIDE what `candidate_hash` is computed
// over. `canonical_candidate_identity` contains only fields that change if
// and only if a real creative, technical, or renderer input changed --
// building a candidate twice from the same inputs must produce the exact
// same candidate_hash and render_bundle_hash (verified by
// orvyq_frozen_candidate.test.mjs's determinism test).
//
// `render_bundle_hash` covers just the file-identity hashes that make up
// the actual render bundle (task section 8/9) -- edit plan, captions, audio,
// asset registry/manifest, renderer sources, render-ready project source.
// `candidate_hash` covers the render bundle hash PLUS the remaining
// identity fields (source commit, fps, frame range, mode) -- i.e. "the same
// render_bundle_hash but rendered from a different commit" is still a
// different candidate_hash, but "the same everything, checked at a later
// HEAD after an unrelated approval-record commit" is not (see
// scripts/orvyq_verify_approval.mjs, which is what actually enforces that
// distinction operationally).
import path from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { projectDir, readJson, writeJsonAtomic, pathExists, parseArgs, printJson } from "./lib/fs-utils.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";

export async function sha256OfFile(absPath) {
  const buffer = await fs.readFile(absPath);
  return createHash("sha256").update(buffer).digest("hex");
}

export function sha256OfJson(value) {
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

// Deterministic recursive hash of every file under a directory tree (sorted
// by relative path, hash-of-hashes -- NOT a hash of any single concatenated
// blob, so adding/removing/renaming a file always changes the result).
export async function sha256OfDirectoryTree(absDir, { skipDirs = new Set(["node_modules", "out", ".remotion"]) } = {}) {
  if (!(await pathExists(absDir))) return null;
  const entries = [];
  async function walk(current, relative) {
    const items = await fs.readdir(current, { withFileTypes: true });
    for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
      const childAbs = path.join(current, item.name);
      const childRel = relative ? `${relative}/${item.name}` : item.name;
      if (item.isDirectory()) {
        if (skipDirs.has(item.name)) continue;
        await walk(childAbs, childRel);
      } else {
        entries.push({ path: childRel, sha256: await sha256OfFile(childAbs) });
      }
    }
  }
  await walk(absDir, "");
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return sha256OfJson(entries);
}

// Builds the per-asset manifest (task section 14): every asset listed in
// assets/asset_registry.json, each hashed and sized directly from the real
// file on disk -- never trusted from the registry's own recorded sha256
// alone, so a stale registry entry cannot silently pass. A registered asset
// that is missing from disk is a hard failure, not an omission: freezing a
// candidate that references a file that doesn't exist would produce an
// approval for something that cannot actually render.
async function buildAssetManifest(dir, assetRegistry) {
  const manifest = [];
  const missing = [];
  for (const asset of assetRegistry.assets || []) {
    const absPath = path.join(dir, asset.path);
    if (!(await pathExists(absPath))) {
      missing.push(asset.path);
      continue;
    }
    const stat = await fs.stat(absPath);
    manifest.push({ path: asset.path, sha256: await sha256OfFile(absPath), bytes: stat.size, role: asset.type });
  }
  if (missing.length) throw new Error(`Cannot freeze candidate: ${missing.length} registered asset(s) are missing from disk: ${missing.join(", ")}`);
  manifest.sort((a, b) => a.path.localeCompare(b.path));
  return manifest;
}

// Exported separately from buildCanonicalFrozenCandidate (which writes the
// result to qa/frozen_candidate.json) so scripts/orvyq_verify_approval.mjs
// can recompute what the CURRENT real files on disk would hash to and
// compare against the committed candidate, without ever overwriting it --
// verification must never have a side effect that could silently "fix" a
// stale approval.
//
// `renderReadyDir` lets the caller point at the actual assembled
// render_ready_project (task section 7: freeze happens AFTER that build,
// not before) -- defaults to this project's own
// remotion/render_ready_project directory, but a test or a workflow step
// that assembled the bundle elsewhere can override it.
export async function computeCanonicalFrozenCandidate(projectId = PROJECT_ID, { renderReadyDir } = {}) {
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

  const rendererCommitSha = resolveRendererCommitSha();
  const pauseMapHash = await sha256OfFileIfExists(path.join(dir, "direction", "editorial_pause_map.json"));
  const scriptHash = await sha256OfFileIfExists(path.join(dir, "voice", "voice_script.txt"));
  const narrationStatus = await readOptionalJson(path.join(dir, "voice", "narration_status.json"));

  // Task section 14 hardening: direct hashes of the actual binary/config
  // assets a render depends on, not just the JSON documents that describe
  // them (a JSON metadata hash cannot catch e.g. final_mix.mp3 itself being
  // silently re-encoded without touching final_mix.metadata.json).
  const finalMixAudioHash = await sha256OfFileIfExists(path.join(dir, "assets", "audio", "final_mix.mp3"));
  const musicBedHash = await sha256OfFileIfExists(path.join(dir, "assets", "music", "approved_bed.mp3"));
  const remotionSceneConfigHash = await sha256OfFileIfExists(path.join(dir, "remotion", "scene_config.json"));
  const remotionAssetMapHash = await sha256OfFileIfExists(path.join(dir, "remotion", "asset_map.json"));
  const rendererPackageLockHash = await sha256OfFileIfExists(path.resolve("templates/remotion/package-lock.json"));
  const rendererSourceTreeHash = await sha256OfDirectoryTree(path.resolve("templates/remotion/src"));
  const assetRegistry = await readOptionalJson(assetRegistryPath);
  const assetManifest = assetRegistry ? await buildAssetManifest(dir, assetRegistry) : [];
  const assetManifestHash = assetManifest.length ? sha256OfJson(assetManifest) : null;

  // The assembled render_ready_project (task section 9): hashed AFTER it is
  // built, from the real directory on disk -- includes src/**, package.json,
  // package-lock.json, scene_config.json, asset_map.json, captions.json,
  // edit_plan.json as copied into the bundle. See docs/canonical-candidate-audit.md
  // for why this was previously undefined (both sides missing it made
  // orvyq_review_final_parity.mjs's check a no-op).
  const renderReadySourceHash = await sha256OfDirectoryTree(renderReadyDir || path.join(dir, "remotion", "render_ready_project"));

  const canonicalCandidateIdentity = {
    project_id: projectId,
    source_commit_sha: resolveSourceCommitSha(),
    renderer_version: await resolveRendererVersion(),
    timeline_hash: sha256OfJson(timeline),
    edit_plan_hash: await sha256OfFile(editPlanPath),
    caption_hash: await sha256OfFile(captionsPath),
    audio_mix_metadata_hash: await sha256OfFile(audioMixPath),
    asset_registry_hash: await sha256OfFile(assetRegistryPath),
    ...(rendererCommitSha ? { renderer_commit_sha: rendererCommitSha } : {}),
    ...(narrationStatus?.narration_sha256 ? { narration_sha256: narrationStatus.narration_sha256 } : {}),
    ...(pauseMapHash ? { pause_map_hash: pauseMapHash } : {}),
    ...(scriptHash ? { script_hash: scriptHash } : {}),
    ...(finalMixAudioHash ? { final_mix_audio_hash: finalMixAudioHash } : {}),
    ...(musicBedHash ? { music_bed_hash: musicBedHash } : {}),
    ...(remotionSceneConfigHash ? { remotion_scene_config_hash: remotionSceneConfigHash } : {}),
    ...(remotionAssetMapHash ? { remotion_asset_map_hash: remotionAssetMapHash } : {}),
    ...(rendererPackageLockHash ? { renderer_package_lock_hash: rendererPackageLockHash } : {}),
    ...(rendererSourceTreeHash ? { renderer_source_tree_hash: rendererSourceTreeHash } : {}),
    ...(assetManifestHash ? { asset_manifest_hash: assetManifestHash } : {}),
    ...(renderReadySourceHash ? { render_ready_source_hash: renderReadySourceHash } : {}),
    fps: editPlan.fps,
    total_frames: editPlan.duration_frames,
    selected_render_range: editPlan.frame_range,
    mode: editPlan.mode
  };

  // render_bundle_hash: the file-level identity of everything a render
  // actually consumes -- deliberately narrower than candidate_hash (which
  // also folds in source_commit_sha/fps/frame_range/mode as separate,
  // individually-checkable fields for scripts/orvyq_verify_approval.mjs).
  const renderBundleHash = sha256OfJson({
    edit_plan_hash: canonicalCandidateIdentity.edit_plan_hash,
    caption_hash: canonicalCandidateIdentity.caption_hash,
    audio_mix_metadata_hash: canonicalCandidateIdentity.audio_mix_metadata_hash,
    final_mix_audio_hash: canonicalCandidateIdentity.final_mix_audio_hash || null,
    music_bed_hash: canonicalCandidateIdentity.music_bed_hash || null,
    asset_registry_hash: canonicalCandidateIdentity.asset_registry_hash,
    asset_manifest_hash: canonicalCandidateIdentity.asset_manifest_hash || null,
    remotion_scene_config_hash: canonicalCandidateIdentity.remotion_scene_config_hash || null,
    remotion_asset_map_hash: canonicalCandidateIdentity.remotion_asset_map_hash || null,
    renderer_package_lock_hash: canonicalCandidateIdentity.renderer_package_lock_hash || null,
    renderer_source_tree_hash: canonicalCandidateIdentity.renderer_source_tree_hash || null,
    render_ready_source_hash: canonicalCandidateIdentity.render_ready_source_hash || null
  });
  canonicalCandidateIdentity.render_bundle_hash = renderBundleHash;
  const candidateHash = sha256OfJson(canonicalCandidateIdentity);

  return {
    project_id: projectId,
    canonical_candidate_identity: canonicalCandidateIdentity,
    candidate_hash: candidateHash,
    render_bundle_hash: renderBundleHash,
    asset_manifest: assetManifest,
    operational_metadata: {
      created_at: new Date().toISOString(),
      approval_version: "4.0-candidate-identity-hardened"
    }
  };
}

export async function buildCanonicalFrozenCandidate(projectId = PROJECT_ID, options = {}) {
  const dir = projectDir(projectId);
  const candidate = await computeCanonicalFrozenCandidate(projectId, options);
  await writeJsonAtomic(path.join(dir, "qa", "frozen_candidate.json"), candidate);
  return candidate;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  buildCanonicalFrozenCandidate(args["project-id"] || PROJECT_ID, { renderReadyDir: args["render-ready-dir"] || undefined })
    .then((candidate) => printJson({ ok: true, ...candidate }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
