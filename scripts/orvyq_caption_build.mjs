#!/usr/bin/env node
// buildCanonicalCaptions() -- single-line, no-karaoke, editorial-pause-aware
// captions for both proof and full render modes.
//
// Deliberate consolidation vs the golden source: the golden script read its
// frame ceiling from a standalone ORVYQ_PREVIEW_FRAMES env var, a value that
// had to be kept in sync by hand with whatever produced direction/edit_plan.json
// (see docs/source-audit.md section 6 / 7). Here the ceiling is read directly
// from the canonical edit plan's own frame_range.end_frame -- there is no
// second place a frame boundary can drift out of sync with the plan that
// actually gets rendered.
import path from "node:path";
import { promises as fs } from "node:fs";
import { projectDir, readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const MAX_WORDS = 7;
const MAX_CHARS = 52;
const MAX_SPEECH_GAP_SECONDS = 0.8;

function cleanDisplayToken(token) {
  return String(token || "").replace(/\s+/g, " ").trim();
}

function normalizeToken(token) {
  return cleanDisplayToken(token).toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9']/g, "").replace(/^'+|'+$/g, "");
}

function mergeRecognizedWords(words) {
  const merged = [];
  for (const word of words || []) {
    const text = cleanDisplayToken(word.text);
    if (!text) continue;
    if (/^[-–—]/.test(text) && merged.length) {
      const previous = merged.at(-1);
      previous.text += text;
      previous.end = Number(word.end);
      previous.probability = Math.min(Number(previous.probability ?? 1), Number(word.probability ?? 1));
      previous.normalized = normalizeToken(previous.text);
      continue;
    }
    merged.push({ text, normalized: normalizeToken(text), start: Number(word.start), end: Number(word.end), probability: Number(word.probability ?? 1) });
  }
  return merged.filter((word) => word.normalized);
}

function scriptWords(text) {
  return text.replace(/\s+/g, " ").trim().split(" ").map((token) => ({ text: cleanDisplayToken(token), normalized: normalizeToken(token) })).filter((token) => token.normalized);
}

function editDistance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = previous[j];
      const substitution = diagonal + (a[i - 1] === b[j - 1] ? 0 : 1);
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, substitution);
      diagonal = saved;
    }
  }
  return previous[b.length];
}

function substitutionCost(a, b) {
  if (a === b) return 0;
  const singularA = a.endsWith("s") ? a.slice(0, -1) : a;
  const singularB = b.endsWith("s") ? b.slice(0, -1) : b;
  if (singularA === singularB) return 0.2;
  const longest = Math.max(a.length, b.length, 1);
  const similarity = 1 - editDistance(a, b) / longest;
  if (similarity >= 0.82) return 0.35;
  if (similarity >= 0.62) return 0.72;
  return 1.25;
}

function alignScriptToSpeech(script, speech) {
  const scriptLimit = Math.min(script.length, speech.length + 160);
  const target = script.slice(0, scriptLimit);
  const n = target.length;
  const m = speech.length;
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const move = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));

  for (let i = 1; i <= n; i += 1) {
    dp[i][0] = i * 0.92;
    move[i][0] = 1;
  }
  for (let j = 1; j <= m; j += 1) {
    dp[0][j] = j * 0.92;
    move[0][j] = 2;
  }

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const diagonal = dp[i - 1][j - 1] + substitutionCost(target[i - 1].normalized, speech[j - 1].normalized);
      const deleteScript = dp[i - 1][j] + 0.92;
      const insertSpeech = dp[i][j - 1] + 0.92;
      if (diagonal <= deleteScript && diagonal <= insertSpeech) {
        dp[i][j] = diagonal;
        move[i][j] = 0;
      } else if (deleteScript <= insertSpeech) {
        dp[i][j] = deleteScript;
        move[i][j] = 1;
      } else {
        dp[i][j] = insertSpeech;
        move[i][j] = 2;
      }
    }
  }

  let endI = Math.max(1, Math.min(n, m));
  let best = Number.POSITIVE_INFINITY;
  const lower = Math.max(1, m - 60);
  for (let i = lower; i <= n; i += 1) {
    const score = dp[i][m] + Math.abs(i - m) * 0.004;
    if (score < best) {
      best = score;
      endI = i;
    }
  }

  const mapping = new Map();
  let i = endI;
  let j = m;
  while (i > 0 || j > 0) {
    const direction = move[i][j];
    if (i > 0 && j > 0 && direction === 0) {
      mapping.set(i - 1, j - 1);
      i -= 1;
      j -= 1;
    } else if (i > 0 && (j === 0 || direction === 1)) {
      i -= 1;
    } else if (j > 0) {
      j -= 1;
    } else {
      break;
    }
  }
  return { target, mapping, score: best };
}

