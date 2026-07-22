#!/usr/bin/env node
// buildCanonicalAudioMix() -- narration + music + sound-design mix for both
// proof and full render modes, writing an assets/audio/final_mix.metadata.json
// that conforms to schemas/audio_mix.schema.json.
//
// Deliberate fixes vs the golden source (docs/source-audit.md section 7,
// findings 2-4 / docs/migration-plan.md section 1):
//
// 1. `musicVolumeExpression()` used to hardcode its own separate copy of the
//    150-second-proof section boundaries (35 / 59.62 / 93.4 / 126.56) in an
//    ffmpeg if/else chain, completely independent of `musicSectionsForDuration()`
//    -- which DID already rescale boundaries for non-150s durations. The two
//    could silently drift apart. Now `musicVolumeExpression()` takes the same
//    `sections` array `musicSectionsForDuration()` returns and builds its
//    if/else chain from `section.end` / `section.under_speech_gain` -- there
//    is only one place duration-dependent boundaries are computed.
// 2. SFX placement used to be five hardcoded (asset, absolute-second) pairs.
//    Four of those five times were not actually arbitrary -- they are the
//    real editorial pause start times, and each pause already declares its
//    own `sound_cue` in direction/editorial_pause_map.json. SFX placement is
//    now derived from `narration.pauseWindows` (real, already duration-
//    correct data) instead of being duplicated as separate literals. The
//    ffmpeg filter graph is built dynamically over however many placements
//    exist, instead of a fixed 2-low_impact + 2-tonal_bloom + 1-ui_tick graph.
// 3. The one placement with no real data backing it -- a "first primary
//    evidence reveal" tick at a fixed 11s into the proof -- is scaled
//    proportionally to durationSeconds using the same ratio approach
//    musicSectionsForDuration() already uses, rather than left as a bare
//    150s-only literal. This is an honest approximation, not a real fix:
//    a genuine full-length placement needs real full-film cue authoring
//    (direction/music_cue_sheet.json's full_cues are still
//    status:spec_ready_asset_pending), which is content work blocked on
//    Phase 6 human approval, not something to fabricate here.
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projectDir, readJson, writeJsonAtomic, pathExists, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { resolveFullFilmPauses } from "./lib/orvyq-pause-resolver.mjs";

const exec = promisify(execFile);
const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const PROOF_SECONDS = 150;
const UNDER_SPEECH_GAIN_DEFAULT = 0.7;
const EDITORIAL_PAUSE_GAIN = 1.02;
const FIRST_EVIDENCE_BEAT_PROOF_SECONDS = 11;

const PROOF_MUSIC_SECTIONS = [
  { id: "controlled_tension", start: 0, end: 35, function: "Opening paradox and competitive pressure", energy_start: 0.3, energy_end: 0.48, under_speech_gain: 0.72 },
  { id: "present_tense_turn", start: 35, end: 59.62, function: "Safety frameworks, governance lag, and the present-tense emphasis beat", energy_start: 0.42, energy_end: 0.62, under_speech_gain: 0.78 },
  { id: "analytical_unease", start: 59.62, end: 93.4, function: "Controlled evaluation evidence and scenario mechanics", energy_start: 0.5, energy_end: 0.7, under_speech_gain: 0.82 },
  { id: "engineered_pressure", start: 93.4, end: 126.56, function: "Replacement condition, deliberation, result, and limitation setup", energy_start: 0.64, energy_end: 0.84, under_speech_gain: 0.86 },
  { id: "reflective_release", start: 126.56, end: 150, function: "Controlled-test limitation, recap, and clean branded release", energy_start: 0.58, energy_end: 0.2, under_speech_gain: 0.7 }
];

const SFX_VOLUME_BY_CUE = { low_impact: 0.5, tonal_bloom: 0.7, ui_tick: 0.65 };

