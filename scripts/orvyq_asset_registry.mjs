#!/usr/bin/env node
// buildCanonicalAssetRegistry() -- the single asset/provenance registry for
// BOTH proof and full render modes, per the task's section 9 model. This did
// not exist in the golden system: footage provenance lived in per-clip
// *.mp4.provenance.json files, evidence provenance lived in
// research/*_manifest.json files, and music/sfx provenance lived in
// assets/audio/final_mix.metadata.json -- three separate, differently-shaped
// records with no single place to answer "is this asset registered, and
// under what license." This script scans the canonical edit plan's actual
// asset references and assembles one registry conforming to
// schemas/asset_registry.schema.json, computing real sha256 hashes from
// whatever files exist on disk (no unregistered asset may render; no
// missing registered asset may pass preflight -- see
// scripts/orvyq_edit_plan_tests.mjs in Phase 4 for the QA gate that will
// enforce this against the registry built here).
import path from "node:path";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { projectDir, readJson, readJsonSafe, writeJsonAtomic, pathExists, parseArgs, printJson } from "./lib/fs-utils.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";

async function sha256OfFile(absPath) {
  const buffer = await fs.readFile(absPath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function footageEntry(dir, relPath, reuseLimit) {
  const absPath = path.join(dir, relPath);
  const provenance = await readJsonSafe(path.join(dir, `${relPath}.provenance.json`));
  const entry = {
    asset_id: path.basename(relPath, path.extname(relPath)),
    type: "footage",
    path: relPath,
    source: provenance?.provider || "unknown",
    source_url: provenance?.source_page_url,
    license: provenance?.license_url || "unknown",
    attribution: provenance?.attribution_required ? provenance?.creator || "" : "",
    duration_seconds: provenance?.duration,
    width: provenance?.width,
    height: provenance?.height,
    semantic_keywords: [],
    editorial_roles: [],
    allowed_reuse_count: reuseLimit
  };
  if (await pathExists(absPath)) entry.sha256 = await sha256OfFile(absPath);
  return entry;
}

async function evidenceEntry(dir, relPath, manifestById, reuseLimit) {
  const absPath = path.join(dir, relPath);
  const assetId = path.basename(relPath, path.extname(relPath));
  const declared = [...manifestById.values()].find((asset) => asset.local_asset === relPath);
  const entry = {
    asset_id: declared?.evidence_asset_id || assetId,
    type: "evidence",
    path: relPath,
    source: declared ? "official_primary_capture" : "unknown",
    source_url: declared?.source_url,
    license: "source-attributed, not independently licensed for reuse",
    attribution: declared?.caption || "",
    semantic_keywords: [],
    editorial_roles: ["evidence"],
    allowed_reuse_count: reuseLimit
  };
  if (await pathExists(absPath)) entry.sha256 = await sha256OfFile(absPath);
  return entry;
}

async function audioEntries(dir, mixMetadata) {
  const entries = [];
  if (!mixMetadata) return entries;
  if (mixMetadata.music_asset) {
    const absPath = path.join(dir, mixMetadata.music_asset);
    const provenance = await readJsonSafe(path.join(path.dirname(absPath), "approved_bed.provenance.json"));
    entries.push({
      asset_id: path.basename(mixMetadata.music_asset, path.extname(mixMetadata.music_asset)),
      type: "music",
      path: mixMetadata.music_asset,
      source: provenance?.composer || "generated",
      source_url: provenance?.source_page_url,
      license: provenance?.license || (mixMetadata.music_profile === "approved_licensed_bed" ? "unknown" : "original -- no third-party license required"),
      attribution: provenance?.attribution || "",
      duration_seconds: provenance?.duration_seconds ?? mixMetadata.duration_seconds,
      semantic_keywords: [],
      editorial_roles: ["score"],
      allowed_reuse_count: 1,
      ...(await pathExists(absPath) ? { sha256: await sha256OfFile(absPath) } : {})
    });
  }
  for (const relPath of mixMetadata.sfx_assets || []) {
    const absPath = path.join(dir, relPath);
    entries.push({
      asset_id: path.basename(relPath, path.extname(relPath)),
      type: "sfx",
      path: relPath,
      source: "original_synthesized_sfx",
      license: "original -- no third-party license required",
      attribution: "",
      editorial_roles: ["sound_design"],
      allowed_reuse_count: 99,
      ...(await pathExists(absPath) ? { sha256: await sha256OfFile(absPath) } : {})
    });
  }
  if (mixMetadata.mix_asset) {
    const absPath = path.join(dir, mixMetadata.mix_asset);
    entries.push({
      asset_id: "final_mix",
      type: "narration",
      path: mixMetadata.mix_asset,
      source: "ElevenLabs narration + buildCanonicalAudioMix",
      license: "original -- project-owned narration",
      attribution: "",
      duration_seconds: mixMetadata.duration_seconds,
      editorial_roles: ["narration"],
      allowed_reuse_count: 1,
      ...(await pathExists(absPath) ? { sha256: await sha256OfFile(absPath) } : {})
    });
  }
  return entries;
}

export async function buildCanonicalAssetRegistry(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const [editPlan, blueprint, evidenceManifest, mixMetadata] = await Promise.all([
    readJson(path.join(dir, "direction", "edit_plan.json")),
    readJson(path.join(dir, "direction", "editorial_blueprint.json")),
    readJsonSafe(path.join(dir, "research", "primary_evidence_manifest.json"), { assets: [] }),
    readJsonSafe(path.join(dir, "assets", "audio", "final_mix.metadata.json"))
  ]);
  const reuseLimit = blueprint.global_rules?.max_uses_per_source || 2;
  const manifestById = new Map((evidenceManifest.assets || []).map((asset) => [asset.evidence_asset_id, asset]));

  const footagePaths = new Set();
  const evidencePaths = new Set();
  for (const shot of editPlan.shots) {
    if (shot.asset_type === "footage" && shot.video_asset) footagePaths.add(shot.video_asset);
    if (shot.asset_type === "evidence") {
      for (const image of shot.evidence?.image_assets || []) evidencePaths.add(image);
    }
  }

  const assets = [
    ...(await Promise.all([...footagePaths].map((relPath) => footageEntry(dir, relPath, reuseLimit)))),
    ...(await Promise.all([...evidencePaths].map((relPath) => evidenceEntry(dir, relPath, manifestById, reuseLimit)))),
    ...(await audioEntries(dir, mixMetadata))
  ];

  const registry = { schema_version: "1.0-canonical", project_id: projectId, generated_at: new Date().toISOString(), assets };
  await writeJsonAtomic(path.join(dir, "assets", "asset_registry.json"), registry);
  const unregisteredHash = assets.filter((asset) => !asset.sha256).map((asset) => asset.path);
  return { asset_count: assets.length, missing_on_disk: unregisteredHash };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  buildCanonicalAssetRegistry(args["project-id"] || PROJECT_ID)
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
