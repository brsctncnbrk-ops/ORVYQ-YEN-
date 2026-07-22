#!/usr/bin/env node
// Cross-checks every used evidence asset against its declared and fetched
// (runtime) manifests. Deliberate change vs golden: `plan.preview` ->
// `plan.mode`, matching the canonical edit_plan.schema.json shape.
import path from "node:path";
import { promises as fs } from "node:fs";
import { projectDir, readJson, writeJsonAtomic, pathExists } from "./lib/fs-utils.mjs";
import { loadResolvedEvidenceMap } from "./lib/orvyq-evidence.mjs";
import { auditMotionHook } from "./lib/orvyq-motion-hook.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const OFFICIAL_CAPTURE_KINDS = new Set(["split_documents", "official_document", "official_figure", "official_screen", "image_sequence", "recap"]);
const SOURCE_DERIVED_KINDS = new Set(["source_timeline", "source_article", "concept_map", "boundary", "comparison", "evidence_chain"]);
const unique = (values) => [...new Set(values.filter(Boolean))];

export async function runEvidenceAssetAudit(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const [manifest, runtime, plan, evidenceMap] = await Promise.all([
    readJson(path.join(dir, "research", "primary_evidence_manifest.json")),
    readJson(path.join(dir, "assets", "evidence", "primary_evidence.runtime.json")),
    readJson(path.join(dir, "direction", "edit_plan.json")),
    loadResolvedEvidenceMap(dir)
  ]);
  const manifestById = new Map((manifest.assets || []).map((asset) => [asset.evidence_asset_id, asset]));
  const runtimeById = new Map((runtime.assets || []).map((asset) => [asset.evidence_asset_id, asset]));
  const sourceIds = new Set(evidenceMap.source_catalog.map((source) => source.source_id));
  const failures = [];
  const warnings = [];
  const reports = [];
  const isProof = plan.mode === "proof";
  const usedAssetIds = unique(plan.shots.flatMap((shot) => shot.evidence?.evidence_asset_ids || []));
  const usedImageAssets = unique(plan.shots.flatMap((shot) => shot.evidence?.image_assets || []));

  const motionHook = auditMotionHook(plan);
  if (!motionHook.pass) failures.push(...motionHook.failures);

  for (const shot of plan.shots.filter((item) => item.asset_type === "evidence")) {
    const spec = shot.evidence || {};
    if (!spec.kind) failures.push(`${shot.shot_id} has no evidence kind`);
    if (!(spec.source_ids || []).length) failures.push(`${shot.shot_id} has no source_ids`);
    if (!spec.source_label) failures.push(`${shot.shot_id} has no visible source_label`);
    for (const sourceId of spec.source_ids || []) if (!sourceIds.has(sourceId)) failures.push(`${shot.shot_id} references unknown source ${sourceId}`);

    if (OFFICIAL_CAPTURE_KINDS.has(spec.kind)) {
      if (!(spec.image_assets || []).length) failures.push(`${shot.shot_id} official capture kind ${spec.kind} has no image assets`);
      if ((spec.image_assets || []).length !== (spec.evidence_asset_ids || []).length) failures.push(`${shot.shot_id} image/evidence ID counts do not match`);
    } else if (SOURCE_DERIVED_KINDS.has(spec.kind)) {
      if ((spec.image_assets || []).length || (spec.evidence_asset_ids || []).length) failures.push(`${shot.shot_id} source-derived graphic must not impersonate an official capture`);
    } else {
      failures.push(`${shot.shot_id} uses unknown evidence kind ${spec.kind}`);
    }
  }

  for (const assetId of usedAssetIds) {
    const declared = manifestById.get(assetId);
    const produced = runtimeById.get(assetId);
    if (!declared) { failures.push(`${assetId} is used but absent from primary evidence manifest`); continue; }
    if (!produced) { failures.push(`${assetId} is used but absent from runtime evidence manifest`); continue; }
    const localPath = declared.local_asset;
    if (produced.local_asset !== localPath) failures.push(`${assetId} runtime path does not match declared path`);
    if (declared.provenance_mode !== "official_primary_capture" || produced.provenance_mode !== "official_primary_capture") failures.push(`${assetId} is not an official primary capture`);
    if (!declared.source_url || !produced.source_url || declared.source_url !== produced.source_url) failures.push(`${assetId} source URL mismatch`);
    if (!produced.sha256 || produced.sha256.length !== 64) failures.push(`${assetId} has no valid SHA-256`);
    if (!Number.isFinite(produced.bytes) || produced.bytes < Number(declared.output_min_bytes || 30000)) failures.push(`${assetId} is below its rendered-output byte threshold`);
    const absolute = path.join(dir, localPath);
    if (!(await pathExists(absolute))) failures.push(`${assetId} physical file is missing: ${localPath}`);
    else {
      const stat = await fs.stat(absolute);
      if (stat.size !== produced.bytes) failures.push(`${assetId} physical byte size differs from runtime manifest`);
    }
    reports.push({ evidence_asset_id: assetId, local_asset: localPath, source_url: produced.source_url, sha256: produced.sha256, bytes: produced.bytes, provenance_mode: produced.provenance_mode, source_ids: declared.source_ids });
  }

  const required = (manifest.assets || []).filter((asset) => (isProof ? asset.required_for_proof === true : asset.required_for_full === true));
  for (const asset of required) {
    if (!runtimeById.has(asset.evidence_asset_id)) failures.push(`${asset.evidence_asset_id} is required but was not fetched`);
    if (isProof && !usedAssetIds.includes(asset.evidence_asset_id)) warnings.push(`${asset.evidence_asset_id} is proof-ready but not used in this cut`);
  }

  for (const imageAsset of usedImageAssets) {
    if (!reports.some((report) => report.local_asset === imageAsset)) failures.push(`Image ${imageAsset} is not backed by a validated runtime evidence asset`);
  }

  const report = {
    schema_version: "1.0-canonical",
    project_id: projectId,
    mode: plan.mode,
    legacy_footage_count: plan.shots.filter((shot) => shot.asset_type === "footage" && shot.hook_footage !== true && shot.contextual_footage !== true).length,
    approved_contextual_footage_count: plan.shots.filter((shot) => shot.asset_type === "footage" && shot.contextual_footage === true).length,
    approved_hook_footage_count: plan.shots.filter((shot) => shot.asset_type === "footage" && shot.hook_footage === true).length,
    motion_hook: motionHook,
    used_official_capture_count: reports.length,
    used_source_derived_graphic_count: plan.shots.filter((shot) => shot.asset_type === "evidence" && SOURCE_DERIVED_KINDS.has(shot.evidence?.kind)).length,
    used_asset_ids: usedAssetIds,
    used_image_assets: usedImageAssets,
    assets: reports,
    warnings,
    failures,
    pass: failures.length === 0
  };
  await writeJsonAtomic(path.join(dir, "qa", "evidence_asset_audit.json"), report);
  if (!report.pass) throw new Error(`ORVYQ primary evidence asset audit failed: ${failures.join("; ")}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runEvidenceAssetAudit().then((report) => console.log(JSON.stringify({ ok: true, ...report }))).catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  });
}