async function command(binary, args) {
  try {
    return await exec(binary, args, { maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`${binary} failed: ${error.stderr || error.message}`);
  }
}
async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
async function readOptionalJson(file) {
  if (!(await exists(file))) return null;
  return JSON.parse(await fs.readFile(file, "utf8"));
}
function extractLoudnorm(text) {
  const candidates = [...String(text).matchAll(/\{\s*"input_i"[\s\S]*?\n\}/g)].map((match) => match[0]);
  if (!candidates.length) throw new Error("FFmpeg loudnorm analysis did not return JSON");
  return JSON.parse(candidates.at(-1));
}
async function durationSecondsOf(file) {
  const { stdout } = await command("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", file]);
  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not determine duration for ${file}`);
  return duration;
}
async function measureLoudness(file, target = { i: -16, tp: -1.5, lra: 9 }) {
  const result = await command("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-filter:a", `loudnorm=I=${target.i}:TP=${target.tp}:LRA=${target.lra}:print_format=json`, "-f", "null", "-"]);
  return extractLoudnorm(`${result.stdout}\n${result.stderr}`);
}
function normalizeFilter(loudnorm = null) {
  if (!loudnorm) return "loudnorm=I=-16:TP=-1.5:LRA=9:print_format=json";
  return `loudnorm=I=-16:TP=-1.5:LRA=9:measured_I=${loudnorm.input_i}:measured_TP=${loudnorm.input_tp}:measured_LRA=${loudnorm.input_lra}:measured_thresh=${loudnorm.input_thresh}:offset=${loudnorm.target_offset}:linear=true:print_format=summary`;
}

async function prepareNarrator({ dir, audioDir, sourceVoice, sourceDuration }) {
  const repair = await readOptionalJson(path.join(dir, "voice", "audio_repair.json"));
  if (!repair) return { voice: sourceVoice, repair: null };
  if (repair.operation !== "rotate") throw new Error(`Unsupported narrator repair operation: ${repair.operation}`);
  const rotateAt = Number(repair.rotate_at_seconds);
  if (!Number.isFinite(rotateAt) || rotateAt <= 0 || rotateAt >= sourceDuration) throw new Error(`Invalid narrator rotate_at_seconds: ${repair.rotate_at_seconds}`);
  const reorderedVoice = path.join(audioDir, "final_voice.reordered.wav");
  const filter = [
    `[0:a]atrim=start=${rotateAt},asetpts=PTS-STARTPTS[first]`,
    `[0:a]atrim=end=${rotateAt},asetpts=PTS-STARTPTS[second]`,
    "[first][second]concat=n=2:v=0:a=1[out]"
  ].join(";");
  await command("ffmpeg", ["-hide_banner", "-nostats", "-y", "-i", sourceVoice, "-filter_complex", filter, "-map", "[out]", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", reorderedVoice]);
  return { voice: reorderedVoice, repair: { operation: "rotate", rotate_at_seconds: rotateAt, config: "voice/audio_repair.json", reason: repair.reason || null } };
}

async function prepareEditorialNarration({ dir, audioDir, voice, availableDuration, narrationLimitSeconds, editorialPauses, mode }) {
  const sourceNarrationDuration = Number.isFinite(narrationLimitSeconds) && narrationLimitSeconds > 0 ? Math.min(availableDuration, narrationLimitSeconds) : availableDuration;
  if (!editorialPauses) {
    return { voice, sourceNarrationDuration, timelineNarrationDuration: sourceNarrationDuration, editorialPauseSeconds: 0, pauseWindows: [], pauseMap: null };
  }

  const pauseMap = await readOptionalJson(path.join(dir, "direction", "editorial_pause_map.json"));
  // The golden defect this replaces: this used to read pauseMap.proof.pauses
  // unconditionally, regardless of mode -- running that against a full-
  // length narration would silently concentrate all four proof pauses in
  // the first ~114s of an 800+s recording. Full mode instead resolves its
  // own text-anchored full_film_pause_anchors against the real per-word ASR
  // timestamps in voice/narration_alignment.json (scripts/lib/orvyq-pause-
  // resolver.mjs) -- the same resolver scripts/orvyq_full_production_plan.mjs
  // uses to place pause shots in the edit plan, so the audio mix's pause
  // timing and the video timeline's pause timing can never independently
  // drift apart. Proof mode is unchanged.
  let configuredPauses;
  if (mode === "full") {
    const alignment = await readJson(path.join(dir, "voice", "narration_alignment.json"));
    const anchors = pauseMap?.full_film_pause_anchors || [];
    if (!anchors.length) throw new Error("Editorial pause mode requires direction/editorial_pause_map.json full_film_pause_anchors");
    let resolved;
    ({ pauses: resolved } = resolveFullFilmPauses({ words: alignment.words, anchors }));
    // full_film_pause_anchors has no per-pause sound_cue/emphasis authored
    // yet (unlike proof.pauses, which was hand-timed with both) -- rather
    // than inventing a cue rotation with no editorial backing, every full-
    // mode pause uses the same real synthesized "low_impact" cue (an
    // honest simplification, not a fake pass) and carries its own real,
    // already-authored `purpose` text through as `emphasis` for the mix
    // metadata, instead of leaving it silently null.
    configuredPauses = resolved.map((pause) => ({ ...pause, emphasis: pause.purpose, sound_cue: "low_impact" }));
  } else {
    configuredPauses = pauseMap?.proof?.pauses || [];
  }
  if (!configuredPauses.length)
    throw new Error(`Editorial pause mode requires direction/editorial_pause_map.json ${mode === "full" ? "full_film_pause_anchors" : "proof pauses"}`);
  const pauses = [...configuredPauses].sort((a, b) => Number(a.source_time_seconds) - Number(b.source_time_seconds));
  const filters = [];
  const labels = [];
  const pauseWindows = [];
  let sourceCursor = 0;
  let insertedSeconds = 0;

  pauses.forEach((pause, index) => {
    const sourceTime = Number(pause.source_time_seconds);
    const duration = Number(pause.duration_seconds);
    if (!Number.isFinite(sourceTime) || !Number.isFinite(duration) || sourceTime <= sourceCursor || sourceTime >= sourceNarrationDuration || duration <= 0)
      throw new Error(`Invalid editorial pause ${pause.pause_id || index + 1}`);
    const voiceLabel = `voice_part_${index}`;
    const silenceLabel = `pause_part_${index}`;
    filters.push(`[0:a]atrim=start=${sourceCursor}:end=${sourceTime},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo[${voiceLabel}]`);
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${duration},asetpts=PTS-STARTPTS[${silenceLabel}]`);
    labels.push(`[${voiceLabel}]`, `[${silenceLabel}]`);
    const outputStart = sourceTime + insertedSeconds;
    pauseWindows.push({ pause_id: pause.pause_id, source_time_seconds: sourceTime, start: outputStart, end: outputStart + duration, duration, emphasis: pause.emphasis, sound_cue: pause.sound_cue });
    sourceCursor = sourceTime;
    insertedSeconds += duration;
  });
  const finalLabel = "voice_part_final";
  filters.push(`[0:a]atrim=start=${sourceCursor}:end=${sourceNarrationDuration},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo[${finalLabel}]`);
  labels.push(`[${finalLabel}]`);
  filters.push(`${labels.join("")}concat=n=${labels.length}:v=0:a=1[paused_voice]`);

  const timelineNarrationDuration = sourceNarrationDuration + insertedSeconds;
  const editorialVoice = path.join(audioDir, "final_voice.editorial.wav");
  await command("ffmpeg", ["-hide_banner", "-nostats", "-y", "-i", voice, "-filter_complex", filters.join(";"), "-map", "[paused_voice]", "-t", String(timelineNarrationDuration), "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", editorialVoice]);
  return { voice: editorialVoice, sourceNarrationDuration, timelineNarrationDuration, editorialPauseSeconds: insertedSeconds, pauseWindows, pauseMap: "direction/editorial_pause_map.json" };
}

