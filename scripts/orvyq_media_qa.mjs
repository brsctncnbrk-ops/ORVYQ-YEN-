#!/usr/bin/env node
// Post-render media QA: black frames, transient brightness drops, silence,
// loudness, caption conformance, sound-design declarations, speech. Runs
// against the rendered video directly (ffmpeg/ffprobe), mode-agnostic --
// ported near-verbatim from the golden script, since it never referenced
// plan.preview/composition.json.
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs, projectDir, writeJsonAtomic, readJson, pathExists } from "./lib/fs-utils.mjs";

const exec = promisify(execFile);
async function command(binary, args) {
  try {
    return await exec(binary, args, { maxBuffer: 24 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`${binary} failed: ${error.stderr || error.message}`);
  }
}
function extractLoudnorm(text) {
  const candidates = [...text.matchAll(/\{\s*"input_i"[\s\S]*?\n\}/g)].map((match) => match[0]);
  if (!candidates.length) throw new Error("Loudness analysis returned no JSON");
  return JSON.parse(candidates.at(-1));
}
function parseBlack(text) {
  return [...text.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g)].map((match) => ({ start: Number(match[1]), end: Number(match[2]), duration: Number(match[3]) }));
}
function parseSilence(text) {
  const starts = [...text.matchAll(/silence_start: ([\d.]+)/g)].map((match) => Number(match[1]));
  const ends = [...text.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)].map((match) => ({ end: Number(match[1]), duration: Number(match[2]) }));
  return ends.map((entry, index) => ({ start: starts[index] ?? null, ...entry }));
}
export function parseLumaSamples(text) {
  const samples = [];
  const lines = String(text || "").split(/\r?\n/);
  let time = null;
  for (const line of lines) {
    const timeMatch = line.match(/pts_time:([\d.]+)/);
    if (timeMatch) time = Number(timeMatch[1]);
    const lumaMatch = line.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
    if (lumaMatch && Number.isFinite(time)) {
      samples.push({ time, yavg: Number(lumaMatch[1]) });
      time = null;
    }
  }
  return samples;
}
function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}
function inferSampleInterval(samples) {
  const intervals = samples.slice(1, 121).map((sample, index) => sample.time - samples[index].time).filter((value) => value > 0 && value < 1);
  return median(intervals) || 1 / 30;
}
export function detectTransientBrightnessDrops(samples, duration, options = {}) {
  const sampleInterval = Number(options.sampleInterval || inferSampleInterval(samples));
  const maximumLuma = Number(options.maximumLuma || 28);
  const minimumNeighborLuma = Number(options.minimumNeighborLuma || 12);
  const maximumRelativeLuma = Number(options.maximumRelativeLuma || 0.6);
  const maximumDuration = Number(options.maximumDuration || 0.5);
  const neighborWindow = Number(options.neighborWindow || 0.35);
  const candidates = [];
  for (const sample of samples) {
    if (sample.yavg > maximumLuma) continue;
    const beforeLuma = median(samples.filter((neighbor) => neighbor.time >= sample.time - neighborWindow && neighbor.time < sample.time - sampleInterval / 2).map((neighbor) => neighbor.yavg));
    const afterLuma = median(samples.filter((neighbor) => neighbor.time > sample.time + sampleInterval / 2 && neighbor.time <= sample.time + neighborWindow).map((neighbor) => neighbor.yavg));
    if (beforeLuma === null || afterLuma === null) continue;
    const neighborLuma = Math.min(beforeLuma, afterLuma);
    if (neighborLuma >= minimumNeighborLuma && sample.yavg / neighborLuma <= maximumRelativeLuma) candidates.push({ ...sample, beforeLuma, afterLuma });
  }
  const groups = [];
  for (const candidate of candidates) {
    const group = groups.at(-1);
    if (!group || candidate.time - group.at(-1).time > sampleInterval * 1.6) groups.push([candidate]);
    else group.push(candidate);
  }
  return groups.flatMap((lowSamples) => {
    const start = lowSamples[0].time;
    const end = lowSamples.at(-1).time + sampleInterval;
    const dropDuration = end - start;
    if (dropDuration > maximumDuration + sampleInterval / 2 || start < sampleInterval || end >= duration - 1.5) return [];
    const beforeLuma = median(lowSamples.map((sample) => sample.beforeLuma));
    const afterLuma = median(lowSamples.map((sample) => sample.afterLuma));
    const lowestLuma = Math.min(...lowSamples.map((sample) => sample.yavg));
    return [{ start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000, duration: Math.round(dropDuration * 1000) / 1000, minimum_luma: Math.round(lowestLuma * 100) / 100, average_luma: Math.round(average(lowSamples.map((sample) => sample.yavg)) * 100) / 100, before_luma: Math.round(beforeLuma * 100) / 100, after_luma: Math.round(afterLuma * 100) / 100, sample_count: lowSamples.length }];
  });
}
function normalize(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9']+/g, " ").trim();
}
async function durationSeconds(video) {
  const { stdout } = await command("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", video]);
  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Invalid video duration for ${video}`);
  return duration;
}

export async function runMediaQa({ projectId, video, reportPath, captionsPath, audioMetadataPath }) {
  const duration = await durationSeconds(video);
  const dir = projectDir(projectId);
  const speechQaPath = path.join(dir, "qa", "speech_transcript.json");
  const [blackDetect, brightnessDetect, silenceDetect, loudness, captions, audioMetadata, speechQa, blueprint] = await Promise.all([
    command("ffmpeg", ["-hide_banner", "-nostats", "-i", video, "-an", "-vf", "blackdetect=d=0.6:pix_th=0.08:pic_th=0.985", "-f", "null", "-"]),
    command("ffmpeg", ["-hide_banner", "-nostats", "-i", video, "-an", "-vf", "fps=30,signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-"]),
    command("ffmpeg", ["-hide_banner", "-nostats", "-i", video, "-vn", "-af", "silencedetect=n=-52dB:d=2.5", "-f", "null", "-"]),
    command("ffmpeg", ["-hide_banner", "-nostats", "-i", video, "-vn", "-af", "loudnorm=I=-16:TP=-1.5:LRA=9:print_format=json", "-f", "null", "-"]),
    readJson(captionsPath),
    readJson(audioMetadataPath),
    readJson(speechQaPath),
    readJson(path.join(dir, "direction", "editorial_blueprint.json"))
  ]);
  // Same canonical policy value orvyq_speech_qa.py and orvyq_edit_plan_tests.mjs
  // read -- see docs/source-audit.md section 7's threshold-drift finding.
  const minimumScriptSimilarity = Number(blueprint.global_rules?.minimum_script_similarity ?? 0.85);

  const blackSegments = parseBlack(`${blackDetect.stdout}\n${blackDetect.stderr}`);
  const lumaSamples = parseLumaSamples(`${brightnessDetect.stdout}\n${brightnessDetect.stderr}`);
  const brightnessDrops = detectTransientBrightnessDrops(lumaSamples, duration);
  const silenceSegments = parseSilence(`${silenceDetect.stdout}\n${silenceDetect.stderr}`);
  const measured = extractLoudnorm(`${loudness.stdout}\n${loudness.stderr}`);
  const nonTerminalBlack = blackSegments.filter((segment) => segment.duration >= 0.6 && segment.end < duration - 1.5);
  const meaningfulSilence = silenceSegments.filter((segment) => segment.duration >= 2.5 && (segment.start ?? 0) > 0.5 && (segment.start ?? 0) < duration - 1.5);
  const integratedLufs = Number(measured.input_i);
  const truePeak = Number(measured.input_tp);
  const loudnessRange = Number(measured.input_lra);
  const loudnessOk = integratedLufs >= -18 && integratedLufs <= -13;
  const truePeakOk = truePeak <= -1;
  const dynamicsOk = loudnessRange >= 2;
  const durationOk = Math.abs(duration - Number(audioMetadata.duration_seconds || duration)) <= 0.15;

  const captionItems = captions.captions || [];
  const captionStyleOk = captions.style?.line_count === 1 && captions.style?.active_word_effect === false && captions.style?.background === "none";
  const captionSourceOk = captions.source === "qa/speech_transcript.json" && captions.text_source === "voice/voice_script.txt";
  const captionTextOk = captionItems.length > 0 && /^Every major AI lab\b/i.test(captionItems[0]?.text || "") && captionItems.every((item) => item.text && item.text.length <= 52 && item.text.trim().split(/\s+/).length <= 7);
  const captionTimingOk = captionItems.every((item) => item.start_frame >= 0 && item.end_frame > item.start_frame && item.end_frame <= captions.duration_frames);
  const captionsOk = captionStyleOk && captionSourceOk && captionTextOk && captionTimingOk;

  const approvedMusicProfiles = ["original_tonal_score", "approved_licensed_bed"];
  const sfxAssets = audioMetadata.sfx_assets || [];
  const sfxOk = sfxAssets.length === 0 || (audioMetadata.sfx_origin === "original_synthesized_sfx" && sfxAssets.length >= 3);
  const soundDesignOk = audioMetadata.procedural_noise_generation === false && approvedMusicProfiles.includes(audioMetadata.music_profile) && Boolean(audioMetadata.music_asset) && sfxOk && Number(audioMetadata.music_mix_target_lufs ?? -23) >= -26 && Number(audioMetadata.music_mix_target_lufs ?? -23) <= -20;
  const declaredAssets = [audioMetadata.music_asset, ...(audioMetadata.sfx_assets || [])].filter(Boolean);
  const declaredAudioAssetsExist = await Promise.all(declaredAssets.map((rel) => pathExists(path.join(dir, rel))));
  const audioAssetsOk = declaredAudioAssetsExist.every(Boolean);

  const normalizedTranscript = normalize(speechQa.transcript);
  const openingSpeechOk = normalizedTranscript.startsWith("every major ai lab");
  const speechOk = speechQa.passed === true && speechQa.word_count >= 30 && speechQa.script_similarity >= minimumScriptSimilarity && openingSpeechOk;

  const pass = nonTerminalBlack.length === 0 && brightnessDrops.length === 0 && meaningfulSilence.length === 0 && durationOk && loudnessOk && truePeakOk && dynamicsOk && captionsOk && soundDesignOk && audioAssetsOk && speechOk;
  const report = {
    schema_version: "1.0-canonical",
    project_id: projectId,
    video: path.basename(video),
    duration_seconds: duration,
    thresholds: {
      max_nonterminal_black_seconds: 0.6, brightness_sample_rate_fps: 30, maximum_transient_brightness_drop_seconds: 0.5, near_black_average_luma: 28, minimum_neighbor_average_luma: 12, maximum_relative_luma: 0.6,
      max_nonterminal_silence_seconds: 2.5, integrated_lufs_range: [-18, -13], max_true_peak_dbtp: -1, minimum_loudness_range: 2, caption_line_count: 1, max_caption_words: 7, max_caption_chars: 52,
      minimum_speech_similarity: minimumScriptSimilarity, required_opening_words: "Every major AI lab", required_music_profiles: approvedMusicProfiles
    },
    black_segments: blackSegments,
    nonterminal_black_segments: nonTerminalBlack,
    brightness_samples: lumaSamples.length,
    transient_brightness_drops: brightnessDrops,
    silence_segments: silenceSegments,
    meaningful_silence_segments: meaningfulSilence,
    loudness: { integrated_lufs: integratedLufs, true_peak_dbtp: truePeak, loudness_range: loudnessRange, pass: loudnessOk && truePeakOk && dynamicsOk },
    duration: { actual_seconds: duration, expected_seconds: Number(audioMetadata.duration_seconds), pass: durationOk },
    speech: { word_count: speechQa.word_count, script_similarity: speechQa.script_similarity, coverage: speechQa.speech_coverage, opening_pass: openingSpeechOk, pass: speechOk },
    captions: { count: captionItems.length, style_pass: captionStyleOk, source_pass: captionSourceOk, text_pass: captionTextOk, timing_pass: captionTimingOk, pass: captionsOk },
    sound_design: { music_profile: audioMetadata.music_profile, music_asset: audioMetadata.music_asset, procedural_noise_generation: audioMetadata.procedural_noise_generation, sfx_types: sfxAssets.length, sfx_origin: audioMetadata.sfx_origin || null, assets_exist: audioAssetsOk, pass: soundDesignOk && audioAssetsOk },
    pass
  };

  await writeJsonAtomic(reportPath, report);
  if (!pass) throw new Error(`ORVYQ media QA failed: black=${nonTerminalBlack.length}, brightness_drops=${brightnessDrops.length}, silence=${meaningfulSilence.length}, duration=${durationOk}, LUFS=${integratedLufs}, LRA=${loudnessRange}, speech=${speechOk}, opening=${openingSpeechOk}, captions=${captionsOk}, sound=${soundDesignOk && audioAssetsOk}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args["project-id"];
  const video = args.video;
  if (!projectId || !video) {
    console.error("Usage: node scripts/orvyq_media_qa.mjs --project-id <id> --video <path> [--report <path>]");
    process.exitCode = 1;
  } else {
    const dir = projectDir(projectId);
    const report = args.report || path.join(dir, "qa", "orvyq_preview_media_qa.json");
    const captionsPath = args.captions || path.join(dir, "remotion", "captions.json");
    const audioMetadataPath = args["audio-metadata"] || path.join(dir, "assets", "audio", "final_mix.metadata.json");
    runMediaQa({ projectId, video, reportPath: report, captionsPath, audioMetadataPath })
      .then((result) => console.log(JSON.stringify({ ok: true, ...result })))
      .catch((error) => {
        console.error(JSON.stringify({ ok: false, error: error.message }));
        process.exitCode = 1;
      });
  }
}
