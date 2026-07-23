#!/usr/bin/env node
// Downloads and vendors the nine real, official, per-cue Scott Buckley
// (CC BY 4.0) tracks direction/music_cue_sheet.json's full_cues assign --
// one call per track into scripts/orvyq_music_intake.mjs's
// intakeMusicTrack(), the same reusable canonical-registry intake path
// already used for the proof track (see music_library/registry.json's
// sb_signal_to_noise entry). Only ever run from
// .github/workflows/orvyq-music-acquisition.yml, a GitHub-hosted Actions
// runner with real network access -- never from a render workflow, and this
// script never renders video or touches the edit plan.
//
// For each track this: downloads the exact official mp3 URL (bounded
// retry), saves a retained, hash-verifiable snapshot of its official
// license/source page, computes sha256 + byte size, probes codec/sample
// rate/channels/duration via ffprobe, then runs intakeMusicTrack() (which
// itself re-verifies the hash, re-probes duration/codec, copies the file
// into music_library/tracks/, and upserts the registry entry). One track
// per cue -- see docs/full-production-guide.md -- not a single shared bed.
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { REPO_ROOT, projectDir, readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { intakeMusicTrack } from "./orvyq_music_intake.mjs";
import { downloadWithRetry } from "./orvyq_fetch_music.mjs";

const exec = promisify(execFile);
const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
const LICENSE_NAME = "Creative Commons Attribution 4.0 International (CC BY 4.0)";
const ARTIST = "Scott Buckley";
const LICENSE_SNAPSHOT_DIR = path.join(REPO_ROOT, "music_library", "license_snapshots");

// The initial editorial assignment -- one cue, one official track, verbatim
// per the task's own mapping. Real audio dynamics are validated against
// narration at the audio-mix/QA stage (scripts/orvyq_audio_mix.mjs,
// scripts/orvyq_music_cue_audit.mjs); only a section-level adjustment would
// ever be made here if a track's actual dynamics genuinely conflicted, not a
// change of track.
export const FULL_MUSIC_TRACKS = [
  {
    cueId: "CUE_01_RACE_PARADOX",
    trackId: "sb_intervention_nomelody",
    title: "Intervention (No Piano Melody)",
    sourcePageUrl: "https://www.scottbuckley.com.au/library/intervention/",
    downloadUrl: "https://www.scottbuckley.com.au/library/wp-content/uploads/2019/01/sb_intervention_nomelody.mp3"
  },
  {
    cueId: "CUE_02_CONTROLLED_EVIDENCE",
    trackId: "sb_signal_to_noise_nomelody",
    title: "Signal to Noise (No Piano Melody)",
    sourcePageUrl: "https://www.scottbuckley.com.au/library/signal-to-noise/",
    downloadUrl: "https://www.scottbuckley.com.au/library/wp-content/uploads/2020/04/sb_signaltonoise_nomelody.mp3"
  },
  {
    cueId: "CUE_03_INCENTIVE_RACE",
    trackId: "sb_catalyst",
    title: "Catalyst",
    sourcePageUrl: "https://www.scottbuckley.com.au/library/catalyst/",
    downloadUrl: "https://www.scottbuckley.com.au/library/wp-content/uploads/2020/06/sb_catalyst.mp3"
  },
  {
    cueId: "CUE_04_REAL_WORLD_MISUSE",
    trackId: "sb_emergent",
    title: "Emergent",
    sourcePageUrl: "https://www.scottbuckley.com.au/library/emergent/",
    downloadUrl: "https://www.scottbuckley.com.au/library/wp-content/uploads/2019/11/sb_emergent.mp3"
  },
  {
    cueId: "CUE_05_WORK_CONCENTRATION",
    trackId: "sb_undertow",
    title: "Undertow",
    sourcePageUrl: "https://www.scottbuckley.com.au/library/undertow/",
    downloadUrl: "https://www.scottbuckley.com.au/library/wp-content/uploads/2019/12/sb_undertow.mp3"
  },
  {
    cueId: "CUE_06_REGULATION_PARADOX",
    trackId: "sb_signal_to_noise",
    title: "Signal to Noise",
    sourcePageUrl: "https://www.scottbuckley.com.au/library/signal-to-noise/",
    downloadUrl: "https://www.scottbuckley.com.au/library/wp-content/uploads/2020/04/sb_signaltonoise.mp3"
    // Already vendored and hash-verified by an earlier intake as the proof
    // track (music_library/registry.json's sb_signal_to_noise entry). This
    // run re-downloads and re-verifies it anyway -- intakeMusicTrack()
    // upserts by track_id, so a matching hash just re-confirms the same
    // official bytes and flips approved_for_full to true (it was already
    // false-only for proof); it does not create a duplicate registry entry.
  },
  {
    cueId: "CUE_07_OPEN_CLOSED",
    trackId: "sb_ephemera",
    title: "Ephemera",
    sourcePageUrl: "https://www.scottbuckley.com.au/library/ephemera/",
    downloadUrl: "https://www.scottbuckley.com.au/library/wp-content/uploads/2020/03/sb_ephemera.mp3"
  },
  {
    cueId: "CUE_08_SAFETY_ARCHITECTURE",
    trackId: "sb_horizons",
    title: "Horizons",
    sourcePageUrl: "https://www.scottbuckley.com.au/library/horizons/",
    downloadUrl: "https://www.scottbuckley.com.au/library/wp-content/uploads/2020/02/sb_horizons.mp3"
  },
  {
    cueId: "CUE_09_FINAL_PARADOX",
    trackId: "sb_solace",
    title: "Solace",
    sourcePageUrl: "https://www.scottbuckley.com.au/library/solace/",
    downloadUrl: "https://www.scottbuckley.com.au/library/wp-content/uploads/2020/05/sb_solace.mp3"
  }
];

export function attributionFor(title) {
  return `'${title}' by Scott Buckley — released under CC-BY 4.0. www.scottbuckley.com.au`;
}

async function probe(file) {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,codec_type,sample_rate,channels", "-of", "json", file]);
  const parsed = JSON.parse(stdout);
  const duration = Number.parseFloat(parsed.format?.duration);
  const audioStream = (parsed.streams || []).find((stream) => stream.codec_type === "audio");
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not determine duration for ${file}`);
  if (!audioStream?.codec_name) throw new Error(`Could not determine audio codec for ${file}`);
  return { duration, codec: audioStream.codec_name, sampleRate: Number(audioStream.sample_rate) || null, channels: Number(audioStream.channels) || null };
}

async function snapshotLicensePage(track) {
  await mkdir(LICENSE_SNAPSHOT_DIR, { recursive: true });
  const bytes = await downloadWithRetry(track.sourcePageUrl, { redirect: "follow", headers: { "User-Agent": "ORVYQ documentary renderer/1.0", Accept: "text/html" } });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const htmlPath = path.join(LICENSE_SNAPSHOT_DIR, `${track.trackId}.page.html`);
  await writeFile(htmlPath, bytes);
  const record = {
    track_id: track.trackId,
    source_page_url: track.sourcePageUrl,
    snapshot_path: path.relative(REPO_ROOT, htmlPath).split(path.sep).join("/"),
    sha256,
    bytes: bytes.length,
    captured_at: new Date().toISOString()
  };
  await writeJsonAtomic(path.join(LICENSE_SNAPSHOT_DIR, `${track.trackId}.page.json`), record);
  return record;
}

async function acquireOneTrack(track) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "orvyq-music-fetch-"));
  try {
    const licenseSnapshot = await snapshotLicensePage(track);
    const bytes = await downloadWithRetry(track.downloadUrl, {
      redirect: "follow",
      headers: { "User-Agent": "ORVYQ documentary renderer/1.0", Referer: track.sourcePageUrl, Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.5" }
    });
    if (bytes.length < 100_000) throw new Error(`${track.trackId}: download is unexpectedly small (${bytes.length} bytes)`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const downloadPath = path.join(temp, `${track.trackId}.mp3`);
    await writeFile(downloadPath, bytes);
    const probed = await probe(downloadPath);

    const entry = await intakeMusicTrack({
      sourceFile: downloadPath,
      trackId: track.trackId,
      title: track.title,
      artist: ARTIST,
      sourcePageUrl: track.sourcePageUrl,
      licenseName: LICENSE_NAME,
      licenseUrl: LICENSE_URL,
      attribution: attributionFor(track.title),
      acquisitionProvenance: `Downloaded from the official Scott Buckley library (${track.downloadUrl}) by .github/workflows/orvyq-music-acquisition.yml; source/license page snapshot recorded at ${licenseSnapshot.snapshot_path} (sha256 ${licenseSnapshot.sha256}).`,
      approvedForProof: track.trackId === "sb_signal_to_noise",
      approvedForFull: true,
      status: "approved"
    });

    return { cue_id: track.cueId, track_id: track.trackId, sha256, bytes: bytes.length, ...probed, license_snapshot: licenseSnapshot, registry_entry: entry };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function markCueReady(projectId, cueId, trackId) {
  const dir = projectDir(projectId);
  const cueSheetPath = path.join(dir, "direction", "music_cue_sheet.json");
  const cueSheet = await readJson(cueSheetPath);
  const cue = (cueSheet.full_cues || []).find((entry) => entry.cue_id === cueId);
  if (!cue) throw new Error(`music_cue_sheet.json has no full_cues entry for ${cueId}`);
  if (cue.track_id !== trackId) throw new Error(`${cueId} declares track_id ${cue.track_id}, expected ${trackId}`);
  cue.status = "ready";
  await writeJsonAtomic(cueSheetPath, cueSheet);
}

async function writeConsolidatedAttribution(projectId, results) {
  const dir = projectDir(projectId);
  const lines = [
    "Music",
    ...results.map((result) => attributionFor(FULL_MUSIC_TRACKS.find((track) => track.trackId === result.track_id).title))
  ];
  const outputPath = path.join(dir, "assets", "music", "youtube_description_attribution.txt");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, lines.join("\n") + "\n");
  return path.relative(REPO_ROOT, outputPath).split(path.sep).join("/");
}

export async function fetchAndVendorFullMusicPackage(projectId = PROJECT_ID) {
  const results = [];
  for (const track of FULL_MUSIC_TRACKS) {
    const result = await acquireOneTrack(track);
    await markCueReady(projectId, track.cueId, track.trackId);
    results.push(result);
  }
  const attributionPath = await writeConsolidatedAttribution(projectId, results);
  return { tracks: results.length, cues_marked_ready: results.map((r) => r.cue_id), attribution_file: attributionPath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  fetchAndVendorFullMusicPackage(args["project-id"] || PROJECT_ID)
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
