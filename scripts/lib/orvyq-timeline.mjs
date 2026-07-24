// resolveCandidateTimeline() -- the single source of truth for the canonical
// candidate's overall duration. Every consumer that needs to know "how long
// is this film" (the audio mix's target output duration, caption frame caps,
// QA expected-duration checks, review/final render selection) must call this
// instead of independently summing narration + pauses + hook + end-card --
// see docs/canonical-candidate-audit.md sections 5/5b for the two real,
// confirmed duration-accounting bugs (missing end-card padding, missing
// motion-hook leading silence) this replaces.
//
// The film's real total is: [motion hook][paused narration timeline][end card].
// direction/editorial_blueprint.json.full_production.generated_total_duration_seconds
// (written by scripts/orvyq_full_production_plan.mjs's writeFullProductionPlan(),
// via buildFullProductionPlan()'s own totalDuration + hookDuration + END_CARD_SECONDS)
// already IS that real total -- this module does not recompute it, it just
// gives every other script one place to read it from, plus the hook/end-card
// split a caller needs to place leading/trailing silence correctly.
import path from "node:path";
import { projectDir, readJson } from "./fs-utils.mjs";

export const FPS = 30;

// A short closing hold after the last narrated word and its final editorial
// pause -- a terminal title card, not a claim beat. Single canonical
// definition; scripts/orvyq_full_production_plan.mjs imports this rather
// than declaring its own copy.
export const END_CARD_SECONDS = 4;

// Minimum natural fade-out held at the very end of the film (task section 13):
// the last END_CARD_FADE_SECONDS of the mix must be a controlled release, not
// an abrupt cut. Distinct from END_CARD_SECONDS itself since the fade can (and
// should) begin slightly before the end card's own start, overlapping the
// final narration pause's release.
export const END_CARD_FADE_SECONDS = 5;

export async function resolveMotionHookDuration(dir) {
  const motionHook = await readJson(path.join(dir, "direction", "motion_hook.json"));
  const duration = (motionHook.shots || []).reduce((sum, shot) => sum + Number(shot.duration || 0), 0);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("direction/motion_hook.json has no usable shot durations");
  return duration;
}

// Reads the one already-computed canonical total (see file header). Throws
// loudly if orvyq_full_production_plan.mjs has not been run yet -- there is
// no independent fallback computation here, by design: a second, possibly
// divergent way to compute this number is exactly the bug this module exists
// to prevent.
export async function resolveCandidateTimeline(projectId) {
  const dir = projectDir(projectId);
  const [blueprint, hookDuration] = await Promise.all([
    readJson(path.join(dir, "direction", "editorial_blueprint.json")),
    resolveMotionHookDuration(dir)
  ]);
  const totalSeconds = Number(blueprint.full_production?.generated_total_duration_seconds);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0)
    throw new Error(
      "editorial_blueprint.json.full_production.generated_total_duration_seconds is missing or invalid -- " +
        "run scripts/orvyq_full_production_plan.mjs before resolving the candidate timeline"
    );
  const narrationAndPauseSeconds = Math.round((totalSeconds - hookDuration - END_CARD_SECONDS) * 1000) / 1000;
  if (narrationAndPauseSeconds <= 0)
    throw new Error(`Canonical total ${totalSeconds}s is not large enough to contain the motion hook (${hookDuration}s) + end card (${END_CARD_SECONDS}s)`);
  return {
    fps: FPS,
    hook_duration_seconds: Math.round(hookDuration * 1000) / 1000,
    narration_and_pause_seconds: narrationAndPauseSeconds,
    end_card_seconds: END_CARD_SECONDS,
    candidate_duration_seconds: Math.round(totalSeconds * 1000) / 1000,
    candidate_duration_frames: Math.round(totalSeconds * FPS)
  };
}
