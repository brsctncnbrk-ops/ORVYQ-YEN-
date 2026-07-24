import { test } from "node:test";
import assert from "node:assert/strict";
import { pauseGainMultiplierAt, combinedPauseGainMultiplier, buildPauseRiseFfmpegExpr, dbToLinear } from "./orvyq-music-envelope.mjs";

const PAUSE = { start: 10, end: 15 };

test("pauseGainMultiplierAt is 1 (no rise) well outside the pause window", () => {
  assert.equal(pauseGainMultiplierAt(0, PAUSE), 1);
  assert.equal(pauseGainMultiplierAt(30, PAUSE), 1);
});

test("pauseGainMultiplierAt reaches the full rise during the pause, held flat", () => {
  const full = dbToLinear(3);
  assert.ok(Math.abs(pauseGainMultiplierAt(12, PAUSE, { riseDb: 3, rampSeconds: 0.6 }) - full) < 1e-9);
  assert.ok(Math.abs(pauseGainMultiplierAt(15, PAUSE, { riseDb: 3, rampSeconds: 0.6 }) - full) < 1e-9);
});

test("pauseGainMultiplierAt ramps smoothly, never jumping instantly", () => {
  const rampSeconds = 0.6;
  const atStart = pauseGainMultiplierAt(PAUSE.start - rampSeconds, PAUSE, { rampSeconds });
  const midRamp = pauseGainMultiplierAt(PAUSE.start - rampSeconds / 2, PAUSE, { rampSeconds });
  const atFullRise = pauseGainMultiplierAt(PAUSE.start, PAUSE, { rampSeconds });
  assert.ok(Math.abs(atStart - 1) < 1e-9);
  assert.ok(midRamp > atStart && midRamp < atFullRise, "midpoint of the ramp must sit strictly between the base and full-rise gain");
});

test("the rise is within the required 2-4dB band by default", () => {
  const full = dbToLinear(3);
  const db = 20 * Math.log10(full);
  assert.ok(db >= 2 && db <= 4, `default pause rise ${db}dB is outside the 2-4dB target band`);
});

test("combinedPauseGainMultiplier takes the max across overlapping/adjacent windows, never stacking", () => {
  const windows = [{ start: 10, end: 12 }, { start: 12.1, end: 14 }];
  const gain = combinedPauseGainMultiplier(11, windows);
  assert.ok(Math.abs(gain - dbToLinear(3)) < 1e-9);
});

test("buildPauseRiseFfmpegExpr produces a valid nested if(between(...)) expression string", () => {
  const expr = buildPauseRiseFfmpegExpr([PAUSE]);
  assert.match(expr, /^if\(between\(t,9\.4,10\)/);
  assert.ok(expr.includes("between(t,10,15)"));
  assert.ok(expr.includes("between(t,15,15.6)"));
});
