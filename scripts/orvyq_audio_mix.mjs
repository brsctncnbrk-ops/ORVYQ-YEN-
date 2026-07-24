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
import { projectDir, readJson, writeJsonAtomic, pathExists, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { resolveFullFilmPauses } from "./lib/orvyq-pause-resolver.mjs";
import { command, extractLoudnorm, measureLoudness, normalizeFilter, durationSecondsOf } from "./lib/orvyq-loudness.mjs";
import { DEFAULT_PAUSE_RISE_DB, DEFAULT_PAUSE_RISE_RAMP_SECONDS, buildPauseRiseFfmpegExpr } from "./lib/orvyq-music-envelope.mjs";
import { END_CARD_FADE_SECONDS } from "./lib/orvyq-timeline.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const PROOF_SECONDS = 150;
const UNDER_SPEECH_GAIN_DEFAULT = 0.7;
const FIRST_EVIDENCE_BEAT_PROOF_SECONDS = 11;

const PROOF_MUSIC_SECTIONS = [
  { id: "controlled_tension", start: 0, end: 35, function: "Opening paradox and competitive pressure", energy_start: 0.3, energy_end: 0.48, under_speech_gain: 0.72 },
  { id: "present_tense_turn", start: 35, end: 59.62, function: "Safety frameworks, governance lag, and the present-tense emphasis beat", energy_start: 0.42, energy_end: 0.62, under_speech_gain: 0.78 },
  { id: "analytical_unease", start: 59.62, end: 93.4, function: "Controlled evaluation evidence and scenario mechanics", energy_start: 0.5, energy_end: 0.7, under_speech_gain: 0.82 },
  { id: "engineered_pressure", start: 93.4, end: 126.56, function: "Replacement condition, deliberation, result, and limitation setup", energy_start: 0.64, energy_end: 0.84, under_speech_gain: 0.86 },
  { id: "reflective_release", start: 126.56, end: 150, function: "Controlled-test limitation, recap, and clean branded release", energy_start: 0.58, energy_end: 0.2, under_speech_gain: 0.7 }
];

const SFX_VOLUME_BY_CUE = { low_impact: 0.5, tonal_bloom: 0.7, ui_tick: 0.65 };

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
  // There is only ONE real set of editorial pauses now: the candidate's own
  // full_film_pause_anchors, resolved against the real per-word ASR
  // timestamps in voice/narration_alignment.json (scripts/lib/orvyq-pause-
  // resolver.mjs) -- the same resolver scripts/orvyq_full_production_plan.mjs
  // uses to place pause shots in the edit plan, so the audio mix's pause
  // timing and the video timeline's pause timing can never independently
  // drift apart. `pauseMap.proof.pauses` (the old, separately-authored 150s
  // cut's own 4 pauses) is historical/regression reference only -- see
  // docs/canonical-candidate-audit.md -- and is never read by a live build:
  // there is no more separate proof creative content, per task section 2.
  const alignment = await readJson(path.join(dir, "voice", "narration_alignment.json"));
  const anchors = pauseMap?.full_film_pause_anchors || [];
  if (!anchors.length) throw new Error("Editorial pause mode requires direction/editorial_pause_map.json full_film_pause_anchors");
  const { pauses: resolved } = resolveFullFilmPauses({ words: alignment.words, anchors });
  // Each full_film_pause_anchors entry carries its own authored sound_cue
  // (direction/editorial_pause_map.json); its real, already-authored
  // `purpose` text carries through as `emphasis` for the mix metadata.
  const configuredPauses = resolved.map((pause) => ({ ...pause, emphasis: pause.purpose }));
  if (!configuredPauses.length) throw new Error("Editorial pause mode requires direction/editorial_pause_map.json full_film_pause_anchors");
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
// full film's actual sections). full_cues' own start/end values are already
// real absolute seconds matching the actual narration timeline (they are
// regenerated from direction/edit_plan.json's own section boundaries every
// time scripts/orvyq_full_production_plan.mjs runs) -- no proportional
// rescaling is applied. This also makes a genuine proof-boundary prefix
// render (`duration` shorter than `fullCuesAuthoredDuration`, deliberately,
// via scripts/orvyq_edit_plan.mjs's resolveProofBoundaryFrame) work
// correctly: cues are simply clipped to whatever `duration` is actually
// being produced, rather than squeezed proportionally into a shorter span
// (which would desynchronize every cue from the real narration content it
// was authored against).
export function musicSectionsForDuration(duration, { fullCues, fullCuesAuthoredDuration } = {}) {
  if (fullCues?.length) {
    return fullCues
      .filter((cue) => Number(cue.start) < duration - 0.001)
      .map((cue) => ({
        id: cue.cue_id,
        start: Number(cue.start),
        end: Math.min(Number(cue.end), duration),
        function: cue.function,
        energy_start: cue.energy_start,
        energy_end: cue.energy_end,
        under_speech_gain: UNDER_SPEECH_GAIN_DEFAULT
      }));
  }
  if (Math.abs(duration - PROOF_SECONDS) < 0.01) return PROOF_MUSIC_SECTIONS;
  const boundaries = [0, 0.23, 0.4, 0.63, 0.84, 1].map((ratio) => ratio * duration);
  return PROOF_MUSIC_SECTIONS.map((section, index) => ({ ...section, start: boundaries[index], end: boundaries[index + 1] }));
}

// Builds the under-speech ducking curve from the SAME per-duration sections
// musicSectionsForDuration() returns -- see the file header for why this
// used to be a second, independently-hardcoded copy of the boundaries.
//
// The pause rise is no longer a hard step to a fixed 1.02x (a ~0.17dB rise,
// inaudible -- see docs/canonical-candidate-audit.md section 4): it now
// multiplies the section baseline by scripts/lib/orvyq-music-envelope.mjs's
// ramped, measurable 2-4dB envelope, built from the exact same function
// scripts/orvyq_music_pause_rise_audit.mjs uses to verify it, so the audio
// that renders and the QA that checks it can never independently drift
// apart.
export function musicVolumeExpression(sections, pauseWindows, { riseDb = DEFAULT_PAUSE_RISE_DB, rampSeconds = DEFAULT_PAUSE_RISE_RAMP_SECONDS } = {}) {
  let baseExpression = String(sections.at(-1)?.under_speech_gain ?? UNDER_SPEECH_GAIN_DEFAULT);
  for (let i = sections.length - 2; i >= 0; i -= 1) {
    const section = sections[i];
    baseExpression = `if(lt(t,${section.end}),${section.under_speech_gain ?? UNDER_SPEECH_GAIN_DEFAULT},${baseExpression})`;
  }
  if (!pauseWindows.length) return baseExpression;
  const riseFactorExpression = buildPauseRiseFfmpegExpr(pauseWindows, { riseDb, rampSeconds });
  return `((${baseExpression})*(${riseFactorExpression}))`;
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

function mixFilter({ headSilenceSeconds, timelineNarrationDuration, outputDuration, pauseWindows, sections, sfxPlacements, inputIndexByCue, loudnorm = null }) {
  // The final closing release (task section 13): a controlled fade over the
  // last END_CARD_FADE_SECONDS, not the old flat 2s -- long enough to be a
  // real, felt release under the end card rather than an abrupt cut.
  const fadeOutSeconds = Math.min(END_CARD_FADE_SECONDS, outputDuration);
  const fadeOut = Math.max(0, outputDuration - fadeOutSeconds);
  const musicArc = musicVolumeExpression(sections, pauseWindows);
  const { filters: sfxFilters, mixLabels: sfxLabels } = buildSfxFilterGraph({ sfxPlacements, inputIndexByCue });
  const voiceContentDuration = headSilenceSeconds + timelineNarrationDuration;
  const graph = [
    // Leading silence equal to the motion hook's real duration, so the
    // narration lands at the same absolute time it does in the video
    // timeline (hook first, then narration) -- see
    // docs/canonical-candidate-audit.md section 5b. Trailing padding then
    // covers the end card, up to the full candidate duration.
    `[0:a]adelay=${Math.round(headSilenceSeconds * 1000)}|${Math.round(headSilenceSeconds * 1000)},atrim=duration=${voiceContentDuration},apad=pad_dur=${Math.max(0, outputDuration - voiceContentDuration)},atrim=duration=${outputDuration},highpass=f=70,lowpass=f=15500,acompressor=threshold=-20dB:ratio=2.2:attack=15:release=180,asplit=2[voice_sc][voice_mix]`,
    `[1:a]atrim=duration=${outputDuration},loudnorm=I=-23:TP=-3:LRA=11,volume='${musicArc}':eval=frame,afade=t=in:st=0:d=2.2,afade=t=out:st=${fadeOut}:d=${fadeOutSeconds}[music]`,
    "[music][voice_sc]sidechaincompress=threshold=0.028:ratio=4:attack=18:release=480[ducked]",
    ...sfxFilters,
    `[voice_mix][ducked]${sfxLabels.join("")}amix=inputs=${2 + sfxLabels.length}:normalize=0,${normalizeFilter(loudnorm)},aformat=channel_layouts=stereo[mix]`
  ];
  return graph.join(";");
}

export async function buildCanonicalAudioMix(
  projectId = PROJECT_ID,
  {
    mode = "candidate",
    durationSeconds = null,
    narrationLimitSeconds = null,
    editorialPauses = true,
    requireApprovedMusic = true,
    allowPrefixTruncation = false,
    // The real motion-hook duration (seconds) that precedes the narration in
    // the video timeline. Video places <Audio> at the composition root with
    // no `from=` offset (templates/remotion/src/Video.tsx), so the mix file
    // itself must contain this much leading silence before narration starts,
    // or narration plays hookDuration seconds too early relative to the
    // picture -- see docs/canonical-candidate-audit.md section 5b. Callers
    // should resolve this from scripts/lib/orvyq-timeline.mjs, the single
    // source of truth for the candidate's timeline, not recompute it here.
    headSilenceSeconds = 0
  } = {}
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
  if (!Number.isFinite(headSilenceSeconds) || headSilenceSeconds < 0) throw new Error(`headSilenceSeconds must be a non-negative number, got ${headSilenceSeconds}`);

  const sourceDuration = await durationSecondsOf(sourceVoice);
  const prepared = await prepareNarrator({ dir, audioDir, sourceVoice, sourceDuration });
  const availableDuration = await durationSecondsOf(prepared.voice);
  const narration = await prepareEditorialNarration({ dir, audioDir, voice: prepared.voice, availableDuration, narrationLimitSeconds, editorialPauses, mode });
  // Shift every narration-relative time (pauses, and anything derived from
  // them) forward by the leading hook silence, so they land at the same
  // absolute position the video timeline (and scripts/orvyq_caption_build.mjs,
  // which reads pause_windows directly off this file) already uses.
  const absolutePauseWindows = narration.pauseWindows.map((pause) => ({ ...pause, start: pause.start + headSilenceSeconds, end: pause.end + headSilenceSeconds }));
  const voiceContentDuration = headSilenceSeconds + narration.timelineNarrationDuration;

  const outputDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : voiceContentDuration;
  // A shorter outputDuration normally means broken input (someone forgot to
  // include the whole paused narration, or the leading hook silence) and
  // must fail loud. The one legitimate exception is a deliberate boundary
  // prefix render: the full paused narration timeline is still built above
  // from the complete narration and all real editorial pauses
  // (narrationLimitSeconds/mode are untouched), and only the FINAL mix
  // output is intentionally cut short at outputDuration -- exactly the same
  // real full narration/music content a full-length render would produce,
  // just truncated at render time. The caller must opt into this
  // explicitly; it is never the default, and per task section 2 a
  // deliverable rendered this way is historical/regression reference only,
  // never a substitute for the full-length review render.
  if (outputDuration + 0.001 < voiceContentDuration && !allowPrefixTruncation)
    throw new Error(`Output duration ${outputDuration}s is shorter than the head silence + paused narration timeline ${voiceContentDuration}s`);

  const hasApprovedMusic = await exists(approvedMusic);
  if (!hasApprovedMusic && requireApprovedMusic) throw new Error("This render requires assets/music/approved_bed.mp3");
  if (!hasApprovedMusic && outputDuration > PROOF_SECONDS + 0.1) throw new Error("Full ORVYQ render requires an approved full-duration music bed");
  const music = hasApprovedMusic ? approvedMusic : await generateFallbackScore(musicDir, outputDuration);
  const provenance = hasApprovedMusic ? await readOptionalJson(approvedMusicProvenancePath) : null;
  if (hasApprovedMusic && !provenance) throw new Error("Approved music requires approved_bed.provenance.json");

  // The candidate's music structure comes from direction/music_cue_sheet.json's
  // own full_cues -- real, already-authored per-section music states for the
  // whole film. `full_render_requires_all_cues_ready` is enforced as an
  // explicit blocking gap, not silently ignored: a render must not proceed
  // against cues that are still spec_ready_asset_pending.
  // `continuous_single_loop_forbidden` (which required >= 2 cues) has been
  // replaced by `single_tonal_world_required` -- a real continuous musical
  // backbone is the goal now, not a mandated minimum number of distinct
  // tracks (see docs/canonical-candidate-audit.md section 4).
  const cueSheet = await readJson(path.join(dir, "direction", "music_cue_sheet.json"));
  const cues = cueSheet.full_cues || [];
  if (cues.length < (cueSheet.policy?.minimum_distinct_music_states || 0))
    throw new Error(`direction/music_cue_sheet.json has fewer full_cues (${cues.length}) than its own minimum_distinct_music_states policy (${cueSheet.policy?.minimum_distinct_music_states})`);
  const notReady = cues.filter((cue) => cue.status !== "ready");
  if (cueSheet.policy?.full_render_requires_all_cues_ready && notReady.length)
    throw new Error(`Render is blocked: direction/music_cue_sheet.json full_cues not yet status "ready": ${notReady.map((cue) => cue.cue_id).join(", ")}`);
  const fullCues = cues;
  const fullCuesAuthoredDuration = Number(cueSheet.duration_seconds);

  const sfx = await generateOriginalSfx(sfxDir);
  const sections = musicSectionsForDuration(outputDuration, { fullCues, fullCuesAuthoredDuration });
  const sfxPlacements = buildSfxPlacements({ pauseWindows: absolutePauseWindows, outputDuration, sfxAssets: sfx });
  const cuesUsed = [...new Set(sfxPlacements.map((placement) => placement.cue))];
  const inputIndexByCue = new Map(cuesUsed.map((cue, index) => [cue, 2 + index]));
  const inputs = ["-i", narration.voice, "-stream_loop", "-1", "-i", music, ...cuesUsed.flatMap((cue) => ["-i", sfx[cue]])];

  const filterOptions = { headSilenceSeconds, timelineNarrationDuration: narration.timelineNarrationDuration, outputDuration, pauseWindows: absolutePauseWindows, sections, sfxPlacements, inputIndexByCue };
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
    head_silence_seconds: round3(headSilenceSeconds),
    narration_duration_seconds: narration.timelineNarrationDuration,
    narration_source_duration_seconds: narration.sourceNarrationDuration,
    source_duration_seconds: sourceDuration,
    editorial_pause_seconds: narration.editorialPauseSeconds,
    end_card_fade_seconds: Math.min(END_CARD_FADE_SECONDS, outputDuration),
    mix_asset: "assets/audio/final_mix.mp3",
    music_asset: relative(music),
    music_profile: musicProfile,
    music_origin: hasApprovedMusic
      ? "CC BY 4.0 licensed cinematic bed downloaded from the composer's official library"
      : "Original sectioned ORVYQ fallback score generated from harmonic oscillators only",
    music_provenance: hasApprovedMusic ? "assets/music/approved_bed.provenance.json" : null,
    music_attribution: provenance?.attribution || null,
    // Absolute (hook-inclusive) times -- the same time base as
    // direction/edit_plan.json's shot frames, since
    // scripts/orvyq_caption_build.mjs converts these directly to frame
    // numbers and compares them against edit-plan frames. See
    // docs/canonical-candidate-audit.md section 5b.
    pause_windows: absolutePauseWindows.map((pause) => ({ pause_id: pause.pause_id, start_seconds: round3(pause.start), end_seconds: round3(pause.end) })),
    music_sections: sections.map((section) => ({ id: section.id, start_seconds: round3(section.start), end_seconds: round3(section.end) })),
    music_mix_target_lufs: -23,
    music_source_measured: { integrated_lufs: Number(musicMeasured.input_i), true_peak_dbtp: Number(musicMeasured.input_tp), loudness_range: Number(musicMeasured.input_lra) },
    narration_ducking: {
      enabled: true,
      ratio: 4,
      release_ms: 480,
      music_rises_during_editorial_pauses: true,
      pause_rise_db: DEFAULT_PAUSE_RISE_DB,
      pause_rise_ramp_seconds: DEFAULT_PAUSE_RISE_RAMP_SECONDS,
      per_section_under_speech_gain: sections.map((section) => section.under_speech_gain)
    },
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
  return {
    outputDuration,
    headSilenceSeconds,
    narrationTimelineDuration: narration.timelineNarrationDuration,
    editorialPauseSeconds: narration.editorialPauseSeconds,
    measured,
    musicProfile,
    musicSections: sections.length,
    sfxAssets: cuesUsed.length
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  buildCanonicalAudioMix(args["project-id"] || PROJECT_ID, {
    mode: args.mode || "candidate",
    durationSeconds: args["duration-seconds"] ? Number.parseFloat(args["duration-seconds"]) : null,
    narrationLimitSeconds: args["narration-limit-seconds"] ? Number.parseFloat(args["narration-limit-seconds"]) : null,
    editorialPauses: args["no-editorial-pauses"] ? false : true,
    requireApprovedMusic: args["allow-fallback-music"] ? false : true,
    allowPrefixTruncation: Boolean(args["allow-prefix-truncation"]),
    headSilenceSeconds: args["head-silence-seconds"] ? Number.parseFloat(args["head-silence-seconds"]) : 0
  })
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
