#!/usr/bin/env node
// Near-black / dark-empty-card gate (task section 9/19). Runs ffmpeg
// blackdetect against the actual rendered video -- there is no shortcut via
// edit_plan.json alone, since "near-black" is a real pixel-brightness
// property of the rendered frames, not something the plan can guarantee by
// construction. Fails explicitly (never silently passes) when ffmpeg or the
// video file is unavailable.
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projectDir, pathExists, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const MAX_NONTERMINAL_SECONDS = 1.0;
const TERMINAL_WINDOW_SECONDS = 1.5; // matches orvyq_media_qa.mjs's own terminal-fade exemption window

const exec = promisify(execFile);
async function command(binary, args) {
  try {
    return await exec(binary, args, { maxBuffer: 24 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`${binary} failed: ${error.stderr || error.message}`);
  }
}
function parseBlack(text) {
  return [...text.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g)].map((match) => ({
    start: Number(match[1]),
    end: Number(match[2]),
    duration: Number(match[3])
  }));
}
async function durationSeconds(video) {
  const { stdout } = await command("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", video]);
  const value = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid video duration for ${video}`);
  return value;
}

// Pure classification, unit-testable without ffmpeg: given already-detected
// black segments and the video's total duration, decides which are the
// allowed terminal fade and which are hard failures.
export function classifyBlackSegments(blackSegments, totalDurationSeconds, { maxNonterminalSeconds = MAX_NONTERMINAL_SECONDS, terminalWindowSeconds = TERMINAL_WINDOW_SECONDS } = {}) {
  const terminal = [];
  const nonTerminalViolations = [];
  const nonTerminalWithinLimit = [];
  for (const segment of blackSegments) {
    const isTerminal = segment.end >= totalDurationSeconds - terminalWindowSeconds;
    if (isTerminal) {
      terminal.push(segment);
      continue;
    }
    if (segment.duration > maxNonterminalSeconds) nonTerminalViolations.push(segment);
    else nonTerminalWithinLimit.push(segment);
  }
  return {
    segment_count: blackSegments.length,
    total_seconds: Math.round(blackSegments.reduce((sum, s) => sum + s.duration, 0) * 1000) / 1000,
    terminal_segments: terminal,
    nonterminal_segments_within_limit: nonTerminalWithinLimit,
    nonterminal_violations: nonTerminalViolations
  };
}

export async function runNearBlackAudit({ projectId = PROJECT_ID, video, reportPath } = {}) {
  const dir = projectDir(projectId);
  const finalReportPath = reportPath || path.join(dir, "qa", "near_black_audit.json");
  const failures = [];

  if (!video || !(await pathExists(video))) {
    const report = { schema_version: "1.0-canonical", project_id: projectId, checked: false, failures: [`Video file not found: ${video || "(none provided)"}`], pass: false };
    await writeJsonAtomic(finalReportPath, report);
    throw new Error(report.failures[0]);
  }

  let ffmpegOk = true;
  try {
    await exec("ffmpeg", ["-version"]);
  } catch {
    ffmpegOk = false;
  }
  if (!ffmpegOk) {
    const report = { schema_version: "1.0-canonical", project_id: projectId, checked: false, failures: ["ffmpeg is unavailable -- near-black detection could not run"], pass: false };
    await writeJsonAtomic(finalReportPath, report);
    throw new Error(report.failures[0]);
  }

  const totalDuration = await durationSeconds(video);
  const detect = await command("ffmpeg", ["-hide_banner", "-nostats", "-i", video, "-an", "-vf", "blackdetect=d=0.3:pix_th=0.08:pic_th=0.98", "-f", "null", "-"]);
  const blackSegments = parseBlack(`${detect.stdout}\n${detect.stderr}`);
  const classification = classifyBlackSegments(blackSegments, totalDuration);

  if (classification.nonterminal_violations.length) {
    failures.push(`${classification.nonterminal_violations.length} non-terminal near-black segment(s) exceed ${MAX_NONTERMINAL_SECONDS}s: ${JSON.stringify(classification.nonterminal_violations)}`);
  }

  const report = { schema_version: "1.0-canonical", project_id: projectId, checked: true, total_duration_seconds: totalDuration, ...classification, failures, pass: failures.length === 0 };
  await writeJsonAtomic(finalReportPath, report);
  if (!report.pass) throw new Error(`ORVYQ near-black audit failed: ${failures.join("; ")}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  runNearBlackAudit({ projectId: args["project-id"] || PROJECT_ID, video: args.video, reportPath: args.report })
    .then((report) => printJson({ ok: true, ...report }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