function interpolateUnmatched(tokens, mapping, speech) {
  const mappedIndexes = [...mapping.keys()].sort((a, b) => a - b);
  if (!mappedIndexes.length) throw new Error("No script words could be aligned to the verified narration");
  const lastMapped = mappedIndexes.at(-1);
  const result = tokens.slice(0, lastMapped + 1).map((token, index) => {
    const speechIndex = mapping.get(index);
    if (speechIndex !== undefined) {
      const word = speech[speechIndex];
      return { ...token, start: word.start, end: word.end, matched: true };
    }
    return { ...token, start: null, end: null, matched: false };
  });

  for (let index = 0; index < result.length; index += 1) {
    if (result[index].matched) continue;
    let previous = index - 1;
    while (previous >= 0 && !result[previous].matched) previous -= 1;
    let next = index + 1;
    while (next < result.length && !result[next].matched) next += 1;

    if (previous < 0 && next < result.length) {
      const count = next;
      const boundary = Math.max(0, Number(result[next].start));
      const step = boundary / Math.max(1, count + 1);
      result[index].start = Math.max(0, step * index);
      result[index].end = Math.max(result[index].start + 0.04, step * (index + 1));
    } else if (previous >= 0 && next < result.length) {
      const gapStart = Number(result[previous].end);
      const gapEnd = Math.max(gapStart, Number(result[next].start));
      const count = next - previous - 1;
      const position = index - previous;
      const step = (gapEnd - gapStart) / Math.max(1, count + 1);
      result[index].start = gapStart + step * (position - 1);
      result[index].end = Math.max(result[index].start + 0.04, gapStart + step * position);
    } else if (previous >= 0) {
      result[index].start = Number(result[previous].end) + (index - previous - 1) * 0.12;
      result[index].end = result[index].start + 0.12;
    }
  }
  return result;
}

function shouldBreak(text, wordCount, nextWord) {
  if (wordCount >= MAX_WORDS) return true;
  if ((text + " " + nextWord).trim().length > MAX_CHARS) return true;
  return /[.!?…]$/.test(text) && wordCount >= 3;
}

