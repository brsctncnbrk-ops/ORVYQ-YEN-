import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { REPO_ROOT } from "./fs-utils.mjs";
import { resolveCanonicalTrack, resolveCanonicalTrackToPath, findTrack } from "./orvyq-music-registry.mjs";

const FIXTURE_RELATIVE_PATH = path.join("music_library", "tracks", "__test_fixture_track__.bin");
const FIXTURE_ABS_PATH = path.join(REPO_ROOT, FIXTURE_RELATIVE_PATH);
const FIXTURE_BYTES = Buffer.from("this is a fake but real on-disk audio fixture for tests");
const FIXTURE_SHA256 = createHash("sha256").update(FIXTURE_BYTES).digest("hex");

function baseTrack(overrides = {}) {
  return {
    track_id: "fixture_track",
    title: "Fixture Track",
    artist: "Fixture Artist",
    asset_path: FIXTURE_RELATIVE_PATH.split(path.sep).join("/"),
    sha256: FIXTURE_SHA256,
    bytes: FIXTURE_BYTES.length,
    duration_seconds: 150,
    codec: "mp3",
    source_page_url: "https://example.invalid/track",
    license_name: "CC BY 4.0",
    license_url: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Fixture Track by Fixture Artist, CC BY 4.0",
    date_acquired: "2026-07-22T00:00:00.000Z",
    acquisition_provenance: "test fixture",
    approved_for_proof: true,
    approved_for_full: false,
    status: "approved",
    ...overrides
  };
}

async function withFixtureFile(fn) {
  await fs.mkdir(path.dirname(FIXTURE_ABS_PATH), { recursive: true });
  await fs.writeFile(FIXTURE_ABS_PATH, FIXTURE_BYTES);
  try {
    await fn();
  } finally {
    await fs.rm(FIXTURE_ABS_PATH, { force: true });
  }
}

test("resolveCanonicalTrack resolves a valid, approved track for the requested mode", async () => {
  await withFixtureFile(async () => {
    const registry = { schema_version: "1.0", tracks: [baseTrack()] };
    const { track, assetAbsPath } = await resolveCanonicalTrack("fixture_track", { mode: "proof", registry });
    assert.equal(track.track_id, "fixture_track");
    assert.equal(assetAbsPath, FIXTURE_ABS_PATH);
  });
});

test("resolveCanonicalTrack throws a clear error for an unknown track_id", async () => {
  const registry = { schema_version: "1.0", tracks: [baseTrack()] };
  await assert.rejects(() => resolveCanonicalTrack("does_not_exist", { mode: "proof", registry }), /Unknown canonical music track_id/);
});

test("resolveCanonicalTrack throws when the local asset file is missing on disk", async () => {
  const registry = { schema_version: "1.0", tracks: [baseTrack({ asset_path: "music_library/tracks/__never_created__.bin" })] };
  await assert.rejects(() => resolveCanonicalTrack("fixture_track", { mode: "proof", registry }), /missing on disk/);
});

test("resolveCanonicalTrack throws on a sha256 hash mismatch", async () => {
  await withFixtureFile(async () => {
    const registry = { schema_version: "1.0", tracks: [baseTrack({ sha256: "0".repeat(64) })] };
    await assert.rejects(() => resolveCanonicalTrack("fixture_track", { mode: "proof", registry }), /hash mismatch/);
  });
});

test("resolveCanonicalTrack throws when required license metadata is incomplete", async () => {
  await withFixtureFile(async () => {
    const registry = { schema_version: "1.0", tracks: [baseTrack({ attribution: "" })] };
    await assert.rejects(() => resolveCanonicalTrack("fixture_track", { mode: "proof", registry }), /missing required license metadata field "attribution"/);
  });
});

test("resolveCanonicalTrack throws when the track is not approved for the requested mode", async () => {
  await withFixtureFile(async () => {
    const registry = { schema_version: "1.0", tracks: [baseTrack({ approved_for_full: false })] };
    await assert.rejects(() => resolveCanonicalTrack("fixture_track", { mode: "full", registry }), /not approved_for_full/);
  });
});

test("resolveCanonicalTrack throws when the track's status is not approved", async () => {
  await withFixtureFile(async () => {
    const registry = { schema_version: "1.0", tracks: [baseTrack({ status: "pending_review" })] };
    await assert.rejects(() => resolveCanonicalTrack("fixture_track", { mode: "proof", registry }), /has status "pending_review"/);
  });
});

test("resolveCanonicalTrackToPath copies the verified asset to the destination path", async () => {
  await withFixtureFile(async () => {
    const registry = { schema_version: "1.0", tracks: [baseTrack()] };
    const destination = path.join(REPO_ROOT, "music_library", "tracks", "__test_destination__.bin");
    try {
      const track = await resolveCanonicalTrackToPath("fixture_track", { mode: "proof", destinationAbsPath: destination, registry });
      assert.equal(track.track_id, "fixture_track");
      const copied = await fs.readFile(destination);
      assert.equal(copied.toString(), FIXTURE_BYTES.toString());
    } finally {
      await fs.rm(destination, { force: true });
    }
  });
});

test("findTrack returns null for an id not present in the registry", () => {
  const registry = { schema_version: "1.0", tracks: [baseTrack()] };
  assert.equal(findTrack(registry, "nope"), null);
});

test("resolveCanonicalTrack rejects an invalid mode argument", async () => {
  const registry = { schema_version: "1.0", tracks: [baseTrack()] };
  await assert.rejects(() => resolveCanonicalTrack("fixture_track", { mode: "preview", registry }), /mode must be "proof" or "full"/);
});
