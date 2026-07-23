#!/usr/bin/env node
// resolveProjectMusic() -- the one call both orvyq-proof.yml and
// orvyq-full-render.yml make to obtain this project's licensed music,
// before any narration/edit-plan/render work runs. There is no fallback to
// a network fetch here: an unresolved track_id, missing asset, hash
// mismatch, or a track not approved for the requested mode all throw before
// any of these files are written.
//
// Full mode: direction/music_cue_sheet.json's full_cues each declare their
// OWN track_id -- nine distinct, real, licensed Scott Buckley (CC BY 4.0)
// tracks, one per cue (see docs/full-production-guide.md and
// .github/workflows/orvyq-music-acquisition.yml), not one continuous bed
// shared across every section. Each cue's track is resolved and verified
// independently against music_library/registry.json (hash, license,
// approved_for_full), trimmed to its own cue duration with a short edge
// fade at internal cue boundaries so cuts are never abrupt, and
// concatenated into one physical assets/music/approved_bed.mp3 -- the same
// asset scripts/orvyq_audio_mix.mjs has always read, so that script needed
// no structural changes to consume it.
//
// Proof mode still resolves a single track_id from proof_score, kept for
// schema/back-compat -- but as of the proof-is-a-frame-prefix restructuring
// in scripts/orvyq_edit_plan.mjs, no workflow invokes this path anymore:
// proof shares the full candidate's music like everything else it renders.
import path from "node:path";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import { createHash } from "node:crypto";
import { projectDir, readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { resolveCanonicalTrack, resolveCanonicalTrackToPath, loadMusicRegistry } from "./lib/orvyq-music-registry.mjs";
import { command, durationSecondsOf } from "./lib/orvyq-loudness.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const CUE_EDGE_FADE_SECONDS = 1.5;

export function extractRequiredTrackId(cueSheet, mode) {
  if (mode !== "proof")
    throw new Error(`extractRequiredTrackId only resolves mode "proof" (full mode resolves one distinct track_id per cue -- see extractFullCueTrackIds); got "${mode}"`);
  const trackId = cueSheet.proof_score?.track_id;
  if (!trackId) throw new Error("direction/music_cue_sheet.json's proof_score does not declare a track_id");
  return trackId;
}

// Full mode assembles the music bed from real, distinct per-cue tracks, one
// per full_cues entry (see docs/full-production-guide.md) -- cues do not
// have to, and typically won't, all reference the same track_id.
export function extractFullCueTrackIds(cueSheet) {
  const cues = cueSheet.full_cues || [];
  if (!cues.length) throw new Error("direction/music_cue_sheet.json has no full_cues");
  const failures = [];
  for (const cue of cues) {
    if (!cue.track_id) failures.push(`full_cues entry ${cue.cue_id || "?"} does not declare a track_id`);
    if (!(Number(cue.end) > Number(cue.start))) failures.push(`full_cues entry ${cue.cue_id || "?"} has an invalid start/end (${cue.start}..${cue.end})`);
  }
  if (failures.length) throw new Error(failures.join("; "));
  return cues.map((cue) => ({ cue_id: cue.cue_id, section_id: cue.section_id, track_id: cue.track_id, start: Number(cue.start), end: Number(cue.end) }));
}

async function sha256File(absPath) {
  return createHash("sha256").update(await readFile(absPath)).digest("hex");
}

// Builds one cue's trimmed, individually-loudness-normalized segment. If the
// resolved track is shorter than the cue needs (not expected for any of the
// nine tracks this project assigns -- documentary-length Scott Buckley
// compositions comfortably exceed every cue's duration -- but handled
// rather than left to crash), it loops the source rather than silently
// truncating the cue short.
async function buildCueSegment({ sourcePath, duration, fadeIn, fadeOut, outputPath }) {
  const sourceDuration = await durationSecondsOf(sourcePath);
  const looped = sourceDuration + 0.01 < duration;
  const inputArgs = looped ? ["-stream_loop", "-1", "-i", sourcePath] : ["-i", sourcePath];
  const filters = ["atrim=duration=" + duration, "asetpts=PTS-STARTPTS"];
  if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${fadeIn}`);
  if (fadeOut > 0) filters.push(`afade=t=out:st=${Math.max(0, duration - fadeOut)}:d=${fadeOut}`);
  filters.push("loudnorm=I=-23:TP=-3:LRA=11", "aformat=sample_rates=48000:channel_layouts=stereo");
  await command("ffmpeg", ["-hide_banner", "-nostats", "-y", ...inputArgs, "-filter:a", filters.join(","), "-t", String(duration), "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", outputPath]);
  return { looped, sourceDuration };
}

async function buildFullMusicBed({ dir, cues, registry, destination }) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "orvyq-music-bed-"));
  try {
    const segments = [];
    const cueRecords = [];
    for (let index = 0; index < cues.length; index += 1) {
      const cue = cues[index];
      const duration = cue.end - cue.start;
      const { track, assetAbsPath } = await resolveCanonicalTrack(cue.track_id, { mode: "full", registry });
      const segmentPath = path.join(temp, `segment_${String(index + 1).padStart(2, "0")}.wav`);
      const fadeIn = index === 0 ? 0 : CUE_EDGE_FADE_SECONDS;
      const fadeOut = index === cues.length - 1 ? 0 : CUE_EDGE_FADE_SECONDS;
      const { looped, sourceDuration } = await buildCueSegment({ sourcePath: assetAbsPath, duration, fadeIn, fadeOut, outputPath: segmentPath });
      segments.push(segmentPath);
      cueRecords.push({
        cue_id: cue.cue_id,
        section_id: cue.section_id,
        track_id: track.track_id,
        title: track.title,
        artist: track.artist,
        source_page_url: track.source_page_url,
        license_name: track.license_name,
        license_url: track.license_url,
        attribution: track.attribution,
        start_seconds: cue.start,
        end_seconds: cue.end,
        duration_seconds: duration,
        source_track_duration_seconds: sourceDuration,
        looped
      });
    }

    const listFile = path.join(temp, "concat.txt");
    await writeFile(listFile, segments.map((segmentPath) => `file '${segmentPath.replace(/'/g, "'\\''")}'`).join("\n"));
    await command("ffmpeg", ["-hide_banner", "-nostats", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-ac", "2", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "192k", destination]);

    const bytes = (await readFile(destination)).length;
    const sha256 = await sha256File(destination);
    const totalDuration = await durationSecondsOf(destination);
    const licenseUrls = new Set(cueRecords.map((record) => record.license_url));
    const licenseNames = new Set(cueRecords.map((record) => record.license_name));

    const provenance = {
      schema_version: "1.0",
      asset: "assets/music/approved_bed.mp3",
      assembly: "nine_cue_concatenation",
      cues: cueRecords,
      license: licenseNames.size === 1 ? [...licenseNames][0] : [...licenseNames].join(" / "),
      license_url: licenseUrls.size === 1 ? [...licenseUrls][0] : [...licenseUrls].join(" "),
      attribution: cueRecords.map((record) => record.attribution).filter((value, index, all) => all.indexOf(value) === index).join("\n"),
      approved_for_final_edit: true,
      sha256,
      bytes,
      duration_seconds: Math.round(totalDuration * 1000) / 1000,
      resolved_at: new Date().toISOString(),
      reproducibility: "canonical_registry_pinned",
      canonical_track_ids: cueRecords.map((record) => record.track_id)
    };
    await writeJsonAtomic(path.join(dir, "assets", "music", "approved_bed.provenance.json"), provenance);
    return { track_ids: provenance.canonical_track_ids, cue_count: cueRecords.length, duration_seconds: provenance.duration_seconds, ...provenance };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export async function resolveProjectMusic(projectId = PROJECT_ID, { mode } = {}) {
  if (mode !== "proof" && mode !== "full") throw new Error(`mode must be "proof" or "full", got "${mode}"`);
  const dir = projectDir(projectId);
  const cueSheet = await readJson(path.join(dir, "direction", "music_cue_sheet.json"));
  const registry = await loadMusicRegistry();
  const destination = path.join(dir, "assets", "music", "approved_bed.mp3");

  if (mode === "proof") {
    const trackId = extractRequiredTrackId(cueSheet, mode);
    const track = await resolveCanonicalTrackToPath(trackId, { mode, destinationAbsPath: destination, registry });
    const provenance = {
      schema_version: "1.0",
      asset: "assets/music/approved_bed.mp3",
      title: track.title,
      composer: track.artist,
      source_page_url: track.source_page_url,
      license: track.license_name,
      license_url: track.license_url,
      attribution: track.attribution,
      approved_for_final_edit: true,
      sha256: track.sha256,
      bytes: track.bytes,
      duration_seconds: track.duration_seconds,
      resolved_at: new Date().toISOString(),
      reproducibility: "canonical_registry_pinned",
      canonical_track_id: track.track_id
    };
    await writeJsonAtomic(path.join(dir, "assets", "music", "approved_bed.provenance.json"), provenance);
    return { mode, track_id: track.track_id, ...provenance };
  }

  const cues = extractFullCueTrackIds(cueSheet);
  const result = await buildFullMusicBed({ dir, cues, registry, destination });
  return { mode, ...result };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  resolveProjectMusic(args["project-id"] || PROJECT_ID, { mode: args.mode || "proof" })
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
