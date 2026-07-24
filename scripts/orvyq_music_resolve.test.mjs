import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { REPO_ROOT } from "./lib/fs-utils.mjs";
import { command, durationSecondsOf } from "./lib/orvyq-loudness.mjs";
import {
  extractRequiredTrackId,
  extractFullCueTrackIds,
  distinctCompositionFamilies,
  assertSingleCompositionFamily,
  buildFullMusicBed
} from "./orvyq_music_resolve.mjs";

test("extractRequiredTrackId reads proof_score.track_id for proof mode", () => {
  const cueSheet = { proof_score: { track_id: "sb_signal_to_noise" }, full_cues: [] };
  assert.equal(extractRequiredTrackId(cueSheet, "proof"), "sb_signal_to_noise");
});

test("extractRequiredTrackId throws when proof_score has no track_id (unknown cue-sheet track_id case)", () => {
  const cueSheet = { proof_score: {}, full_cues: [] };
  assert.throws(() => extractRequiredTrackId(cueSheet, "proof"), /does not declare a track_id/);
});

test("extractRequiredTrackId rejects mode \"full\" -- full mode resolves one track_id per cue, not a single shared one", () => {
  const cueSheet = { full_cues: [{ cue_id: "A", track_id: "x" }] };
  assert.throws(() => extractRequiredTrackId(cueSheet, "full"), /extractFullCueTrackIds/);
});

test("extractRequiredTrackId rejects an invalid mode", () => {
  assert.throws(() => extractRequiredTrackId({}, "preview"), /extractFullCueTrackIds/);
});

test("extractFullCueTrackIds reads each cue's own distinct track_id", () => {
  const cueSheet = {
    full_cues: [
      { cue_id: "A", section_id: "SEC_A", track_id: "sb_intervention", start: 0, end: 60 },
      { cue_id: "B", section_id: "SEC_B", track_id: "sb_catalyst", start: 60, end: 120 }
    ]
  };
  const cues = extractFullCueTrackIds(cueSheet);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].track_id, "sb_intervention");
  assert.equal(cues[1].track_id, "sb_catalyst");
  assert.notEqual(cues[0].track_id, cues[1].track_id);
});

test("extractFullCueTrackIds throws when a cue is missing its own track_id", () => {
  const cueSheet = { full_cues: [{ cue_id: "A", start: 0, end: 60 }] };
  assert.throws(() => extractFullCueTrackIds(cueSheet), /does not declare a track_id/);
});

test("extractFullCueTrackIds throws when a cue's start/end is invalid", () => {
  const cueSheet = { full_cues: [{ cue_id: "A", track_id: "x", start: 60, end: 60 }] };
  assert.throws(() => extractFullCueTrackIds(cueSheet), /invalid start\/end/);
});

test("extractFullCueTrackIds throws when there are no full_cues at all", () => {
  assert.throws(() => extractFullCueTrackIds({ full_cues: [] }), /no full_cues/);
});

// ---------------------------------------------------------------------------
// distinctCompositionFamilies / assertSingleCompositionFamily -- pure
// functions, no ffmpeg/filesystem, exercising task follow-up section 12/16's
// "the candidate's music must come from a single composition family" rule
// in isolation from buildFullMusicBed's real audio assembly.
// ---------------------------------------------------------------------------

test("distinctCompositionFamilies / assertSingleCompositionFamily: composition_family count = 1 passes", () => {
  const families = distinctCompositionFamilies([{ composition_family: "signal_to_noise" }, { composition_family: "signal_to_noise" }]);
  assert.deepEqual(families, ["signal_to_noise"]);
  assert.doesNotThrow(() => assertSingleCompositionFamily(families));
});

test("assertSingleCompositionFamily rejects more than one distinct composition family", () => {
  const families = distinctCompositionFamilies([{ composition_family: "signal_to_noise" }, { composition_family: "catalyst" }]);
  assert.equal(families.length, 2);
  assert.throws(() => assertSingleCompositionFamily(families), /distinct composition families/);
});

test("assertSingleCompositionFamily rejects a null/missing composition_family", () => {
  const families = distinctCompositionFamilies([{ composition_family: null }]);
  assert.throws(() => assertSingleCompositionFamily(families), /null\/empty composition_family/);
});

