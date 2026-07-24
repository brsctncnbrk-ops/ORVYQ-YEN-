import { test } from "node:test";
import assert from "node:assert/strict";
import { auditPauseRiseMetadata } from "./orvyq_music_pause_rise_audit.mjs";

function metadata(overrides = {}) {
  return {
    narration_ducking: { enabled: true, music_rises_during_editorial_pauses: true, pause_rise_db: 3, pause_rise_ramp_seconds: 0.6 },
    pause_windows: [{ pause_id: "PAUSE_01", start_seconds: 10, end_seconds: 15 }],
    end_card_fade_seconds: 5,
    head_silence_seconds: 12,
    ...overrides
  };
}

test("a compliant metadata document passes", () => {
  const { failures } = auditPauseRiseMetadata(metadata());
  assert.equal(failures.length, 0);
});

// Regression test for the old defect: EDITORIAL_PAUSE_GAIN = 1.02 is a
// ~0.17dB rise -- far below the 2dB floor -- and this must fail.
test("regression: an old-style ~0.17dB rise (linear gain 1.02) fails the 2-4dB band", () => {
  const oldStyleDb = 20 * Math.log10(1.02);
  const { failures } = auditPauseRiseMetadata(metadata({ narration_ducking: { enabled: true, music_rises_during_editorial_pauses: true, pause_rise_db: oldStyleDb, pause_rise_ramp_seconds: 0.6 } }));
  assert.ok(failures.some((f) => f.includes("2-4dB")));
});

test("a zero ramp (instant jump) fails", () => {
  const { failures } = auditPauseRiseMetadata(metadata({ narration_ducking: { enabled: true, music_rises_during_editorial_pauses: true, pause_rise_db: 3, pause_rise_ramp_seconds: 0 } }));
  assert.ok(failures.some((f) => f.includes("instant on/off")));
});

test("missing end_card_fade_seconds fails", () => {
  const { failures } = auditPauseRiseMetadata(metadata({ end_card_fade_seconds: undefined }));
  assert.ok(failures.some((f) => f.includes("end_card_fade_seconds is missing")));
});

// Regression test for the old ~14.4s silent final tail: a flat 2s fade
// (rather than the required 4-6s controlled release) must fail.
test("regression: a too-short 2s closing fade fails the 4-6.5s band", () => {
  const { failures } = auditPauseRiseMetadata(metadata({ end_card_fade_seconds: 2 }));
  assert.ok(failures.some((f) => f.includes("4-6.5s band")));
});

test("no pause_windows recorded at all is a failure, not a silent pass", () => {
  const { failures } = auditPauseRiseMetadata(metadata({ pause_windows: [] }));
  assert.ok(failures.some((f) => f.includes("no pause_windows")));
});
