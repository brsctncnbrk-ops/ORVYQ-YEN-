#!/usr/bin/env node
// Tension/emphasis-card gate (task section 9/19). Reads direction/edit_plan.json's
// real shots -- no separate data model. Section-title and end-card graphics
// are structural (not emphasis beats) and are excluded from the emphasis-card
// budget itself, but title uniqueness still applies to them.
import path from "node:path";
import { projectDir, readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const MAX_TOTAL_EMPHASIS_SECONDS = 50;
const TYPICAL_MIN_SECONDS = 2.5;
const TYPICAL_MAX_SECONDS = 4.5;
const EXCEPTION_THRESHOLD_SECONDS = 6;
// "claim_recap_card" (scripts/orvyq_full_production_plan.mjs's
// GRAPHIC_BREAK_ASSIGNMENTS) is an ordinary, narration-synced claim slice
// rendered as a graphic instead of footage or evidence -- it exists to
// break up an evidence run or recover footage-fraction budget, not as a
// pause-driven editorial emphasis beat, so it is structural the same way a
// section title is: its own duration is set by real narration timing, not
// authored to the 2.5-4.5s emphasis-card band, and it must not count
// against the emphasis-card time/duration budget below.
const STRUCTURAL_GRAPHIC_TYPES = new Set(["section_title", "end_card", "claim_recap_card"]);

function shotDuration(shot, fps) {
  return (shot.end_frame - shot.start_frame) / fps;
}

function shotTitle(shot) {
  return shot.graphic?.title || shot.emphasis_card?.title || null;
}

// A shot is an "emphasis beat" if it carries an emphasis_card (a pause-driven
// text overlay, whether on footage or a graphic card) or is a non-structural
// graphic (a full-screen card that isn't a section title or the terminal end
// card).
function isEmphasisBeat(shot) {
  if (shot.emphasis_card) return true;
  if (shot.asset_type === "graphic" && !STRUCTURAL_GRAPHIC_TYPES.has(shot.graphic?.type)) return true;
  return false;
}

export function auditTensionCards(shots, fps) {
  const failures = [];
  const warnings = [];
  const emphasisBeats = shots.filter(isEmphasisBeat).map((shot) => ({ shot_id: shot.shot_id, title: shotTitle(shot), duration: shotDuration(shot, fps) }));

  const totalSeconds = emphasisBeats.reduce((sum, beat) => sum + beat.duration, 0);
  if (totalSeconds > MAX_TOTAL_EMPHASIS_SECONDS) {
    failures.push(`emphasis/tension cards total ${totalSeconds.toFixed(1)}s, exceeding the ${MAX_TOTAL_EMPHASIS_SECONDS}s cap`);
  }

  for (const beat of emphasisBeats) {
    if (beat.duration > EXCEPTION_THRESHOLD_SECONDS) {
      failures.push(`${beat.shot_id} ("${beat.title}") lasts ${beat.duration.toFixed(1)}s, over the ${EXCEPTION_THRESHOLD_SECONDS}s exception threshold, with no justification mechanism recorded`);
    } else if (beat.duration < TYPICAL_MIN_SECONDS || beat.duration > TYPICAL_MAX_SECONDS) {
      warnings.push(`${beat.shot_id} ("${beat.title}") is ${beat.duration.toFixed(1)}s, outside the typical ${TYPICAL_MIN_SECONDS}-${TYPICAL_MAX_SECONDS}s band`);
    }
  }

  // Title uniqueness across every carded/titled shot in the film, not just
  // emphasis beats -- a repeated section title would be equally suspicious.
  const titledShots = shots.filter((shot) => shotTitle(shot));
  const seenTitles = new Map();
  for (const shot of titledShots) {
    const title = shotTitle(shot).trim().toLowerCase();
    if (seenTitles.has(title)) {
      failures.push(`title "${shotTitle(shot)}" is reused by both ${seenTitles.get(title)} and ${shot.shot_id} -- the same card title/idea cannot be repeated`);
    } else {
      seenTitles.set(title, shot.shot_id);
    }
  }

  return {
    emphasis_beat_count: emphasisBeats.length,
    emphasis_total_seconds: Math.round(totalSeconds * 1000) / 1000,
    emphasis_beats: emphasisBeats,
    failures,
    warnings
  };
}

export async function runTensionCardAudit(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const plan = await readJson(path.join(dir, "direction", "edit_plan.json"));
  const result = auditTensionCards(plan.shots, plan.fps);
  const report = {
    schema_version: "1.0-canonical",
    project_id: projectId,
    max_total_emphasis_seconds: MAX_TOTAL_EMPHASIS_SECONDS,
    typical_band_seconds: [TYPICAL_MIN_SECONDS, TYPICAL_MAX_SECONDS],
    exception_threshold_seconds: EXCEPTION_THRESHOLD_SECONDS,
    ...result,
    pass: result.failures.length === 0
  };
  await writeJsonAtomic(path.join(dir, "qa", "tension_card_audit.json"), report);
  if (!report.pass) throw new Error(`ORVYQ tension card audit failed: ${result.failures.join("; ")}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  runTensionCardAudit(args["project-id"] || PROJECT_ID)
    .then((report) => printJson({ ok: true, ...report }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
