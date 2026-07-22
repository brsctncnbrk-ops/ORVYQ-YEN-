// resolveFullFilmPauses() -- full-mode editorial pause anchor resolution.
//
// The golden defect this replaces: orvyq_audio_mix.mjs's
// prepareEditorialNarration() only ever read direction/editorial_pause_map
// .json's "proof" pause list (four fixed, hand-timed source_time_seconds
// values that describe the 150s proof narration specifically) -- regardless
// of mode. Running that against a full-length narration would silently
// concentrate all four pauses in the first ~114s of an 800+s recording and
// leave the rest of the film with zero editorial pauses, which is not a
// full-mode pause plan at all, just the proof's plan reused by accident.
//
// This module resolves "full_film_pause_anchors" (text-anchored, not yet
// timed) against voice/narration_alignment.json's real per-word ASR
// timestamps -- the one place full-mode narration timing is computed (see
// scripts/orvyq_narration_alignment.mjs) -- into real, deterministic
// source_time_seconds values, completely independent of proof.pauses.
import { createHash } from "node:crypto";

export function normalizeToken(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9']+/g, "");
}

// Exported so scripts/orvyq_full_production_plan.mjs can locate a claim's
// narration_excerpt in the same real word-alignment this resolver uses for
// pause anchors -- one text-location algorithm, not two.
export function tokenizeWords(words) {
  return words
    .map((word, index) => ({ index, norm: normalizeToken(word.text), start: word.start, end: word.end, raw: word.text }))
    .filter((token) => token.norm.length > 0);
}

export function tokenizeAnchorText(text) {
  // Splits on hyphens as well as whitespace: Whisper's real transcription
  // consistently renders hyphenated compounds ("high-risk", "general-
  // purpose", "incident-reporting") as separate space-separated words, not
  // one joined token, so anchor/claim text needs the same split to match --
  // otherwise normalizeToken's character-strip alone would turn "high-risk"
  // into a single "highrisk" token that never matches the real transcript's
  // separate "high" "risk" words.
  return String(text)
    .split(/[\s-]+/)
    .map(normalizeToken)
    .filter(Boolean);
}

function endsAtSentenceBoundary(text) {
  return /[.!?]['")’]?\s*$/.test(String(text).trim());
}

export function findAnchorMatch(tokens, anchorTokens, searchFromTokenIndex) {
  if (!anchorTokens.length) return -1;
  for (let i = searchFromTokenIndex; i <= tokens.length - anchorTokens.length; i += 1) {
    let matched = true;
    for (let j = 0; j < anchorTokens.length; j += 1) {
      if (tokens[i + j].norm !== anchorTokens[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }
  return -1;
}

const DEFAULT_MIN_PAUSE_SECONDS = 2;
const DEFAULT_MAX_PAUSE_SECONDS = 20;
const DEFAULT_MIN_SECONDS_FROM_NARRATION_END = 3;

export function resolveFullFilmPauses({
  words,
  anchors,
  minPauseSeconds = DEFAULT_MIN_PAUSE_SECONDS,
  maxPauseSeconds = DEFAULT_MAX_PAUSE_SECONDS,
  minSecondsFromNarrationEnd = DEFAULT_MIN_SECONDS_FROM_NARRATION_END,
  // The last anchor in a real full_film_pause_anchors list is conventionally
  // the film's closing beat (e.g. "It's still being decided... by people,
  // right now." -- purpose "Final human-agency landing and music decay"):
  // it is SUPPOSED to resolve at or right up against the narration's true
  // end, so the narration doesn't end, then only afterwards start a pause --
  // the hold and the ending are the same moment. The near-end check exists
  // to catch anchors that accidentally land too close to the end, not to
  // forbid a deliberate final hold, so it only applies to the last anchor
  // when there is more than one (a single-anchor list has no such
  // convention to lean on).
  allowFinalAnchorAtNarrationEnd = true
}) {
  if (!Array.isArray(words) || !words.length) throw new Error("resolveFullFilmPauses requires a non-empty words array (voice/narration_alignment.json)");
  if (!Array.isArray(anchors) || !anchors.length) throw new Error("resolveFullFilmPauses requires a non-empty full_film_pause_anchors array");

  const tokens = tokenizeWords(words);
  const narrationEndSeconds = words[words.length - 1].end;
  const pauses = [];
  let cursorTokenIndex = 0;
  let previousSourceTimeSeconds = -Infinity;

  for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
    const anchor = anchors[anchorIndex];
    const anchorTokens = tokenizeAnchorText(anchor.anchor_text);
    if (!anchorTokens.length) throw new Error(`Pause anchor ${anchorIndex} has an empty anchor_text`);
    if (!endsAtSentenceBoundary(anchor.anchor_text))
      throw new Error(`Pause anchor ${anchorIndex} ("${anchor.anchor_text}") does not end at a sentence boundary -- refusing to split mid-sentence`);

    const matchTokenIndex = findAnchorMatch(tokens, anchorTokens, cursorTokenIndex);
    if (matchTokenIndex === -1) {
      throw new Error(
        `Pause anchor ${anchorIndex} ("${anchor.anchor_text}") was not found in the narration alignment at or after the previous anchor's position -- ` +
          "either the anchor text does not match this recording, anchors are out of narration order, or a duplicate phrase was already consumed by an earlier anchor"
      );
    }

    const matchedLastToken = tokens[matchTokenIndex + anchorTokens.length - 1];
    const sourceTimeSeconds = matchedLastToken.end;
    if (sourceTimeSeconds <= previousSourceTimeSeconds)
      throw new Error(`Pause anchor ${anchorIndex} resolved to ${sourceTimeSeconds}s, not after the previous pause at ${previousSourceTimeSeconds}s -- pauses would overlap`);
    const isFinalClosingAnchor = allowFinalAnchorAtNarrationEnd && anchors.length > 1 && anchorIndex === anchors.length - 1;
    if (!isFinalClosingAnchor && narrationEndSeconds - sourceTimeSeconds < minSecondsFromNarrationEnd)
      throw new Error(`Pause anchor ${anchorIndex} resolves ${(narrationEndSeconds - sourceTimeSeconds).toFixed(2)}s before narration end, closer than the required ${minSecondsFromNarrationEnd}s`);

    const durationSeconds = Number(anchor.planned_seconds);
    if (!Number.isFinite(durationSeconds) || durationSeconds < minPauseSeconds || durationSeconds > maxPauseSeconds)
      throw new Error(`Pause anchor ${anchorIndex} has an invalid planned_seconds ${anchor.planned_seconds} (must be between ${minPauseSeconds} and ${maxPauseSeconds})`);

    const pauseId = `PAUSE_FULL_${String(anchorIndex + 1).padStart(2, "0")}_${createHash("sha1").update(anchor.anchor_text).digest("hex").slice(0, 8)}`;
    pauses.push({
      pause_id: pauseId,
      anchor_text: anchor.anchor_text,
      purpose: anchor.purpose || null,
      source_time_seconds: Math.round(sourceTimeSeconds * 1000) / 1000,
      duration_seconds: durationSeconds
    });

    previousSourceTimeSeconds = sourceTimeSeconds;
    cursorTokenIndex = matchTokenIndex + anchorTokens.length;
  }

  return { pauses, narrationEndSeconds };
}
