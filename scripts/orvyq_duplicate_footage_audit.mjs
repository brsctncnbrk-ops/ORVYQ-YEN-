#!/usr/bin/env node
// Duplicate-footage gate (task section 8/19). Reads direction/edit_plan.json's
// real shots -- no separate data model. Enforces:
//   - a stock asset may be used at most twice, ever (hard 3rd-use ban);
//   - a second use requires an explicit reuse_reason on that shot (a
//     deliberate callback, not an unexplained repeat);
//   - two shots on the same asset are one continuous use, not two, only
//     when they are truly contiguous (the earlier shot's trim_out_sec ==
//     the later shot's trim_in_sec) -- the same rule
//     scripts/orvyq_edit_plan.mjs's buildFullPlan already applies when
//     counting max_uses_per_source, kept in sync here rather than
//     reimplemented independently;
//   - a frame-sampled perceptual-hash similarity check across every pair of
//     DIFFERENT footage assets, to catch visually-near-duplicate stock clips
//     even when the file paths differ (best-effort: requires ffmpeg and the
//     real materialized footage files; reports explicitly, and fails rather
//     than silently passing, when either is unavailable).
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projectDir, readJson, writeJsonAtomic, pathExists, parseArgs, printJson } from "./lib/fs-utils.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const HARD_USE_LIMIT = 2;
const exec = promisify(execFile);

// Semantic categories the task specifically calls out as prone to repeated,
// generic stock selection. This is a keyword heuristic over each shot's own
// editorial_purpose/motif text -- a real substitute is a human editor (or a
// vision model with access to the actual frames) confirming true visual
// distinctness; this check exists to catch the cheap, obvious case (the same
// few generic categories carrying most of the film) and reports its own
// limitation rather than claiming to be a full semantic analysis.
const SEMANTIC_CATEGORY_KEYWORDS = {
  office_workers: ["office", "desk", "workstation", "cubicle", "coworker"],
  computer_screens: ["screen", "monitor", "terminal", "dashboard", "typing", "keyboard"],
  finance_screens: ["stock ticker", "trading", "market chart", "finance screen"],
  insurance_or_forms: ["insurance", "form", "paperwork", "document signing", "claim form"],
  parliament_buildings: ["parliament", "capitol", "government building", "legislature"],
  datacenter_or_hangar: ["data center", "datacenter", "server room", "hangar", "warehouse"],
  automobile_or_track: ["race track", "racetrack", "car race", "highway", "runway"]
};
const SEMANTIC_CATEGORY_REPEAT_LIMIT = 3;

function isContiguous(a, b) {
  return a.asset_type === "footage" && b.asset_type === "footage" && a.asset === b.asset && Math.abs(Number(a.trim_out_sec) - Number(b.trim_in_sec)) < 0.02;
}

export function analyzeFootageUsage(shots) {
  const failures = [];
  const warnings = [];
  const usesByAsset = new Map();
  for (let i = 0; i < shots.length; i += 1) {
    const shot = shots[i];
    if (shot.asset_type !== "footage") continue;
    const previous = shots[i - 1];
    if (previous && isContiguous(previous, shot)) continue; // one continuous use, not a new one
    const list = usesByAsset.get(shot.asset) || [];
    list.push(shot);
    usesByAsset.set(shot.asset, list);
  }

  const usage = [];
  for (const [asset, uses] of usesByAsset) {
    usage.push({ asset, use_count: uses.length, shot_ids: uses.map((s) => s.shot_id) });
    if (uses.length > HARD_USE_LIMIT) {
      failures.push(`${asset} is used ${uses.length} times (${uses.map((s) => s.shot_id).join(", ")}) -- the hard limit is ${HARD_USE_LIMIT}`);
      continue;
    }
    if (uses.length === HARD_USE_LIMIT) {
      const second = uses[1];
      if (!second.reuse_reason || !second.reuse_reason.trim()) {
        failures.push(`${asset}'s second use (${second.shot_id}) has no reuse_reason -- a repeated stock asset must carry an explicit, deliberate callback reason`);
      }
    }
  }

  const purposeText = (shot) => `${shot.editorial_purpose || ""} ${shot.motif || ""} ${shot.asset || ""}`.toLowerCase();
  const categoryHits = new Map();
  for (const shot of shots) {
    if (shot.asset_type !== "footage") continue;
    const text = purposeText(shot);
    for (const [category, keywords] of Object.entries(SEMANTIC_CATEGORY_KEYWORDS)) {
      if (keywords.some((keyword) => text.includes(keyword))) {
        const list = categoryHits.get(category) || new Set();
        list.add(shot.asset);
        categoryHits.set(category, list);
      }
    }
  }
  const semanticDensity = {};
  for (const [category, assets] of categoryHits) {
    semanticDensity[category] = assets.size;
    if (assets.size > SEMANTIC_CATEGORY_REPEAT_LIMIT) {
      warnings.push(`semantic category "${category}" appears across ${assets.size} distinct assets -- confirm these are genuinely different footage, not repeated generic stock of the same idea`);
    }
  }

  return { usage, semanticDensity, failures, warnings };
}

