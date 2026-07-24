import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDurationParity } from "./orvyq_duration_parity_audit.mjs";

test("exact match passes", () => {
  const { failures } = checkDurationParity({ videoDurationFrames: 25719, fps: 30, audioDurationSeconds: 857.3 });
  assert.equal(failures.length, 0);
});

test("a 1-frame difference passes (within tolerance)", () => {
  const { failures } = checkDurationParity({ videoDurationFrames: 25719, fps: 30, audioDurationSeconds: 857.29 - 1 / 30 });
  assert.equal(failures.length, 0);
});

// Regression test: the old full render's video/audio mismatch (missing
// hook-duration head silence AND missing end-card padding, ~14s+ combined)
// must fail hard.
test("regression: a ~14s audio/video mismatch fails", () => {
  const { failures } = checkDurationParity({ videoDurationFrames: 25719, fps: 30, audioDurationSeconds: 857.29 - 14.4 });
  assert.ok(failures.length > 0);
});

test("a difference just over the tolerance fails", () => {
  const { failures } = checkDurationParity({ videoDurationFrames: 30 * 100, fps: 30, audioDurationSeconds: 100.15 });
  assert.ok(failures.length > 0);
});
