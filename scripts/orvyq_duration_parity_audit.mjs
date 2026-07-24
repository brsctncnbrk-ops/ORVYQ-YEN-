#!/usr/bin/env node
// Enforces task section 5's hard rule: candidate video duration == final_mix
// duration, tolerance at most 3 frames or ~0.1s (whichever is looser). Both
// sides are read from already-generated canonical outputs -- direction/
// edit_plan.json (video) and assets/audio/final_mix.metadata.json (audio) --
// neither is recomputed independently here; this only compares them.
import path from "node:path";
import { projectDir, readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const MAX_FRAME_TOLERANCE = 3;
const MAX_SECONDS_TOLERANCE = 0.1;

export function checkDurationParity({ videoDurationFrames, fps, audioDurationSeconds }) {
  const videoDurationSeconds = videoDurationFrames / fps;
  const diffSeconds = Math.abs(videoDurationSeconds - audioDurationSeconds);
  const diffFrames = diffSeconds * fps;
  const tolerance = Math.max(MAX_FRAME_TOLERANCE / fps, MAX_SECONDS_TOLERANCE);
  const failures = [];
  if (diffSeconds > tolerance) {
    failures.push(
      `candidate video duration ${videoDurationSeconds.toFixed(3)}s (${videoDurationFrames} frames) and final_mix duration ${audioDurationSeconds.toFixed(3)}s differ by ${diffSeconds.toFixed(3)}s ` +
        `(${diffFrames.toFixed(1)} frames), exceeding the ${MAX_FRAME_TOLERANCE}-frame / ${MAX_SECONDS_TOLERANCE}s tolerance`
    );
  }
  return { video_duration_seconds: videoDurationSeconds, audio_duration_seconds: audioDurationSeconds, diff_seconds: diffSeconds, diff_frames: diffFrames, tolerance_seconds: tolerance, failures };
}

export async function runDurationParityAudit(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const [plan, audioMetadata] = await Promise.all([
    readJson(path.join(dir, "direction", "edit_plan.json")),
    readJson(path.join(dir, "assets", "audio", "final_mix.metadata.json"))
  ]);
  const result = checkDurationParity({ videoDurationFrames: plan.duration_frames, fps: plan.fps, audioDurationSeconds: Number(audioMetadata.duration_seconds) });
  const report = { schema_version: "1.0-canonical", project_id: projectId, ...result, pass: result.failures.length === 0 };
  await writeJsonAtomic(path.join(dir, "qa", "duration_parity_audit.json"), report);
  if (!report.pass) throw new Error(`ORVYQ duration parity audit failed: ${result.failures.join("; ")}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  runDurationParityAudit(args["project-id"] || PROJECT_ID)
    .then((report) => printJson({ ok: true, ...report }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