// ---------------------------------------------------------------------------
// buildFullMusicBed integration tests -- real ffmpeg, real sine-wave fixture
// tracks (same pattern as scripts/orvyq_music_intake.test.mjs), verifying
// the real overlapping-crossfade assembly (task follow-up section 16):
// exact duration after crossfade, no silence gap at cue/loop boundaries,
// music continuing all the way to the bed's own end, a single enforced
// composition family, and real per-track hashes recorded in provenance.
// ---------------------------------------------------------------------------

const FIXTURE_TRACKS_DIR = path.join(REPO_ROOT, "music_library", "tracks");
const FIXTURE_TRACK_IDS = ["__test_resolve_main__", "__test_resolve_variant__", "__test_resolve_other_family__", "__test_resolve_short__"];

async function makeFixtureTrack({ trackId, frequency, duration, family }) {
  const destPath = path.join(FIXTURE_TRACKS_DIR, `${trackId}.wav`);
  await fs.mkdir(FIXTURE_TRACKS_DIR, { recursive: true });
  await command("ffmpeg", ["-hide_banner", "-nostats", "-y", "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`, "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", destPath]);
  const bytes = (await fs.stat(destPath)).size;
  const sha256 = createHash("sha256").update(await fs.readFile(destPath)).digest("hex");
  return {
    track_id: trackId,
    title: `Fixture ${trackId}`,
    artist: "Fixture Artist",
    composition_family: family,
    asset_path: path.relative(REPO_ROOT, destPath).split(path.sep).join("/"),
    sha256,
    bytes,
    duration_seconds: duration,
    codec: "pcm_s16le",
    source_page_url: "https://example.invalid/track",
    license_name: "CC BY 4.0",
    license_url: "https://creativecommons.org/licenses/by/4.0/",
    attribution: `Fixture ${trackId} by Fixture Artist, CC BY 4.0`,
    date_acquired: new Date().toISOString(),
    acquisition_provenance: "unit test fixture",
    approved_for_proof: true,
    approved_for_full: true,
    status: "approved"
  };
}

async function withFixtureBed(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orvyq-music-resolve-test-"));
  await fs.mkdir(path.join(dir, "assets", "music"), { recursive: true });
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function silenceIntervals(file, { noiseDb = -50, minDurationSeconds = 0.05 } = {}) {
  let stderr = "";
  try {
    const result = await command("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", `silencedetect=noise=${noiseDb}dB:d=${minDurationSeconds}`, "-f", "null", "-"]);
    stderr = `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    stderr = error.message;
  }
  const starts = [...stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((match) => Number.parseFloat(match[1]));
  return starts;
}

test("music fixture setup: generate real sine-wave tracks", async (t) => {
  t.after(() => Promise.all(FIXTURE_TRACK_IDS.map((id) => fs.rm(path.join(FIXTURE_TRACKS_DIR, `${id}.wav`), { force: true }))));
  const main = await makeFixtureTrack({ trackId: "__test_resolve_main__", frequency: 220, duration: 20, family: "test_family" });
  assert.ok(main.bytes > 0);
});

test("buildFullMusicBed: exact duration after crossfade, verified via real ffprobe", async (t) => {
  const main = await makeFixtureTrack({ trackId: "__test_resolve_main__", frequency: 220, duration: 20, family: "test_family" });
  const variant = await makeFixtureTrack({ trackId: "__test_resolve_variant__", frequency: 330, duration: 20, family: "test_family" });
  t.after(() => Promise.all([main, variant].map((track) => fs.rm(path.join(REPO_ROOT, track.asset_path), { force: true }))));

  await withFixtureBed(async (dir) => {
    const registry = { tracks: [main, variant] };
    const cues = [
      { cue_id: "A", section_id: "S1", track_id: main.track_id, start: 0, end: 6 },
      { cue_id: "B", section_id: "S2", track_id: variant.track_id, start: 6, end: 11 }
    ];
    const destination = path.join(dir, "assets", "music", "approved_bed.mp3");
    const result = await buildFullMusicBed({ dir, cues, registry, destination });

    assert.equal(result.cue_count, 2);
    const targetTotal = 11;
    assert.ok(Math.abs(result.duration_seconds - targetTotal) <= 0.15, `expected ~${targetTotal}s, got ${result.duration_seconds}s`);
    const measured = await durationSecondsOf(destination);
    assert.ok(Math.abs(measured - targetTotal) <= 0.15, `ffprobe measured ${measured}s, expected ~${targetTotal}s`);
  });
});

test("buildFullMusicBed: extends the bed to an explicit targetDurationSeconds (candidate timeline), not just the cue sheet's own authored total", async (t) => {
  const main = await makeFixtureTrack({ trackId: "__test_resolve_main__", frequency: 220, duration: 20, family: "test_family" });
  const variant = await makeFixtureTrack({ trackId: "__test_resolve_variant__", frequency: 330, duration: 20, family: "test_family" });
  t.after(() => Promise.all([main, variant].map((track) => fs.rm(path.join(REPO_ROOT, track.asset_path), { force: true }))));

  await withFixtureBed(async (dir) => {
    const registry = { tracks: [main, variant] };
    const cues = [
      { cue_id: "A", section_id: "S1", track_id: main.track_id, start: 0, end: 6 },
      { cue_id: "B", section_id: "S2", track_id: variant.track_id, start: 6, end: 11 }
    ];
    const destination = path.join(dir, "assets", "music", "approved_bed.mp3");
    const targetDurationSeconds = 14;
    const result = await buildFullMusicBed({ dir, cues, registry, destination, targetDurationSeconds });

    assert.ok(Math.abs(result.duration_seconds - targetDurationSeconds) <= 0.15, `expected ~${targetDurationSeconds}s, got ${result.duration_seconds}s`);
    const measured = await durationSecondsOf(destination);
    assert.ok(Math.abs(measured - targetDurationSeconds) <= 0.15, `ffprobe measured ${measured}s, expected ~${targetDurationSeconds}s`);
  });
});

test("buildFullMusicBed: no silence gap at the cue-to-cue crossfade boundary", async (t) => {
  const main = await makeFixtureTrack({ trackId: "__test_resolve_main__", frequency: 220, duration: 20, family: "test_family" });
  const variant = await makeFixtureTrack({ trackId: "__test_resolve_variant__", frequency: 330, duration: 20, family: "test_family" });
  t.after(() => Promise.all([main, variant].map((track) => fs.rm(path.join(REPO_ROOT, track.asset_path), { force: true }))));

  await withFixtureBed(async (dir) => {
    const registry = { tracks: [main, variant] };
    const cues = [
      { cue_id: "A", section_id: "S1", track_id: main.track_id, start: 0, end: 6 },
      { cue_id: "B", section_id: "S2", track_id: variant.track_id, start: 6, end: 11 }
    ];
    const destination = path.join(dir, "assets", "music", "approved_bed.mp3");
    await buildFullMusicBed({ dir, cues, registry, destination });

    const silences = await silenceIntervals(destination);
    assert.deepEqual(silences, [], `expected no detected silence anywhere in the crossfaded bed, found silence_start at: ${silences.join(", ")}`);
  });
});

test("buildFullMusicBed: a single cue whose source must loop crossfades the loop seam (no silence gap), instead of a raw hard cut", async (t) => {
  const short = await makeFixtureTrack({ trackId: "__test_resolve_short__", frequency: 220, duration: 6, family: "test_family" });
  t.after(() => fs.rm(path.join(REPO_ROOT, short.asset_path), { force: true }));

  await withFixtureBed(async (dir) => {
    const registry = { tracks: [short] };
    // A single 16s cue against a 6s source forces two internal loop
    // wraps -- exercising buildSeamlessLoopUnit's crossfaded bridge.
    const cues = [{ cue_id: "A", section_id: "S1", track_id: short.track_id, start: 0, end: 16 }];
    const destination = path.join(dir, "assets", "music", "approved_bed.mp3");
    const result = await buildFullMusicBed({ dir, cues, registry, destination });

    assert.ok(Math.abs(result.duration_seconds - 16) <= 0.15);
    assert.equal(result.cues[0].looped, true);
    const silences = await silenceIntervals(destination);
    assert.deepEqual(silences, [], `expected no detected silence at the internal loop seam, found silence_start at: ${silences.join(", ")}`);
  });
});

test("buildFullMusicBed: music continues to the bed's own end (last non-silent audio within 0.5s of the end)", async (t) => {
  const main = await makeFixtureTrack({ trackId: "__test_resolve_main__", frequency: 220, duration: 20, family: "test_family" });
  const variant = await makeFixtureTrack({ trackId: "__test_resolve_variant__", frequency: 330, duration: 20, family: "test_family" });
  t.after(() => Promise.all([main, variant].map((track) => fs.rm(path.join(REPO_ROOT, track.asset_path), { force: true }))));

  await withFixtureBed(async (dir) => {
    const registry = { tracks: [main, variant] };
    const cues = [
      { cue_id: "A", section_id: "S1", track_id: main.track_id, start: 0, end: 6 },
      { cue_id: "B", section_id: "S2", track_id: variant.track_id, start: 6, end: 11 }
    ];
    const destination = path.join(dir, "assets", "music", "approved_bed.mp3");
    const result = await buildFullMusicBed({ dir, cues, registry, destination });

    const silences = await silenceIntervals(destination);
    for (const start of silences) {
      assert.ok(start >= result.duration_seconds - 0.5, `silence at ${start}s starts more than 0.5s before the bed's own end (${result.duration_seconds}s)`);
    }
  });
});

