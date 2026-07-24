#!/usr/bin/env node
// Verifies the music pause-rise envelope and the final closing tail directly
// from assets/audio/final_mix.metadata.json / automation intent -- not from
// the mix's overall LUFS alone (task section 12: "Yalnızca final miksin genel
// loudness değerine bakmak yeterli değildir"). Uses the exact same envelope
// function scripts/orvyq_audio_mix.mjs renders with
// (scripts/lib/orvyq-music-envelope.mjs), so this check and the audio that
// actually plays can never independently drift apart.
import path from "node:path";
import { projectDir, readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { pauseGainMultiplierAt, dbToLinear } from "./lib/orvyq-music-envelope.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const MIN_RISE_DB = 2;
const MAX_RISE_DB = 4;
const MIN_END_CARD_FADE_SECONDS = 4;
const MAX_END_CARD_FADE_SECONDS = 6.5;

export function auditPauseRiseMetadata(metadata) {
  const failures = [];
  const warnings = [];
  const ducking = metadata.narration_ducking || {};

  if (!ducking.enabled) failures.push("narration_ducking.enabled is not true");
  if (!ducking.music_rises_during_editorial_pauses) failures.push("narration_ducking.music_rises_during_editorial_pauses is not true");

  const riseDb = Number(ducking.pause_rise_db);
  if (!Number.isFinite(riseDb)) failures.push("narration_ducking.pause_rise_db is missing -- pause rise must be a measurable, declared value, not implied");
  else if (riseDb < MIN_RISE_DB || riseDb > MAX_RISE_DB) failures.push(`narration_ducking.pause_rise_db is ${riseDb}dB, outside the required ${MIN_RISE_DB}-${MAX_RISE_DB}dB band`);

  const rampSeconds = Number(ducking.pause_rise_ramp_seconds);
  if (!Number.isFinite(rampSeconds) || rampSeconds <= 0) failures.push("narration_ducking.pause_rise_ramp_seconds must be a positive number -- an instant on/off jump is not allowed");

  // Cross-check: sample the actual envelope function at a pause's midpoint
  // and confirm it reproduces the declared rise, rather than trusting the
  // declared number alone.
  if (Number.isFinite(riseDb) && Number.isFinite(rampSeconds) && (metadata.pause_windows || []).length) {
    const pause = metadata.pause_windows[0];
    const mid = (Number(pause.start_seconds) + Number(pause.end_seconds)) / 2;
    const gain = pauseGainMultiplierAt(mid, { start: Number(pause.start_seconds), end: Number(pause.end_seconds) }, { riseDb, rampSeconds });
    const expected = dbToLinear(riseDb);
    if (Math.abs(gain - expected) > 1e-6) failures.push(`envelope function does not reproduce the declared ${riseDb}dB rise at pause midpoint (got ${gain}, expected ${expected})`);
  } else if (!(metadata.pause_windows || []).length) {
    failures.push("no pause_windows recorded -- cannot verify the pause rise actually applies anywhere");
  }

  const fadeSeconds = Number(metadata.end_card_fade_seconds);
  if (!Number.isFinite(fadeSeconds)) failures.push("end_card_fade_seconds is missing -- the closing release must be a declared, measurable duration");
  else if (fadeSeconds < MIN_END_CARD_FADE_SECONDS || fadeSeconds > MAX_END_CARD_FADE_SECONDS)
    failures.push(`end_card_fade_seconds is ${fadeSeconds}s, outside the required ${MIN_END_CARD_FADE_SECONDS}-${MAX_END_CARD_FADE_SECONDS}s band`);

  if (!Number.isFinite(Number(metadata.head_silence_seconds))) warnings.push("head_silence_seconds is not recorded -- cannot confirm the motion hook has matching leading silence");

  return { failures, warnings, rise_db: riseDb, rise_ramp_seconds: rampSeconds, end_card_fade_seconds: fadeSeconds };
}

export async function runMusicPauseRiseAudit(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const metadata = await readJson(path.join(dir, "assets", "audio", "final_mix.metadata.json"));
  const result = auditPauseRiseMetadata(metadata);
  const report = { schema_version: "1.0-canonical", project_id: projectId, ...result, pass: result.failures.length === 0 };
  await writeJsonAtomic(path.join(dir, "qa", "music_pause_rise_audit.json"), report);
  if (!report.pass) throw new Error(`ORVYQ music pause-rise audit failed: ${result.failures.join("; ")}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  runMusicPauseRiseAudit(args["project-id"] || PROJECT_ID)
    .then((report) => printJson({ ok: true, ...report }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