async function ffmpegAvailable() {
  try {
    await exec("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

// Best-effort dHash (difference hash) perceptual similarity: extracts one
// representative frame per distinct footage asset (at each asset's own
// FOOTAGE_ASSIGNMENTS trim_in, or its midpoint if unknown), downsamples to a
// tiny greyscale grid via ffmpeg, and compares Hamming distance between
// hashes. Two DIFFERENT source files scoring near-identical is reported as a
// finding for human review -- this never removes or replaces a shot itself.
async function perceptualHashOfFrame(absVideoPath, atSeconds) {
  const { stdout } = await exec("ffmpeg", [
    "-ss", String(Math.max(0, atSeconds)), "-i", absVideoPath, "-frames:v", "1",
    "-vf", "scale=9:8,format=gray", "-f", "rawvideo", "-"
  ], { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
  const bytes = stdout;
  if (bytes.length < 9 * 8) throw new Error(`Could not extract a frame from ${absVideoPath} at ${atSeconds}s`);
  let bits = "";
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const left = bytes[row * 9 + col];
      const right = bytes[row * 9 + col + 1];
      bits += left < right ? "1" : "0";
    }
  }
  return bits;
}

function hammingDistance(a, b) {
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) distance += 1;
  return distance;
}

export async function runDuplicateFootageAudit(projectId = PROJECT_ID, { checkPerceptualSimilarity = true } = {}) {
  const dir = projectDir(projectId);
  const plan = await readJson(path.join(dir, "direction", "edit_plan.json"));
  const { usage, semanticDensity, failures, warnings } = analyzeFootageUsage(plan.shots);

  let perceptualSimilarity = { checked: false, reason: "skipped", pairs: [] };
  if (checkPerceptualSimilarity) {
    const distinctAssets = [...new Set(plan.shots.filter((s) => s.asset_type === "footage").map((s) => s.asset))];
    const available = await ffmpegAvailable();
    if (!available) {
      failures.push("ffmpeg is unavailable -- perceptual footage-similarity check could not run and is reported as a failure, not silently skipped");
      perceptualSimilarity = { checked: false, reason: "ffmpeg_unavailable", pairs: [] };
    } else {
      const missing = [];
      const hashes = new Map();
      for (const asset of distinctAssets) {
        const absPath = path.join(dir, asset);
        if (!(await pathExists(absPath))) {
          missing.push(asset);
          continue;
        }
        const firstShot = plan.shots.find((s) => s.asset_type === "footage" && s.asset === asset);
        const at = Number(firstShot?.trim_in_sec || 0) + 0.2;
        hashes.set(asset, await perceptualHashOfFrame(absPath, at));
      }
      if (missing.length) {
        failures.push(`${missing.length} footage asset(s) are not materialized on disk -- perceptual similarity could not be checked for: ${missing.join(", ")}`);
      }
      const pairs = [];
      const assets = [...hashes.keys()];
      for (let i = 0; i < assets.length; i += 1) {
        for (let j = i + 1; j < assets.length; j += 1) {
          const distance = hammingDistance(hashes.get(assets[i]), hashes.get(assets[j]));
          if (distance <= 6) pairs.push({ a: assets[i], b: assets[j], hamming_distance: distance });
        }
      }
      if (pairs.length) warnings.push(`${pairs.length} pair(s) of different footage files scored visually near-identical (Hamming distance <= 6) -- confirm these are genuinely distinct footage: ${JSON.stringify(pairs)}`);
      perceptualSimilarity = { checked: true, reason: missing.length ? "partial_missing_assets" : "ok", pairs };
    }
  }

  const report = {
    schema_version: "1.0-canonical",
    project_id: projectId,
    hard_use_limit: HARD_USE_LIMIT,
    usage,
    semantic_category_density: semanticDensity,
    perceptual_similarity: perceptualSimilarity,
    warnings,
    failures,
    pass: failures.length === 0
  };
  await writeJsonAtomic(path.join(dir, "qa", "duplicate_footage_audit.json"), report);
  if (!report.pass) throw new Error(`ORVYQ duplicate footage audit failed: ${failures.join("; ")}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  runDuplicateFootageAudit(args["project-id"] || PROJECT_ID, { checkPerceptualSimilarity: !args["skip-perceptual"] })
    .then((report) => printJson({ ok: true, ...report }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
