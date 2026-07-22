#!/usr/bin/env node
// resolveProjectMusic() -- the one call both orvyq-proof.yml and
// orvyq-full-render.yml make to obtain this project's licensed music,
// before any narration/edit-plan/render work runs. It reads
// direction/music_cue_sheet.json's track_id (proof_score for proof,
// full_cues for full -- the whole film uses one continuous licensed bed, so
// every full_cues entry must reference the same track_id), resolves it
// against music_library/registry.json via resolveCanonicalTrackToPath(),
// and writes assets/music/approved_bed.mp3 + approved_bed.provenance.json --
// the same two files scripts/orvyq_audio_mix.mjs has always read, so that
// script needed no changes at all. There is no fallback to a network fetch
// here: an unresolved track_id, missing asset, hash mismatch, or a track not
// approved for the requested mode all throw before any of these files are
// written.
import path from "node:path";
import { projectDir, readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { resolveCanonicalTrackToPath, loadMusicRegistry } from "./lib/orvyq-music-registry.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";

// Extracted as its own pure function so cue-sheet parsing (unknown/missing
// track_id, inconsistent multi-track full_cues) can be unit tested without
// touching real project files or the registry.
export function extractRequiredTrackId(cueSheet, mode) {
  if (mode !== "proof" && mode !== "full") throw new Error(`mode must be "proof" or "full", got "${mode}"`);
  const trackIds =
    mode === "proof" ? [cueSheet.proof_score?.track_id] : [...new Set((cueSheet.full_cues || []).map((cue) => cue.track_id))];
  const cleanIds = trackIds.filter(Boolean);
  if (!cleanIds.length)
    throw new Error(`direction/music_cue_sheet.json's ${mode === "proof" ? "proof_score" : "full_cues"} does not declare a track_id`);
  if (cleanIds.length > 1)
    throw new Error(
      `direction/music_cue_sheet.json's full_cues reference more than one distinct track_id (${cleanIds.join(", ")}) -- the full film uses a single continuous licensed bed`
    );
  return cleanIds[0];
}

export async function resolveProjectMusic(projectId = PROJECT_ID, { mode } = {}) {
  const dir = projectDir(projectId);
  const cueSheet = await readJson(path.join(dir, "direction", "music_cue_sheet.json"));
  const registry = await loadMusicRegistry();
  const trackId = extractRequiredTrackId(cueSheet, mode);
  const destination = path.join(dir, "assets", "music", "approved_bed.mp3");
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  resolveProjectMusic(args["project-id"] || PROJECT_ID, { mode: args.mode || "proof" })
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
