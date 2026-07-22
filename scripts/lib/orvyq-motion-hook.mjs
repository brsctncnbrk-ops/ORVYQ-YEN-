// Validates the opening motion-video hook of the canonical timeline.
//
// Deliberate fix vs the golden source (see docs/source-audit.md section 7,
// finding 4 / docs/migration-plan.md section 1): the golden
// `auditMotionHook()` only ran its real checks when `plan.preview === true`,
// trivially passing for "full" plans. That was wrong -- the opening hook is
// the cold open of the CANONICAL TIMELINE, not a proof-only concern; a full
// render that dropped or broke the hook should fail this audit exactly like
// a proof render would. This version always validates against `plan.shots`,
// regardless of `plan.mode`.

const DEFAULT_MIN_SECONDS = 10;
const DEFAULT_MAX_SECONDS = 14;

export function auditMotionHook(plan, options = {}) {
  const fps = Number(plan.fps || 30);
  const minimumSeconds = Number(
    options.minimumSeconds || plan.quality_policy?.motion_hook_min_seconds || DEFAULT_MIN_SECONDS
  );
  const maximumSeconds = Number(
    options.maximumSeconds || plan.quality_policy?.motion_hook_max_seconds || DEFAULT_MAX_SECONDS
  );
  const shots = Array.isArray(plan.shots) ? plan.shots : [];
  const failures = [];
  const hookShots = shots.filter((shot) => shot.hook_footage === true);
  const footageShots = shots.filter((shot) => shot.asset_type === "footage");
  const allowsContextualBodyFootage = plan.quality_policy?.cinematic_body_footage === true;

  if (!hookShots.length) failures.push("Timeline requires a 10-14 second motion-video hook");
  if (
    footageShots.some(
      (shot) =>
        shot.hook_footage !== true &&
        !(allowsContextualBodyFootage && shot.contextual_footage === true && shot.provenance_mode === "approved_contextual_footage")
    )
  )
    failures.push("Footage is allowed only inside the approved opening hook (or as approved contextual body footage)");

  const firstNonHookIndex = shots.findIndex((shot) => shot.hook_footage !== true);
  const openingCount = firstNonHookIndex === -1 ? shots.length : firstNonHookIndex;
  const openingShots = shots.slice(0, openingCount);
  if (
    openingShots.length !== hookShots.length ||
    openingShots.some((shot) => shot.asset_type !== "footage" || shot.hook_footage !== true)
  ) {
    failures.push("Motion-hook footage must be one contiguous block at the start of the timeline");
  }

  const startFrame = hookShots.at(0)?.start_frame ?? 0;
  const endFrame = hookShots.at(-1)?.end_frame ?? 0;
  const durationSeconds = (endFrame - startFrame) / fps;
  if (startFrame !== 0) failures.push("Motion hook must start on frame 0");
  if (durationSeconds < minimumSeconds - 0.001 || durationSeconds > maximumSeconds + 0.001) {
    failures.push(`Motion hook must last ${minimumSeconds}-${maximumSeconds}s; got ${durationSeconds.toFixed(2)}s`);
  }

  for (let index = 0; index < hookShots.length; index += 1) {
    const shot = hookShots[index];
    if (!shot.video_asset || !Number.isFinite(shot.trim_in_sec) || !Number.isFinite(shot.trim_out_sec)) {
      failures.push(`${shot.shot_id} lacks a complete footage trim`);
    }
    if (index > 0 && shot.start_frame !== hookShots[index - 1].end_frame) {
      failures.push(`${shot.shot_id} breaks hook continuity`);
    }
  }

  const uniqueAssets = new Set(hookShots.map((shot) => shot.video_asset));
  if (uniqueAssets.size !== hookShots.length) failures.push("Motion hook must not repeat a footage asset");

  const firstBodyShot = shots[openingCount];
  if (!firstBodyShot || firstBodyShot.asset_type !== "evidence")
    failures.push("The first post-hook shot must be primary evidence");
  if (firstBodyShot && firstBodyShot.transition_in !== "dissolve")
    failures.push("The hook must dissolve directly into the first primary document");

  return {
    required: true,
    pass: failures.length === 0,
    duration_seconds: durationSeconds,
    shot_count: hookShots.length,
    footage_count: footageShots.length,
    first_evidence_frame: firstBodyShot?.start_frame ?? null,
    failures
  };
}
