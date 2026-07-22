#!/usr/bin/env node
// Fetches and verifies the approved licensed music bed.
//
// Renamed from the golden repo's orvyq_fetch_proof_music.mjs: the golden
// version hardcoded a `duration < 150` floor directly into its download
// verification (docs/source-audit.md section 7), which would have rejected
// a shorter proof and said nothing useful about a longer one. This version
// takes an explicit `minDurationSeconds` instead, defaulting to the
// canonical proof length so today's behavior is unchanged.
//
// This still only knows how to fetch ONE fixed track (Scott Buckley,
// "Signal to Noise", CC BY 4.0) -- the same single-source limitation flagged
// in docs/migration-plan.md section 5, risk 2. A real full-length render
// will likely need a longer or additional licensed bed; that is full-film
// content-sourcing work blocked on Phase 6 human approval, not something to
// invent here.
import path from "node:path";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projectDir, writeJsonAtomic, parseArgs } from "./lib/fs-utils.mjs";

const exec = promisify(execFile);
const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const DEFAULT_MIN_DURATION_SECONDS = 150;
const SOURCE_PAGE = "https://www.scottbuckley.com.au/library/signal-to-noise/";
const DOWNLOAD_URL = "https://www.scottbuckley.com.au/library/wp-content/uploads/2020/04/sb_signaltonoise.mp3";
const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
const ATTRIBUTION = "'Signal to Noise' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au";

async function durationSeconds(file, minDurationSeconds) {
  const { stdout } = await exec("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=nk=1:nw=1", file
  ]);
  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration < minDurationSeconds)
    throw new Error(`Approved music must cover the target duration without looping; need >= ${minDurationSeconds}s, got ${duration}s`);
  return duration;
}

export async function fetchApprovedMusic(projectId = PROJECT_ID, { minDurationSeconds = DEFAULT_MIN_DURATION_SECONDS } = {}) {
  const dir = projectDir(projectId);
  const musicDir = path.join(dir, "assets", "music");
  const output = path.join(musicDir, "approved_bed.mp3");
  const temporary = `${output}.download`;
  await fs.mkdir(musicDir, { recursive: true });
  const response = await fetch(DOWNLOAD_URL, {
    redirect: "follow",
    headers: {
      "User-Agent": "ORVYQ documentary renderer/1.0",
      Referer: SOURCE_PAGE,
      Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.5"
    }
  });
  if (!response.ok) throw new Error(`Music download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 100_000) throw new Error(`Music download is unexpectedly small: ${bytes.length} bytes`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const expectedSha = process.env.ORVYQ_APPROVED_MUSIC_SHA256?.trim().toLowerCase();
  if (expectedSha && sha256 !== expectedSha) throw new Error(`Approved music hash mismatch: ${sha256}`);
  await fs.writeFile(temporary, bytes);
  await fs.rename(temporary, output);
  const duration = await durationSeconds(output, minDurationSeconds);
  const provenance = {
    schema_version: "1.0",
    asset: "assets/music/approved_bed.mp3",
    title: "Signal to Noise",
    composer: "Scott Buckley",
    source_page_url: SOURCE_PAGE,
    download_url: DOWNLOAD_URL,
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    license_url: LICENSE_URL,
    attribution: ATTRIBUTION,
    approved_for_final_edit: true,
    sha256,
    bytes: bytes.length,
    duration_seconds: Math.round(duration * 1000) / 1000,
    fetched_at: new Date().toISOString(),
    reproducibility: expectedSha ? "sha256_pinned" : "runtime_sha256_recorded"
  };
  await writeJsonAtomic(path.join(musicDir, "approved_bed.provenance.json"), provenance);
  return provenance;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const minDurationSeconds = args["min-duration-seconds"] ? Number.parseFloat(args["min-duration-seconds"]) : DEFAULT_MIN_DURATION_SECONDS;
  fetchApprovedMusic(args["project-id"] || PROJECT_ID, { minDurationSeconds })
    .then((result) => console.log(JSON.stringify({ ok: true, ...result })))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
