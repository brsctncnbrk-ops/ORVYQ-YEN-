#!/usr/bin/env node
// Post-render brightness-drop repair: re-encodes around isolated corrupted
// frames. Mode-agnostic, ported near-verbatim -- this is a hard render-time
// gate in both proof and full CI workflows, not a proof-only patch (see
// docs/source-audit.md section 6, which flags the golden repo's framing of
// this as "proof-only debris"; the repair QA step itself is legitimate and
// belongs in both workflows).
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs, projectDir, writeJsonAtomic } from "./lib/fs-utils.mjs";
import { detectTransientBrightnessDrops, parseLumaSamples } from "./orvyq_media_qa.mjs";

const exec = promisify(execFile);
const FPS = 30;

async function command(binary, args) {
  try {
    return await exec(binary, args, { maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`${binary} failed: ${error.stderr || error.message}`);
  }
}

async function scan(video) {
  const { stdout, stderr } = await command("ffmpeg", ["-hide_banner", "-nostats", "-i", video, "-an", "-vf", `fps=${FPS},signalstats,metadata=print:key=lavfi.signalstats.YAVG`, "-f", "null", "-"]);
  const samples = parseLumaSamples(`${stdout}\n${stderr}`);
  const duration = samples.at(-1)?.time + 1 / FPS || 0;
  return { samples: samples.length, duration, drops: detectTransientBrightnessDrops(samples, duration, { sampleInterval: 1 / FPS }) };
}

function frameRanges(drops) {
  const paddingFrames = 2;
  const padded = drops.map((drop) => {
    const first = Math.max(1, Math.round(drop.start * FPS) - paddingFrames);
    const last = Math.max(first, Math.round(drop.end * FPS) - 1 + paddingFrames);
    return { first, last };
  });
  const merged = [];
  for (const range of padded) {
    const previous = merged.at(-1);
    if (previous && range.first <= previous.last + 1) previous.last = Math.max(previous.last, range.last);
    else merged.push({ ...range });
  }
  return merged.map(({ first, last }) => ({ first, last, replace: first - 1 }));
}

export async function repairBrightnessDrops({ projectId, video, reportPath }) {
  const before = await scan(video);
  const ranges = frameRanges(before.drops);
  let repaired = false;
  if (ranges.length) {
    const extension = path.extname(video);
    const temporary = `${video.slice(0, -extension.length)}.brightness-repaired${extension}`;
    const rejectedFrames = ranges.map(({ first, last }) => `between(n\\,${first}\\,${last})`).join("+");
    const filter = `select=not(${rejectedFrames}),fps=${FPS}`;
    await command("ffmpeg", ["-hide_banner", "-nostats", "-y", "-i", video, "-vf", filter, "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", temporary]);
    await fs.rename(temporary, video);
    repaired = true;
  }

  const after = repaired ? await scan(video) : before;
  const report = {
    schema_version: "1.0-canonical",
    project_id: projectId,
    video: path.basename(video),
    fps: FPS,
    repaired,
    repaired_ranges: ranges,
    before: { sample_count: before.samples, transient_brightness_drops: before.drops },
    after: { sample_count: after.samples, transient_brightness_drops: after.drops },
    pass: after.drops.length === 0
  };
  await writeJsonAtomic(reportPath, report);
  if (!report.pass) throw new Error(`Brightness repair left ${after.drops.length} transient drops`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args["project-id"];
  const video = args.video;
  if (!projectId || !video) {
    console.error("Usage: node scripts/orvyq_brightness_repair.mjs --project-id <id> --video <path> [--report <path>]");
    process.exitCode = 1;
  } else {
    const reportPath = args.report || path.join(projectDir(projectId), "qa", "orvyq_brightness_repair.json");
    repairBrightnessDrops({ projectId, video, reportPath })
      .then((report) => console.log(JSON.stringify({ ok: true, ...report })))
      .catch((error) => {
        console.error(JSON.stringify({ ok: false, error: error.message }));
        process.exitCode = 1;
      });
  }
}
