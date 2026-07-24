// Testable pause-rise envelope for the music bed. Replaces the old
// EDITORIAL_PAUSE_GAIN = 1.02 hard step (a ~0.17dB rise, inaudible, applied
// with an instant on/off -- see docs/canonical-candidate-audit.md section 4)
// with a measurable, ramped rise: task requirement is "roughly 2-4dB above
// the immediately preceding speech-under-bed level, reached with a fade/ramp,
// never an abrupt jump."
//
// computeGainMultiplier() is the single source of truth for the envelope's
// shape -- both the ffmpeg volume expression builder below and
// scripts/orvyq_music_pause_rise_audit.mjs's QA check call it, so the audio
// that actually renders and the QA that verifies it can never independently
// drift apart.
export const DEFAULT_PAUSE_RISE_DB = 3;
export const DEFAULT_PAUSE_RISE_RAMP_SECONDS = 0.6;

export function dbToLinear(db) {
  return 10 ** (db / 20);
}

// Returns the linear multiplier (relative to the section's own
// under_speech_gain baseline of 1.0) that should apply at time `t`, given a
// single pause window {start, end}. Trapezoid shape: linear ramp up over
// `rampSeconds` into the pause, held at the full riseDb rise for the pause's
// real duration, linear ramp back down over `rampSeconds` after it ends.
export function pauseGainMultiplierAt(t, pauseWindow, { riseDb = DEFAULT_PAUSE_RISE_DB, rampSeconds = DEFAULT_PAUSE_RISE_RAMP_SECONDS } = {}) {
  const riseFactor = dbToLinear(riseDb);
  const rampInStart = pauseWindow.start - rampSeconds;
  const rampOutEnd = pauseWindow.end + rampSeconds;
  if (t < rampInStart || t > rampOutEnd) return 1;
  if (t < pauseWindow.start) return 1 + (riseFactor - 1) * ((t - rampInStart) / rampSeconds);
  if (t <= pauseWindow.end) return riseFactor;
  return riseFactor - (riseFactor - 1) * ((t - pauseWindow.end) / rampSeconds);
}

// Combined multiplier across every pause window -- at most one window's
// ramp should ever be active at a given time for real editorial pause
// spacing (pauses are seconds apart at minimum), so taking the max rather
// than summing avoids any double-rise artifact if two ramps ever overlapped.
export function combinedPauseGainMultiplier(t, pauseWindows, options) {
  let gain = 1;
  for (const pauseWindow of pauseWindows) gain = Math.max(gain, pauseGainMultiplierAt(t, pauseWindow, options));
  return gain;
}

// Builds the ffmpeg expression fragment for combinedPauseGainMultiplier,
// nested innermost-first (evaluated as a chain of `between()` guards),
// multiplying onto whatever base section-gain expression it wraps.
export function buildPauseRiseFfmpegExpr(pauseWindows, { riseDb = DEFAULT_PAUSE_RISE_DB, rampSeconds = DEFAULT_PAUSE_RISE_RAMP_SECONDS } = {}) {
  const riseFactor = dbToLinear(riseDb);
  let expression = "1";
  for (const pauseWindow of [...pauseWindows].reverse()) {
    const rampInStart = round(pauseWindow.start - rampSeconds);
    const rampOutEnd = round(pauseWindow.end + rampSeconds);
    const rampUp = `(1+${round(riseFactor - 1)}*(t-${rampInStart})/${rampSeconds})`;
    const rampDown = `(${round(riseFactor)}-${round(riseFactor - 1)}*(t-${pauseWindow.end})/${rampSeconds})`;
    expression =
      `if(between(t,${rampInStart},${pauseWindow.start}),${rampUp},` +
      `if(between(t,${pauseWindow.start},${pauseWindow.end}),${round(riseFactor)},` +
      `if(between(t,${pauseWindow.end},${rampOutEnd}),${rampDown},${expression})))`;
  }
  return expression;
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}