test("buildFullMusicBed: rejects cues that resolve to more than one composition family", async (t) => {
  const main = await makeFixtureTrack({ trackId: "__test_resolve_main__", frequency: 220, duration: 20, family: "test_family" });
  const other = await makeFixtureTrack({ trackId: "__test_resolve_other_family__", frequency: 550, duration: 20, family: "other_family" });
  t.after(() => Promise.all([main, other].map((track) => fs.rm(path.join(REPO_ROOT, track.asset_path), { force: true }))));

  await withFixtureBed(async (dir) => {
    const registry = { tracks: [main, other] };
    const cues = [
      { cue_id: "A", section_id: "S1", track_id: main.track_id, start: 0, end: 6 },
      { cue_id: "B", section_id: "S2", track_id: other.track_id, start: 6, end: 11 }
    ];
    const destination = path.join(dir, "assets", "music", "approved_bed.mp3");
    await assert.rejects(() => buildFullMusicBed({ dir, cues, registry, destination }), /distinct composition families/);
  });
});

test("buildFullMusicBed: provenance records the real per-track sha256 from the registry, not a fabricated value", async (t) => {
  const main = await makeFixtureTrack({ trackId: "__test_resolve_main__", frequency: 220, duration: 20, family: "test_family" });
  const variant = await makeFixtureTrack({ trackId: "__test_resolve_variant__", frequency: 330, duration: 20, family: "test_family" });
  t.after(() => Promise.all([main, variant].map((track) => fs.rm(path.join(REPO_ROOT, track.asset_path), { force: true }))));

  await withFixtureBed(async (dir) => {
    const registry = { tracks: [main, variant] };
    const cues = [
      { cue_id: "A", section_id: "S1", track_id: main.track_id, start: 0, end: 6 },
      { cue_id: "B", section_id: "S2", track_id: variant.track_id, start: 6, end: 11 }
    ];
    const destination = path.join(dir, "assets", "music", "approved_bed.mp3");
    const result = await buildFullMusicBed({ dir, cues, registry, destination });

    assert.equal(result.cues[0].source_sha256, main.sha256);
    assert.equal(result.cues[1].source_sha256, variant.sha256);
    assert.equal(result.composition_family, "test_family");

    const provenanceOnDisk = JSON.parse(await fs.readFile(path.join(dir, "assets", "music", "approved_bed.provenance.json"), "utf8"));
    assert.equal(provenanceOnDisk.cues[0].source_sha256, main.sha256);
    assert.equal(provenanceOnDisk.crossfade_method, "ffmpeg_acrossfade_chain_with_duration_compensation");
  });
});
