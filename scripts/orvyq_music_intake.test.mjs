import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import { REPO_ROOT, MUSIC_REGISTRY_PATH, pathExists } from "./lib/fs-utils.mjs";
import { intakeMusicTrack } from "./orvyq_music_intake.mjs";

const exec = promisify(execFile);
const FIXTURE_SOURCE = path.join(REPO_ROOT, "music_library", "__test_source_track__.mp3");
const TEST_TRACK_ID = "__test_intake_track__";
const TEST_ASSET_PATH = path.join(REPO_ROOT, "music_library", "tracks", `${TEST_TRACK_ID}.mp3`);

async function makeFixtureAudio() {
  await exec("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "libmp3lame", FIXTURE_SOURCE]);
}

// intakeMusicTrack reads/writes the real music_library/registry.json (there
// is exactly one canonical registry, by design) -- these tests back it up
// and restore it (and remove any test asset file) around every test so
// running the suite never leaves test fixtures in the real registry.
async function withRegistryBackup(fn) {
  const hadRegistry = await pathExists(MUSIC_REGISTRY_PATH);
  const backup = hadRegistry ? await fs.readFile(MUSIC_REGISTRY_PATH, "utf8") : null;
  try {
    await fn();
  } finally {
    if (backup !== null) await fs.writeFile(MUSIC_REGISTRY_PATH, backup);
    await fs.rm(TEST_ASSET_PATH, { force: true });
  }
}

function validOptions(overrides = {}) {
  return {
    sourceFile: FIXTURE_SOURCE,
    trackId: TEST_TRACK_ID,
    title: "Test Fixture Track",
    artist: "Test Fixture Artist",
    sourcePageUrl: "https://example.invalid/track",
    licenseName: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Test Fixture Track by Test Fixture Artist, CC BY 4.0",
    acquisitionProvenance: "unit test fixture",
    approvedForProof: true,
    approvedForFull: false,
    status: "approved",
    ...overrides
  };
}

test("intakeMusicTrack setup: generate a real tiny audio fixture", async () => {
  await makeFixtureAudio();
  assert.ok(await pathExists(FIXTURE_SOURCE));
});

test("intakeMusicTrack verifies and adds a valid track to the canonical registry", async () => {
  await withRegistryBackup(async () => {
    const entry = await intakeMusicTrack(validOptions());
    assert.equal(entry.track_id, TEST_TRACK_ID);
    assert.equal(entry.codec, "mp3");
    assert.ok(entry.duration_seconds > 0);
    assert.ok(await pathExists(TEST_ASSET_PATH));
    const registry = JSON.parse(await fs.readFile(MUSIC_REGISTRY_PATH, "utf8"));
    assert.ok(registry.tracks.some((track) => track.track_id === TEST_TRACK_ID));
  });
});

test("intakeMusicTrack rejects when required license/attribution metadata is missing", async () => {
  await withRegistryBackup(async () => {
    await assert.rejects(() => intakeMusicTrack(validOptions({ attribution: "" })), /missing or incomplete required field "attribution"/);
    const registry = JSON.parse(await fs.readFile(MUSIC_REGISTRY_PATH, "utf8"));
    assert.ok(!registry.tracks.some((track) => track.track_id === TEST_TRACK_ID), "a rejected intake must not be added to the registry");
  });
});

test("intakeMusicTrack rejects on a sha256 mismatch against an explicitly expected hash", async () => {
  await withRegistryBackup(async () => {
    await assert.rejects(() => intakeMusicTrack(validOptions({ expectedSha256: "0".repeat(64) })), /hash mismatch/);
  });
});

test("intakeMusicTrack rejects when the source file does not exist", async () => {
  await withRegistryBackup(async () => {
    await assert.rejects(
      () => intakeMusicTrack(validOptions({ sourceFile: path.join(REPO_ROOT, "music_library", "__does_not_exist__.mp3") })),
      /source file does not exist/
    );
  });
});

test("intakeMusicTrack teardown: remove the generated audio fixture", async () => {
  await fs.rm(FIXTURE_SOURCE, { force: true });
});
