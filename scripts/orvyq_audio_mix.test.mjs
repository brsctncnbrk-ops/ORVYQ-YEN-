import { test } from "node:test";
import assert from "node:assert/strict";
import { musicSectionsForDuration, musicVolumeExpression } from "./orvyq_audio_mix.mjs";

const FULL_CUES = [
  { cue_id: "CUE_01", start: 0, end: 72, function: "open", energy_start: 0.28, energy_end: 0.58 },
  { cue_id: "CUE_02", start: 72, end: 180, function: "evidence", energy_start: 0.32, energy_end: 0.62 },
  { cue_id: "CUE_03", start: 180, end: 720, function: "close", energy_start: 0.46, energy_end: 0.08 }
];

test("proof duration returns the exact hand-timed proof sections unchanged", () => {
  const sections = musicSectionsForDuration(150);
  assert.equal(sections.length, 5);
  assert.equal(sections[0].id, "controlled_tension");
  assert.equal(sections.at(-1).end, 150);
});

test("full-cue sections rescale proportionally onto the real output duration", () => {
  const sections = musicSectionsForDuration(842.29, { fullCues: FULL_CUES, fullCuesAuthoredDuration: 720 });
  assert.equal(sections.length, 3);
  const scale = 842.29 / 720;
  assert.ok(Math.abs(sections[0].end - 72 * scale) < 1e-9);
  assert.ok(Math.abs(sections.at(-1).end - 842.29) < 1e-9);
  // Real, already-authored cue metadata carries through untouched.
  assert.equal(sections[1].function, "evidence");
  assert.equal(sections[1].energy_end, 0.62);
});

test("without full cues, a non-proof duration falls back to the proof structure rescaled by ratio", () => {
  const sections = musicSectionsForDuration(300);
  assert.equal(sections.length, 5);
  assert.equal(sections[0].start, 0);
  assert.ok(Math.abs(sections.at(-1).end - 300) < 1e-9);
});

test("musicVolumeExpression raises gain during every pause window, in addition to the section baseline", () => {
  const sections = [{ end: 10, under_speech_gain: 0.7 }];
  const pauseWindows = [{ start: 3, end: 5 }];
  const expression = musicVolumeExpression(sections, pauseWindows);
  assert.match(expression, /between\(t,3,5\)/);
  assert.match(expression, /0\.7/);
});
