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

test("full-cue sections use their own real absolute seconds unchanged for a genuine full-length render", () => {
  const sections = musicSectionsForDuration(720, { fullCues: FULL_CUES, fullCuesAuthoredDuration: 720 });
  assert.equal(sections.length, 3);
  assert.equal(sections[0].end, 72);
  assert.equal(sections.at(-1).end, 720);
  // Real, already-authored cue metadata carries through untouched.
  assert.equal(sections[1].function, "evidence");
  assert.equal(sections[1].energy_end, 0.62);
});

test("full-cue sections are clipped (not proportionally rescaled) for a shorter deliberate proof-prefix duration", () => {
  const sections = musicSectionsForDuration(100, { fullCues: FULL_CUES, fullCuesAuthoredDuration: 720 });
  // Only cues that actually start before the prefix boundary are included --
  // CUE_03 (starts at 180) is entirely beyond the 100s prefix.
  assert.equal(sections.length, 2);
  assert.equal(sections[0].start, 0);
  assert.equal(sections[0].end, 72);
  assert.equal(sections[1].start, 72);
  // CUE_02 nominally ends at 180, but a prefix that stops at 100s never
  // plays past 100s of it -- the section is clipped to the real render
  // length, not left describing content beyond what actually exists.
  assert.equal(sections[1].end, 100);
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
