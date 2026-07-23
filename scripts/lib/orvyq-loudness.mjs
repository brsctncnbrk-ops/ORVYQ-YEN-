// Shared ffmpeg loudness helpers -- factored out of scripts/orvyq_audio_mix.mjs
// so scripts/orvyq_music_resolve.mjs's per-cue music-bed assembly (each of
// the nine full_cues normalized individually before concatenation, so no
// single cue is jarringly louder/quieter than its neighbors) can reuse the
// exact same two-pass loudnorm measurement instead of duplicating it.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export async function command(binary, args) {
  try {
    return await exec(binary, args, { maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`${binary} failed: ${error.stderr || error.message}`);
  }
}

export function extractLoudnorm(text) {
  const candidates = [...String(text).matchAll(/\{\s*"input_i"[\s\S]*?\n\}/g)].map((match) => match[0]);
  if (!candidates.length) throw new Error("FFmpeg loudnorm analysis did not return JSON");
  return JSON.parse(candidates.at(-1));
}

export async function measureLoudness(file, target = { i: -16, tp: -1.5, lra: 9 }) {
  const result = await command("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-filter:a", `loudnorm=I=${target.i}:TP=${target.tp}:LRA=${target.lra}:print_format=json`, "-f", "null", "-"]);
  return extractLoudnorm(`${result.stdout}\n${result.stderr}`);
}

export function normalizeFilter(loudnorm = null, target = { i: -16, tp: -1.5, lra: 9 }) {
  if (!loudnorm) return `loudnorm=I=${target.i}:TP=${target.tp}:LRA=${target.lra}:print_format=json`;
  return `loudnorm=I=${target.i}:TP=${target.tp}:LRA=${target.lra}:measured_I=${loudnorm.input_i}:measured_TP=${loudnorm.input_tp}:measured_LRA=${loudnorm.input_lra}:measured_thresh=${loudnorm.input_thresh}:offset=${loudnorm.target_offset}:linear=true:print_format=summary`;
}

export async function durationSecondsOf(file) {
  const { stdout } = await command("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", file]);
  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not determine duration for ${file}`);
  return duration;
}