function buildChunks(words) {
  const chunks = [];
  let current = [];
  for (const word of words) {
    const currentText = current.map((item) => item.text).join(" ");
    const speechGap = current.length ? Number(word.start) - Number(current.at(-1).end) : 0;
    if (current.length && (speechGap > MAX_SPEECH_GAP_SECONDS || shouldBreak(currentText, current.length, word.text))) {
      chunks.push(current);
      current = [];
    }
    current.push(word);
    if (/[.!?…]$/.test(word.text) && current.length >= 3) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export async function buildCanonicalCaptions(projectId = PROJECT_ID, { frameEnd = null } = {}) {
  const dir = projectDir(projectId);
  const [editPlan, speechQa, approvedScript, audioMetadata] = await Promise.all([
    readJson(path.join(dir, "direction", "edit_plan.json")),
    readJson(path.join(dir, "qa", "speech_transcript.json")),
    fs.readFile(path.join(dir, "voice", "voice_script.txt"), "utf8"),
    readJson(path.join(dir, "assets", "audio", "final_mix.metadata.json"))
  ]);

  if (!speechQa.passed) throw new Error("Cannot build captions from a failed speech transcript");
  const speechWords = mergeRecognizedWords(speechQa.words);
  if (!speechWords.length) throw new Error("Speech transcript has no word timestamps");

  const maxFrame = Number.isFinite(frameEnd) && frameEnd > 0 ? frameEnd : editPlan.frame_range.end_frame;
  const maxSeconds = maxFrame / editPlan.fps;
  const pauseFrames = (audioMetadata.pause_windows || []).map((pause) => ({
    id: pause.pause_id,
    start: Math.ceil(Number(pause.start_seconds) * editPlan.fps),
    end: Math.floor(Number(pause.end_seconds) * editPlan.fps)
  }));
  const approvedWords = scriptWords(approvedScript);
  const alignment = alignScriptToSpeech(approvedWords, speechWords.filter((word) => word.start < maxSeconds));
  const timedScript = interpolateUnmatched(alignment.target, alignment.mapping, speechWords).filter(
    (word) => Number(word.start) < maxSeconds && Number(word.start) < Number(audioMetadata.narration_duration_seconds ?? maxSeconds)
  );
  const chunks = buildChunks(timedScript);
  const captions = [];
  let previousEndFrame = 0;

  chunks.forEach((chunk) => {
    const timestampStart = Math.max(0, Math.floor(Number(chunk[0].start) * editPlan.fps));
    let startFrame = Math.max(timestampStart, previousEndFrame);
    const rawEnd = Math.ceil((Number(chunk.at(-1).end) + 0.08) * editPlan.fps);
    let endFrame = Math.min(maxFrame, Math.max(startFrame + 4, rawEnd));
    for (const pause of pauseFrames) {
      if (startFrame < pause.start && endFrame > pause.end) throw new Error(`Caption chunk spans editorial pause ${pause.id}`);
      if (startFrame < pause.start && endFrame > pause.start) endFrame = pause.start;
      else if (startFrame < pause.end && endFrame > pause.end) startFrame = pause.end;
    }
    if (startFrame >= maxFrame || endFrame <= startFrame) return;
    captions.push({
      caption_id: `caption_${String(captions.length + 1).padStart(3, "0")}`,
      scene_id: null,
      start_frame: startFrame,
      end_frame: endFrame,
      text: chunk.map((item) => item.text).join(" ").replace(/\s+([,.;!?])/g, "$1")
    });
    previousEndFrame = endFrame;
  });

  const payload = {
    schema_version: "1.0-canonical",
    project_id: projectId,
    fps: editPlan.fps,
    duration_frames: maxFrame,
    source: "qa/speech_transcript.json",
    text_source: "voice/voice_script.txt",
    alignment_method: "dynamic-programming forced alignment of approved script words to verified final-audio word timestamps",
    timing_policy: "approved script text with speech-derived timings; long speech gaps split captions; editorial pauses remain caption-free",
    alignment: {
      recognized_words: speechWords.length,
      aligned_script_words: timedScript.length,
      mapped_words: alignment.mapping.size,
      score: Math.round(alignment.score * 1000) / 1000
    },
    style: {
      placement: "bottom_safe",
      line_count: 1,
      max_words: MAX_WORDS,
      max_chars: MAX_CHARS,
      max_speech_gap_seconds: MAX_SPEECH_GAP_SECONDS,
      font_family: "Arial, Helvetica, sans-serif",
      font_size_px: 36,
      background: "none",
      active_word_effect: false
    },
    captions
  };

  await writeJsonAtomic(path.join(dir, "remotion", "captions.json"), payload);
  return { caption_count: captions.length, duration_frames: maxFrame, text_source: payload.text_source, source: payload.source };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const frameEnd = args["frame-end"] ? Number.parseInt(args["frame-end"], 10) : null;
  buildCanonicalCaptions(args["project-id"] || PROJECT_ID, { frameEnd })
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