async function generateFallbackScore(musicDir, duration) {
  const output = path.join(musicDir, "orvyq_original_tonal_bed.mp3");
  const inputs = [55, 82.41, 110, 164.81].flatMap((frequency) => ["-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`]);
  const filter = [
    "[0:a]volume=0.24,tremolo=f=0.13:d=0.18[t0]",
    "[1:a]volume=0.14,tremolo=f=0.19:d=0.2[t1]",
    "[2:a]volume=0.08,tremolo=f=0.27:d=0.22[t2]",
    "[3:a]volume=0.045,tremolo=f=0.34:d=0.18[t3]",
    `[t0][t1][t2][t3]amix=inputs=4:normalize=0,highpass=f=32,lowpass=f=1900,aecho=0.72:0.42:520|1040:0.12|0.055,afade=t=in:st=0:d=2.2,afade=t=out:st=${Math.max(0, duration - 2)}:d=2,loudnorm=I=-24:TP=-3:LRA=11,aformat=channel_layouts=stereo[bed]`
  ].join(";");
  await command("ffmpeg", ["-hide_banner", "-nostats", "-y", ...inputs, "-filter_complex", filter, "-map", "[bed]", "-t", String(duration), "-ac", "2", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "192k", output]);
  return output;
}

async function generateOriginalSfx(sfxDir) {
  await fs.mkdir(sfxDir, { recursive: true });
  const lowImpact = path.join(sfxDir, "orvyq_low_impact.wav");
  const tonalBloom = path.join(sfxDir, "orvyq_tonal_bloom.wav");
  const uiTick = path.join(sfxDir, "orvyq_ui_tick.wav");
  await command("ffmpeg", [
    "-hide_banner", "-nostats", "-y",
    "-f", "lavfi", "-i", "sine=frequency=62:sample_rate=48000:duration=0.7",
    "-f", "lavfi", "-i", "sine=frequency=124:sample_rate=48000:duration=0.7",
    "-filter_complex", "[0:a]volume='0.42*exp(-5*t)':eval=frame[a];[1:a]volume='0.13*exp(-7*t)':eval=frame[b];[a][b]amix=inputs=2:normalize=0,lowpass=f=720,afade=t=out:st=0.18:d=0.52,aformat=channel_layouts=stereo[out]",
    "-map", "[out]", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", lowImpact
  ]);
  await command("ffmpeg", [
    "-hide_banner", "-nostats", "-y",
    "-f", "lavfi", "-i", "sine=frequency=164.81:sample_rate=48000:duration=1.5",
    "-f", "lavfi", "-i", "sine=frequency=246.94:sample_rate=48000:duration=1.5",
    "-filter_complex", "[0:a]volume=0.16[a];[1:a]volume=0.09[b];[a][b]amix=inputs=2:normalize=0,aecho=0.72:0.38:240|480:0.14|0.06,afade=t=in:st=0:d=0.18,afade=t=out:st=0.65:d=0.85,aformat=channel_layouts=stereo[out]",
    "-map", "[out]", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", tonalBloom
  ]);
  await command("ffmpeg", [
    "-hide_banner", "-nostats", "-y",
    "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=0.09",
    "-f", "lavfi", "-i", "sine=frequency=1320:sample_rate=48000:duration=0.09",
    "-filter_complex", "[0:a]volume=0.12[a];[1:a]volume=0.055[b];[a][b]amix=inputs=2:normalize=0,afade=t=out:st=0.025:d=0.065,aformat=channel_layouts=stereo[out]",
    "-map", "[out]", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", uiTick
  ]);
  return { low_impact: lowImpact, tonal_bloom: tonalBloom, ui_tick: uiTick };
}

// Full mode uses direction/music_cue_sheet.json's own full_cues -- nine
// real, distinct, already-authored music states covering the whole film
// (not the 5-section proof structure rescaled, which describes the
// 150-second proof cut specifically and was never written to represent the
// full film's actual sections). The cue sheet's own start/end values are
// against its authored duration_seconds, which predates real ASR-measured
// narration length and the added opening motion hook -- rescaled
// proportionally onto the real output duration, the same technique already
// used above for the proof-based fallback and for the SFX "first evidence
// beat" placement, rather than trusting stale absolute timestamps.
export function musicSectionsForDuration(duration, { fullCues, fullCuesAuthoredDuration } = {}) {
  if (Math.abs(duration - PROOF_SECONDS) < 0.01) return PROOF_MUSIC_SECTIONS;
  if (fullCues?.length) {
    const scale = duration / fullCuesAuthoredDuration;
    return fullCues.map((cue) => ({
      id: cue.cue_id,
      start: cue.start * scale,
      end: cue.end * scale,
      function: cue.function,
      energy_start: cue.energy_start,
      energy_end: cue.energy_end,
      under_speech_gain: UNDER_SPEECH_GAIN_DEFAULT
    }));
  }
  const boundaries = [0, 0.23, 0.4, 0.63, 0.84, 1].map((ratio) => ratio * duration);
  return PROOF_MUSIC_SECTIONS.map((section, index) => ({ ...section, start: boundaries[index], end: boundaries[index + 1] }));
}

// Builds the under-speech ducking curve from the SAME per-duration sections
// musicSectionsForDuration() returns -- see the file header for why this
// used to be a second, independently-hardcoded copy of the boundaries.
export function musicVolumeExpression(sections, pauseWindows) {
  let expression = String(sections.at(-1)?.under_speech_gain ?? UNDER_SPEECH_GAIN_DEFAULT);
  for (let i = sections.length - 2; i >= 0; i -= 1) {
    const section = sections[i];
    expression = `if(lt(t,${section.end}),${section.under_speech_gain ?? UNDER_SPEECH_GAIN_DEFAULT},${expression})`;
  }
  for (const pause of [...pauseWindows].reverse()) expression = `if(between(t,${pause.start},${pause.end}),${EDITORIAL_PAUSE_GAIN},${expression})`;
  return expression;
}

// Derives SFX placement from real pause data instead of hardcoded (asset,
// second) literals -- see file header, fix 2/3.
function buildSfxPlacements({ pauseWindows, outputDuration, sfxAssets }) {
  const firstEvidenceBeatSeconds = (FIRST_EVIDENCE_BEAT_PROOF_SECONDS / PROOF_SECONDS) * outputDuration;
  const placements = [{ id: "first_evidence_reveal", cue: "ui_tick", at_seconds: round3(firstEvidenceBeatSeconds), purpose: "First primary-evidence reveal" }];
  for (const pause of pauseWindows) {
    const cue = sfxAssets[pause.sound_cue] ? pause.sound_cue : "low_impact";
    placements.push({ id: pause.pause_id, cue, at_seconds: round3(pause.start), purpose: pause.emphasis || pause.pause_id });
  }
  return placements;
}
function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function buildSfxFilterGraph({ sfxPlacements, inputIndexByCue }) {
  const byCue = new Map();
  for (const placement of sfxPlacements) {
    if (!byCue.has(placement.cue)) byCue.set(placement.cue, []);
    byCue.get(placement.cue).push(placement);
  }
  const filters = [];
  const mixLabels = [];
  for (const [cue, placements] of byCue) {
    const inputIndex = inputIndexByCue.get(cue);
    const volume = SFX_VOLUME_BY_CUE[cue] ?? 0.5;
    if (placements.length === 1) {
      const [placement] = placements;
      const delayMs = Math.round(placement.at_seconds * 1000);
      const label = `sfx_${placement.id}`;
      filters.push(`[${inputIndex}:a]adelay=${delayMs}|${delayMs},volume=${volume}[${label}]`);
      mixLabels.push(`[${label}]`);
    } else {
      const splitLabels = placements.map((_, index) => `${cue}_split_${index}`);
      filters.push(`[${inputIndex}:a]asplit=${placements.length}${splitLabels.map((label) => `[${label}]`).join("")}`);
      placements.forEach((placement, index) => {
        const delayMs = Math.round(placement.at_seconds * 1000);
        const label = `sfx_${placement.id}`;
        filters.push(`[${splitLabels[index]}]adelay=${delayMs}|${delayMs},volume=${volume}[${label}]`);
        mixLabels.push(`[${label}]`);
      });
    }
  }
  return { filters, mixLabels };
}

function mixFilter({ timelineNarrationDuration, outputDuration, pauseWindows, sections, sfxPlacements, inputIndexByCue, loudnorm = null }) {
  const fadeOut = Math.max(0, outputDuration - 2);
  const musicArc = musicVolumeExpression(sections, pauseWindows);
  const { filters: sfxFilters, mixLabels: sfxLabels } = buildSfxFilterGraph({ sfxPlacements, inputIndexByCue });
  const graph = [
    `[0:a]atrim=duration=${timelineNarrationDuration},apad=pad_dur=${Math.max(0, outputDuration - timelineNarrationDuration)},atrim=duration=${outputDuration},highpass=f=70,lowpass=f=15500,acompressor=threshold=-20dB:ratio=2.2:attack=15:release=180,asplit=2[voice_sc][voice_mix]`,
    `[1:a]atrim=duration=${outputDuration},loudnorm=I=-23:TP=-3:LRA=11,volume='${musicArc}':eval=frame,afade=t=in:st=0:d=2.2,afade=t=out:st=${fadeOut}:d=2[music]`,
    "[music][voice_sc]sidechaincompress=threshold=0.028:ratio=4:attack=18:release=480[ducked]",
    ...sfxFilters,
    `[voice_mix][ducked]${sfxLabels.join("")}amix=inputs=${2 + sfxLabels.length}:normalize=0,${normalizeFilter(loudnorm)},aformat=channel_layouts=stereo[mix]`
  ];
  return graph.join(";");
}

export async function buildCanonicalAudioMix(
  projectId = PROJECT_ID,
  { mode = "proof", durationSeconds = null, narrationLimitSeconds = null, editorialPauses = true, requireApprovedMusic = true } = {}
) {
  const dir = projectDir(projectId);
  const audioDir = path.join(dir, "assets", "audio");
  const musicDir = path.join(dir, "assets", "music");
  const sfxDir = path.join(dir, "assets", "sfx");
  await Promise.all([fs.mkdir(audioDir, { recursive: true }), fs.mkdir(musicDir, { recursive: true }), fs.mkdir(sfxDir, { recursive: true })]);
  const sourceVoice = path.join(audioDir, "final_voice.mp3");
  const approvedMusic = path.join(musicDir, "approved_bed.mp3");
  const approvedMusicProvenancePath = path.join(musicDir, "approved_bed.provenance.json");
  const mix = path.join(audioDir, "final_mix.mp3");
  if (!(await exists(sourceVoice))) throw new Error("Missing required narrator file: assets/audio/final_voice.mp3");

  const sourceDuration = await durationSecondsOf(sourceVoice);
  const prepared = await prepareNarrator({ dir, audioDir, sourceVoice, sourceDuration });
  const availableDuration = await durationSecondsOf(prepared.voice);
  const narration = await prepareEditorialNarration({ dir, audioDir, voice: prepared.voice, availableDuration, narrationLimitSeconds, editorialPauses, mode });

  const outputDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : narration.timelineNarrationDuration;
  if (outputDuration + 0.001 < narration.timelineNarrationDuration)
    throw new Error(`Output duration ${outputDuration}s is shorter than the paused narration timeline ${narration.timelineNarrationDuration}s`);

  const hasApprovedMusic = await exists(approvedMusic);
  if (!hasApprovedMusic && requireApprovedMusic) throw new Error("This render requires assets/music/approved_bed.mp3");
  if (!hasApprovedMusic && outputDuration > PROOF_SECONDS + 0.1) throw new Error("Full ORVYQ render requires an approved full-duration music bed");
  const music = hasApprovedMusic ? approvedMusic : await generateFallbackScore(musicDir, outputDuration);
  const provenance = hasApprovedMusic ? await readOptionalJson(approvedMusicProvenancePath) : null;
  if (hasApprovedMusic && !provenance) throw new Error("Approved music requires approved_bed.provenance.json");

  // Full mode's music structure comes from direction/music_cue_sheet.json's
  // own full_cues -- real, already-authored per-section music states for
  // the whole film -- not the proof's 5-section structure blindly rescaled.
  // Its own policy (continuous_single_loop_forbidden,
  // full_render_requires_all_cues_ready) is enforced here as an explicit
  // blocking gap, not silently ignored: a full render must not proceed
  // against cues that are still spec_ready_asset_pending.
  let fullCues = null;
  let fullCuesAuthoredDuration = null;
  if (mode === "full") {
    const cueSheet = await readJson(path.join(dir, "direction", "music_cue_sheet.json"));
    const cues = cueSheet.full_cues || [];
    if (cues.length < (cueSheet.policy?.minimum_distinct_music_states || 0))
      throw new Error(`direction/music_cue_sheet.json has fewer full_cues (${cues.length}) than its own minimum_distinct_music_states policy (${cueSheet.policy?.minimum_distinct_music_states})`);
    if (cueSheet.policy?.continuous_single_loop_forbidden && cues.length < 2)
      throw new Error("direction/music_cue_sheet.json's continuous_single_loop_forbidden policy requires more than one distinct full_cues state");
    const notReady = cues.filter((cue) => cue.status !== "ready");
    if (cueSheet.policy?.full_render_requires_all_cues_ready && notReady.length)
      throw new Error(`Full ORVYQ render is blocked: direction/music_cue_sheet.json full_cues not yet status "ready": ${notReady.map((cue) => cue.cue_id).join(", ")}`);
    fullCues = cues;
    fullCuesAuthoredDuration = Number(cueSheet.duration_seconds);
  }

  const sfx = await generateOriginalSfx(sfxDir);
  const sections = musicSectionsForDuration(outputDuration, { fullCues, fullCuesAuthoredDuration });
  const sfxPlacements = buildSfxPlacements({ pauseWindows: narration.pauseWindows, outputDuration, sfxAssets: sfx });
  const cuesUsed = [...new Set(sfxPlacements.map((placement) => placement.cue))];
  const inputIndexByCue = new Map(cuesUsed.map((cue, index) => [cue, 2 + index]));
  const inputs = ["-i", narration.voice, "-stream_loop", "-1", "-i", music, ...cuesUsed.flatMap((cue) => ["-i", sfx[cue]])];

  const filterOptions = { timelineNarrationDuration: narration.timelineNarrationDuration, outputDuration, pauseWindows: narration.pauseWindows, sections, sfxPlacements, inputIndexByCue };
  const firstPass = await command("ffmpeg", ["-hide_banner", "-nostats", ...inputs, "-filter_complex", mixFilter(filterOptions), "-map", "[mix]", "-t", String(outputDuration), "-f", "null", "-"]);
  const analysis = extractLoudnorm(`${firstPass.stdout}\n${firstPass.stderr}`);
  await command("ffmpeg", ["-hide_banner", "-nostats", "-y", ...inputs, "-filter_complex", mixFilter({ ...filterOptions, loudnorm: analysis }), "-map", "[mix]", "-t", String(outputDuration), "-ac", "2", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "192k", mix]);
  const measured = await measureLoudness(mix);
  const musicMeasured = await measureLoudness(music, { i: -23, tp: -3, lra: 11 });
  const relative = (file) => path.relative(dir, file).split(path.sep).join("/");
  const musicProfile = hasApprovedMusic ? "approved_licensed_bed" : "original_tonal_score";

  const metadata = {
    schema_version: "1.0-canonical",
    mode,
    generated_by: "scripts/orvyq_audio_mix.mjs",
    voice_source: "assets/audio/final_voice.mp3",
    processed_voice_source: relative(narration.voice),
    voice_repair: prepared.repair,
    editorial_pause_map: narration.pauseMap,
    duration_seconds: outputDuration,
    narration_duration_seconds: narration.timelineNarrationDuration,
    narration_source_duration_seconds: narration.sourceNarrationDuration,
    source_duration_seconds: sourceDuration,
    editorial_pause_seconds: narration.editorialPauseSeconds,
    mix_asset: "assets/audio/final_mix.mp3",
    music_asset: relative(music),
    music_profile: musicProfile,
    music_origin: hasApprovedMusic
      ? "CC BY 4.0 licensed cinematic bed downloaded from the composer's official library"
      : "Original sectioned ORVYQ fallback score generated from harmonic oscillators only",
    music_provenance: hasApprovedMusic ? "assets/music/approved_bed.provenance.json" : null,
    music_attribution: provenance?.attribution || null,
    pause_windows: narration.pauseWindows.map((pause) => ({ pause_id: pause.pause_id, start_seconds: round3(pause.start), end_seconds: round3(pause.end) })),
    music_sections: sections.map((section) => ({ id: section.id, start_seconds: round3(section.start), end_seconds: round3(section.end) })),
    music_mix_target_lufs: -23,
    music_source_measured: { integrated_lufs: Number(musicMeasured.input_i), true_peak_dbtp: Number(musicMeasured.input_tp), loudness_range: Number(musicMeasured.input_lra) },
    narration_ducking: { enabled: true, ratio: 4, release_ms: 480, music_rises_during_editorial_pauses: true, editorial_pause_gain: EDITORIAL_PAUSE_GAIN, per_section_under_speech_gain: sections.map((section) => section.under_speech_gain) },
    procedural_noise_generation: false,
    sfx_origin: "original_synthesized_sfx",
    sfx_assets: cuesUsed.map((cue) => relative(sfx[cue])),
    sfx_placements: sfxPlacements.map((placement) => ({ sfx_id: placement.cue, at_seconds: placement.at_seconds })),
    target: { integrated_lufs: -16, true_peak_dbtp: -1.5, loudness_range: 9 },
    measured: { integrated_lufs: Number(measured.input_i), true_peak_dbtp: Number(measured.input_tp), loudness_range: Number(measured.input_lra) },
    licensing: hasApprovedMusic
      ? `Narration, original synthesized SFX, and CC BY 4.0 music. ${provenance.attribution}`
      : "Narration plus an original tonal score and original synthesized SFX; no third-party audio."
  };
  await writeJsonAtomic(path.join(audioDir, "final_mix.metadata.json"), metadata);
  return { outputDuration, narrationTimelineDuration: narration.timelineNarrationDuration, editorialPauseSeconds: narration.editorialPauseSeconds, measured, musicProfile, musicSections: sections.length, sfxAssets: cuesUsed.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  buildCanonicalAudioMix(args["project-id"] || PROJECT_ID, {
    mode: args.mode || "proof",
    durationSeconds: args["duration-seconds"] ? Number.parseFloat(args["duration-seconds"]) : null,
    narrationLimitSeconds: args["narration-limit-seconds"] ? Number.parseFloat(args["narration-limit-seconds"]) : null,
    editorialPauses: args["no-editorial-pauses"] ? false : true,
    requireApprovedMusic: args["allow-fallback-music"] ? false : true
  })
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
