#!/usr/bin/env node
// Provenance and attribution record. Deliberate change vs golden
// (docs/source-audit.md section 3 / migration-plan.md section 3): the
// golden script threw an Error directly at each check site, so
// qa/license_audit.json only ever recorded a passing run -- a failed run's
// reason lived only in the captured stderr log, unlike the other 11 QA
// scripts' {pass, failures[]} report shape. This version accumulates
// failures the same way and writes them into the report even on failure,
// then throws once at the end. `plan.preview` -> `plan.mode`.
import path from "node:path";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { projectDir, readJson, writeJsonAtomic, pathExists } from "./lib/fs-utils.mjs";
import { loadResolvedEvidenceMap } from "./lib/orvyq-evidence.mjs";
import { auditMotionHook } from "./lib/orvyq-motion-hook.mjs";
const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const unique = (values) => [...new Set(values.filter(Boolean))];

export async function buildLicenseAudit(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const [plan, audioMetadata, evidenceMap, primaryManifest, runtime] = await Promise.all([
    readJson(path.join(dir, "direction", "edit_plan.json")),
    readJson(path.join(dir, "assets", "audio", "final_mix.metadata.json")),
    loadResolvedEvidenceMap(dir),
    readJson(path.join(dir, "research", "primary_evidence_manifest.json")),
    readJson(path.join(dir, "assets", "evidence", "primary_evidence.runtime.json"))
  ]);
  const failures = [];
  const sourceById = new Map(evidenceMap.source_catalog.map((source) => [source.source_id, source]));
  const declaredById = new Map(primaryManifest.assets.map((asset) => [asset.evidence_asset_id, asset]));
  const runtimeById = new Map(runtime.assets.map((asset) => [asset.evidence_asset_id, asset]));

  const evidenceSourceIds = unique(plan.shots.flatMap((shot) => [...(shot.evidence?.source_ids || []), ...(shot.editorial_overlay?.source_ids || [])]));
  const evidenceSources = [];
  for (const sourceId of evidenceSourceIds) {
    const source = sourceById.get(sourceId);
    if (!source || !source.official || !source.url || !source.publisher || !source.title) {
      failures.push(`Evidence source ${sourceId} is incomplete`);
      continue;
    }
    const related = plan.shots.filter((shot) => (shot.evidence?.source_ids || shot.editorial_overlay?.source_ids || []).includes(sourceId));
    evidenceSources.push({
      source_id: sourceId, publisher: source.publisher, title: source.title, publication_date: source.publication_date || null,
      source_url: source.url, official: true, claim_ids: unique(related.map((shot) => shot.claim_id)), shot_ids: related.map((shot) => shot.shot_id), limitation: source.limitation || null
    });
  }

  const captures = [];
  const usage = new Map();
  for (const shot of plan.shots.filter((item) => item.asset_type === "evidence")) {
    for (const assetId of shot.evidence?.evidence_asset_ids || []) {
      const declared = declaredById.get(assetId);
      const produced = runtimeById.get(assetId);
      if (!declared || !produced) {
        failures.push(`Missing primary evidence provenance for ${assetId}`);
        continue;
      }
      usage.set(assetId, (usage.get(assetId) || 0) + 1);
      if (!captures.some((item) => item.evidence_asset_id === assetId))
        captures.push({
          evidence_asset_id: assetId, local_asset: produced.local_asset, sha256: produced.sha256, bytes: produced.bytes, source_url: produced.source_url,
          source_ids: declared.source_ids, provenance_mode: "official_primary_capture",
          editorial_basis: "Official source capture with visible attribution for documentary analysis; provenance record, not a legal opinion."
        });
    }
  }

  const derived = plan.shots
    .filter((shot) => shot.asset_type === "evidence" && !(shot.evidence?.evidence_asset_ids || []).length)
    .map((shot) => ({ shot_id: shot.shot_id, kind: shot.evidence.kind, title: shot.evidence.title, source_ids: shot.evidence.source_ids, source_label: shot.evidence.source_label, provenance_mode: "source_derived_graphic", limitation: shot.evidence.limitation || null }));

  const footageAssets = unique(plan.shots.filter((shot) => shot.asset_type === "footage").map((shot) => shot.video_asset));
  const footage = [];
  for (const asset of footageAssets) {
    const provenancePath = path.join(dir, `${asset}.provenance.json`);
    if (!(await pathExists(provenancePath))) {
      failures.push(`Missing provenance for ${asset}`);
      continue;
    }
    const provenance = await readJson(provenancePath);
    if (!provenance.license_url || !provenance.approved_for_final_edit) {
      failures.push(`Footage is not approved: ${asset}`);
      continue;
    }
    footage.push({ asset, provider: provenance.provider, provider_asset_id: provenance.provider_asset_id, source_page_url: provenance.source_page_url, license_url: provenance.license_url, timeline_uses: plan.shots.filter((shot) => shot.video_asset === asset).length });
  }

  const motionHook = auditMotionHook(plan);
  if (!motionHook.pass) failures.push(`Motion-hook provenance failed: ${motionHook.failures.join("; ")}`);

  const audio = [
    { asset: audioMetadata.voice_source, role: "narration source", license: "User-supplied/commissioned narrator audio." },
    { asset: audioMetadata.mix_asset, role: "final audio mix", license: "Derived locally from approved narration and music structure." }
  ];
  if (audioMetadata.music_asset)
    audio.push({
      asset: audioMetadata.music_asset, role: "music bed", profile: audioMetadata.music_profile, sections: audioMetadata.music_sections || [],
      license: audioMetadata.music_profile === "original_tonal_score" ? "Original ORVYQ tonal score generated locally; no third-party recording." : audioMetadata.music_attribution || "Approved licensed bed; evidence required."
    });

  let musicProvenance = null;
  if (audioMetadata.music_profile === "approved_licensed_bed") {
    if (!audioMetadata.music_provenance) {
      failures.push("Approved music does not declare a provenance record");
    } else {
      const provenancePath = path.join(dir, audioMetadata.music_provenance);
      if (!(await pathExists(provenancePath))) {
        failures.push("Approved music provenance file is missing");
      } else {
        musicProvenance = await readJson(provenancePath);
        if (musicProvenance.asset !== audioMetadata.music_asset || musicProvenance.approved_for_final_edit !== true || !String(musicProvenance.license_url || "").includes("/licenses/by/4.0") || !musicProvenance.attribution)
          failures.push("Approved music provenance is incomplete");
        else {
          const musicBytes = await fs.readFile(path.join(dir, audioMetadata.music_asset));
          const actualMusicHash = createHash("sha256").update(musicBytes).digest("hex");
          if (actualMusicHash !== musicProvenance.sha256) failures.push("Approved music SHA-256 does not match its provenance record");
        }
      }
    }
  }

  // Both modes share one quality_policy now, so this is no longer gated on
  // plan.mode === "proof".
  const cinematicProof = plan.quality_policy?.cinematic_body_footage === true;
  const soundEffects = [];
  for (const asset of audioMetadata.sfx_assets || []) {
    if (!(await pathExists(path.join(dir, asset)))) {
      failures.push(`Declared SFX is missing: ${asset}`);
      continue;
    }
    soundEffects.push({ asset, origin: audioMetadata.sfx_origin, license: "Original synthesized sound effect generated locally for ORVYQ.", placements: (audioMetadata.sfx_placements || []).filter((placement) => placement.sfx_id === path.basename(asset, path.extname(asset)).replace(/^orvyq_/, "")) });
  }

  const maximum = Math.max(0, ...usage.values());
  const sourceUseLimit = plan.quality_policy?.max_uses_per_source ?? 2;
  if (maximum > sourceUseLimit) failures.push(`Primary capture use limit exceeded: ${maximum}`);
  if (audioMetadata.procedural_noise_generation !== false) failures.push("Unapproved procedural noise remains");
  const sfxCount = (audioMetadata.sfx_assets || []).length;
  if (sfxCount > 0 && !(cinematicProof && audioMetadata.sfx_origin === "original_synthesized_sfx" && sfxCount >= 3))
    failures.push("SFX assets are not approved original cinematic-proof effects");

  const report = {
    schema_version: "1.0-canonical",
    project_id: projectId,
    mode: plan.mode,
    purpose: "Editorial provenance and attribution record; not a legal clearance opinion.",
    official_primary_captures: captures,
    source_derived_graphics: derived,
    evidence_sources: evidenceSources,
    footage,
    motion_hook: motionHook,
    maximum_primary_capture_uses: maximum,
    source_use_limit: sourceUseLimit,
    audio,
    music_provenance: musicProvenance,
    sound_effects: soundEffects,
    procedural_noise_generation: audioMetadata.procedural_noise_generation,
    procedural_sfx_count: sfxCount,
    sfx_origin: audioMetadata.sfx_origin || null,
    failures,
    pass: failures.length === 0
  };
  await writeJsonAtomic(path.join(dir, "qa", "license_audit.json"), report);
  if (!report.pass) throw new Error(`ORVYQ license audit failed: ${failures.join("; ")}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildLicenseAudit()
    .then((result) => console.log(JSON.stringify({ ok: true, official_captures: result.official_primary_captures.length, source_derived_graphics: result.source_derived_graphics.length, footage: result.footage.length, maximum_primary_capture_uses: result.maximum_primary_capture_uses })))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
