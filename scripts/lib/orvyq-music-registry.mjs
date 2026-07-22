// resolveCanonicalTrack() -- the single music-resolution path both proof and
// full render use. Neither mode ever fetches a third-party URL at render
// time: every cue references a track_id, and this function is the only
// place that turns a track_id into real, verified audio bytes, by looking
// it up in music_library/registry.json and checking the local canonical
// asset it points to. Any failure here (unknown track_id, missing asset,
// hash mismatch, incomplete license metadata, or the track not being
// approved for the requested mode) throws BEFORE any render work begins --
// there is no silent substitution and no fallback to a network fetch.
import path from "node:path";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { REPO_ROOT, MUSIC_REGISTRY_PATH, readJson, pathExists, writeJsonAtomic } from "./fs-utils.mjs";

const REQUIRED_LICENSE_FIELDS = ["license_name", "license_url", "attribution"];

export async function loadMusicRegistry() {
  if (!(await pathExists(MUSIC_REGISTRY_PATH))) {
    throw new Error(`Canonical music registry is missing: ${path.relative(REPO_ROOT, MUSIC_REGISTRY_PATH)}`);
  }
  const registry = await readJson(MUSIC_REGISTRY_PATH);
  if (!Array.isArray(registry.tracks)) throw new Error("music_library/registry.json is malformed: tracks must be an array");
  return registry;
}

export async function saveMusicRegistry(registry) {
  await writeJsonAtomic(MUSIC_REGISTRY_PATH, registry);
}

export function findTrack(registry, trackId) {
  return registry.tracks.find((track) => track.track_id === trackId) || null;
}

async function sha256OfFile(absPath) {
  return createHash("sha256").update(await fs.readFile(absPath)).digest("hex");
}

// mode: "proof" | "full". Throws a specific, explanatory error for every
// distinct readiness-policy failure the render workflows must fail on
// before any render work begins: unknown track_id, missing asset, hash
// mismatch, incomplete license metadata, missing attribution, or the track
// not being approved for the requested mode.
export async function resolveCanonicalTrack(trackId, { mode, registry = null } = {}) {
  if (mode !== "proof" && mode !== "full") throw new Error(`resolveCanonicalTrack mode must be "proof" or "full", got "${mode}"`);
  if (!trackId) throw new Error("resolveCanonicalTrack requires a track_id (music_cue_sheet.json cue is missing one)");

  const loadedRegistry = registry || (await loadMusicRegistry());
  const track = findTrack(loadedRegistry, trackId);
  if (!track) throw new Error(`Unknown canonical music track_id "${trackId}" -- not present in music_library/registry.json`);

  if (track.status !== "approved") throw new Error(`Canonical music track "${trackId}" has status "${track.status}", not "approved"`);

  for (const field of REQUIRED_LICENSE_FIELDS) {
    if (!track[field] || typeof track[field] !== "string" || !track[field].trim())
      throw new Error(`Canonical music track "${trackId}" is missing required license metadata field "${field}"`);
  }

  const approvalField = mode === "proof" ? "approved_for_proof" : "approved_for_full";
  if (track[approvalField] !== true) throw new Error(`Canonical music track "${trackId}" is not approved_for_${mode}`);

  const assetAbsPath = path.join(REPO_ROOT, track.asset_path);
  if (!(await pathExists(assetAbsPath))) throw new Error(`Canonical music asset for track "${trackId}" is missing on disk: ${track.asset_path}`);

  const stat = await fs.stat(assetAbsPath);
  if (stat.size !== track.bytes)
    throw new Error(`Canonical music asset for track "${trackId}" has size ${stat.size} bytes, registry expects ${track.bytes} bytes`);

  const sha256 = await sha256OfFile(assetAbsPath);
  if (sha256 !== track.sha256)
    throw new Error(`Canonical music asset for track "${trackId}" hash mismatch: expected ${track.sha256}, got ${sha256}`);

  return { track, assetAbsPath };
}

// Resolves and copies the verified canonical asset to `destinationAbsPath`
// (e.g. assets/music/approved_bed.mp3) -- the one place render pipelines
// obtain their music file from, instead of a live fetch.
export async function resolveCanonicalTrackToPath(trackId, { mode, destinationAbsPath, registry = null }) {
  const { track, assetAbsPath } = await resolveCanonicalTrack(trackId, { mode, registry });
  await fs.mkdir(path.dirname(destinationAbsPath), { recursive: true });
  await fs.copyFile(assetAbsPath, destinationAbsPath);
  return track;
}
