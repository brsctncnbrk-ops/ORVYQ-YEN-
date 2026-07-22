#!/usr/bin/env node
// buildMusicIntake() -- the one reusable path for adding a licensed music
// track to the canonical registry (music_library/registry.json), used by
// .github/workflows/orvyq-music-intake.yml. This never runs as part of a
// proof or full render -- it is intake/vendoring work that happens before
// production, producing one isolated commit. It never contacts a
// third-party host itself: the caller is responsible for recovering the
// exact source file (from a prior CI artifact, a trusted internal source,
// or an explicit maintenance-only download) and passing its local path in.
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { REPO_ROOT, MUSIC_LIBRARY_DIR, pathExists, parseArgs, printJson, nowIso } from "./lib/fs-utils.mjs";
import { loadMusicRegistry, saveMusicRegistry, findTrack } from "./lib/orvyq-music-registry.mjs";

const exec = promisify(execFile);
const REQUIRED_FIELDS = [
  "trackId", "title", "artist", "sourcePageUrl", "licenseName", "licenseUrl", "attribution", "acquisitionProvenance"
];

async function probe(file) {
  const { stdout } = await exec("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_name,codec_type",
    "-of", "json",
    file
  ]);
  const parsed = JSON.parse(stdout);
  const duration = Number.parseFloat(parsed.format?.duration);
  const audioStream = (parsed.streams || []).find((stream) => stream.codec_type === "audio");
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not determine duration for ${file}`);
  if (!audioStream?.codec_name) throw new Error(`Could not determine audio codec for ${file}`);
  return { duration, codec: audioStream.codec_name };
}

export async function intakeMusicTrack(options) {
  for (const field of REQUIRED_FIELDS) {
    if (!options[field] || typeof options[field] !== "string" || !options[field].trim())
      throw new Error(`Music intake rejected: missing or incomplete required field "${field}" -- incomplete licensing/attribution metadata is not accepted`);
  }
  if (!(await pathExists(options.sourceFile))) throw new Error(`Music intake source file does not exist: ${options.sourceFile}`);

  const bytes = await fs.readFile(options.sourceFile);
  if (bytes.length < 1000) throw new Error(`Music intake source file is unexpectedly small: ${bytes.length} bytes`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (options.expectedSha256 && options.expectedSha256.toLowerCase() !== sha256)
    throw new Error(`Music intake hash mismatch: expected ${options.expectedSha256}, got ${sha256}`);

  const { duration, codec } = await probe(options.sourceFile);
  const ext = path.extname(options.sourceFile) || ".mp3";
  const assetRelativePath = path.join("music_library", "tracks", `${options.trackId}${ext}`);
  const assetAbsPath = path.join(REPO_ROOT, assetRelativePath);
  await fs.mkdir(path.dirname(assetAbsPath), { recursive: true });
  await fs.copyFile(options.sourceFile, assetAbsPath);

  const entry = {
    track_id: options.trackId,
    title: options.title,
    artist: options.artist,
    asset_path: assetRelativePath.split(path.sep).join("/"),
    sha256,
    bytes: bytes.length,
    duration_seconds: Math.round(duration * 1000) / 1000,
    codec,
    source_page_url: options.sourcePageUrl,
    license_name: options.licenseName,
    license_url: options.licenseUrl,
    attribution: options.attribution,
    date_acquired: nowIso(),
    acquisition_provenance: options.acquisitionProvenance,
    approved_for_proof: options.approvedForProof === true || options.approvedForProof === "true",
    approved_for_full: options.approvedForFull === true || options.approvedForFull === "true",
    status: options.status || "approved",
    ...(options.notes ? { notes: options.notes } : {})
  };

  await fs.mkdir(MUSIC_LIBRARY_DIR, { recursive: true });
  const registry = await loadMusicRegistry().catch(() => ({ schema_version: "1.0", tracks: [] }));
  const existing = findTrack(registry, options.trackId);
  if (existing) {
    Object.assign(existing, entry);
  } else {
    registry.tracks.push(entry);
  }
  await saveMusicRegistry(registry);

  return entry;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  intakeMusicTrack({
    sourceFile: args.source,
    trackId: args["track-id"],
    title: args.title,
    artist: args.artist,
    sourcePageUrl: args["source-page-url"],
    licenseName: args["license-name"],
    licenseUrl: args["license-url"],
    attribution: args.attribution,
    acquisitionProvenance: args["acquisition-provenance"],
    approvedForProof: args["approved-for-proof"],
    approvedForFull: args["approved-for-full"],
    status: args.status,
    notes: args.notes,
    expectedSha256: args["expected-sha256"]
  })
    .then((entry) => printJson({ ok: true, ...entry }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
