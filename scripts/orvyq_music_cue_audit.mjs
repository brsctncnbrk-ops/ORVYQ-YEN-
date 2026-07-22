#!/usr/bin/env node
// Music-continuity and sound-design gate. Deliberate change vs golden:
// `plan.preview` -> `plan.mode`; audioMetadata.music_sections/pause_windows
// now use start_seconds/end_seconds (schemas/audio_mix.schema.json), so the
// contiguity check normalizes both that shape and music_cue_sheet.json's
// full_cues (start/end, untouched real project data) to a common form.
import path from "node:path";
import { projectDir, readJson, writeJsonAtomic, pathExists } from "./lib/fs-utils.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";

function contiguous(items, expectedEnd, tolerance = 0.01) {
  if (!items.length || Math.abs(Number(items[0].start) - 0) > tolerance) return false;
  for (let index = 1; index < items.length; index += 1) {
    if (Math.abs(Number(items[index - 1].end) - Number(items[index].start)) > tolerance) return false;
  }
  return Math.abs(Number(items.at(-1).end) - expectedEnd) <= tolerance;
}
function normalizeSpans(items) {
  return items.map((item) => ({ ...item, start: Number(item.start_seconds ?? item.start), end: Number(item.end_seconds ?? item.end) }));
}

export async function runMusicCueAudit(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const [plan, cueSheet, audioMetadata] = await Promise.all([
    readJson(path.join(dir, "direction", "edit_plan.json")),
    readJson(path.join(dir, "direction", "music_cue_sheet.json")),
    readJson(path.join(dir, "assets", "audio", "final_mix.metadata.json"))
  ]);
  const failures = [];
  const warnings = [];
  const isProof = plan.mode === "proof";
  // cinematicProof historically also required plan.mode === "proof"; that
  // mode gate was the proof-only cinematic_body_footage restriction itself
  // (removed in scripts/orvyq_edit_plan.mjs) -- both modes now share one
  // quality_policy, so this audit applies the same cinematic thresholds to
  // both instead of silently exempting full mode from them.
  const cinematicProof = plan.quality_policy?.cinematic_body_footage === true;

  if (audioMetadata.procedural_noise_generation !== false) failures.push("procedural noise generation must remain disabled");
  if (cinematicProof) {
    if (audioMetadata.sfx_origin !== "original_synthesized_sfx") failures.push("cinematic proof SFX must be original synthesized assets");
    if ((audioMetadata.sfx_assets || []).length < 3) failures.push("cinematic proof requires at least three restrained SFX types");
    if ((audioMetadata.pause_windows || []).length < 4) failures.push("cinematic proof requires four editorial audio pauses");
    if (!audioMetadata.narration_ducking?.enabled) failures.push("narration ducking is not enabled");
    if (!audioMetadata.narration_ducking?.music_rises_during_editorial_pauses) failures.push("music does not rise during editorial pauses");
    if (Number(audioMetadata.music_mix_target_lufs) < -26 || Number(audioMetadata.music_mix_target_lufs) > -20) failures.push("music mix target must remain audible between -26 and -20 LUFS");
  } else if ((audioMetadata.sfx_assets || []).length) {
    failures.push("unapproved SFX assets are present");
  }
  if (!audioMetadata.music_asset || !(await pathExists(path.join(dir, audioMetadata.music_asset)))) failures.push("declared music asset is missing");
  for (const asset of audioMetadata.sfx_assets || []) if (!(await pathExists(path.join(dir, asset)))) failures.push(`declared SFX asset is missing: ${asset}`);
  if (audioMetadata.music_profile === "approved_licensed_bed") {
    if (!audioMetadata.music_provenance || !(await pathExists(path.join(dir, audioMetadata.music_provenance)))) failures.push("approved music provenance is missing");
    if (!audioMetadata.music_attribution) failures.push("approved music attribution is missing");
  }

  let activeCues;
  if (isProof) {
    activeCues = normalizeSpans(audioMetadata.music_sections || []);
    if (activeCues.length < cueSheet.policy.minimum_distinct_music_states) failures.push(`proof contains ${activeCues.length} music states; ${cueSheet.policy.minimum_distinct_music_states} required`);
    if (!contiguous(activeCues, plan.frame_range.end_frame / plan.fps)) failures.push("proof music sections do not continuously cover the rendered range");
  } else {
    activeCues = cueSheet.full_cues || [];
    if (!contiguous(activeCues, cueSheet.duration_seconds)) failures.push("full cue sheet does not continuously cover the film duration");
    const incomplete = activeCues.filter((cue) => cue.status !== "ready");
    if (incomplete.length) failures.push(`full music cues are not ready: ${incomplete.map((cue) => cue.cue_id).join(", ")}`);
    const states = new Set(activeCues.map((cue) => cue.state));
    if (states.size < cueSheet.policy.minimum_distinct_music_states) failures.push(`full cue sheet has only ${states.size} distinct states`);
    if (audioMetadata.music_profile !== "approved_licensed_bed" && !(audioMetadata.full_cue_assets || []).length) failures.push("full render requires approved full-duration music assets or rendered full cue assets");
  }

  const energyChanges = activeCues.map((cue) => Math.abs(Number(cue.energy_end ?? 0) - Number(cue.energy_start ?? 0))).filter(Number.isFinite);
  if (!isProof && energyChanges.length && energyChanges.every((change) => change < 0.08)) warnings.push("full cue energy curve may be too flat");

  const report = {
    schema_version: "1.0-canonical",
    project_id: projectId,
    mode: plan.mode,
    music_profile: audioMetadata.music_profile,
    cue_count: activeCues.length,
    distinct_states: new Set(activeCues.map((cue) => cue.id || cue.state)).size,
    music_mix_target_lufs: audioMetadata.music_mix_target_lufs ?? null,
    sfx_count: (audioMetadata.sfx_assets || []).length,
    editorial_pause_count: (audioMetadata.pause_windows || []).length,
    continuous_coverage: contiguous(activeCues, isProof ? plan.frame_range.end_frame / plan.fps : cueSheet.duration_seconds),
    warnings,
    failures,
    pass: failures.length === 0
  };
  await writeJsonAtomic(path.join(dir, "qa", "music_cue_audit.json"), report);
  if (!report.pass) throw new Error(`ORVYQ music cue audit failed: ${failures.join("; ")}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMusicCueAudit().then((report) => console.log(JSON.stringify({ ok: true, ...report }))).catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  });
}
