import { test } from "node:test";
import assert from "node:assert/strict";
import { FULL_MUSIC_TRACKS, attributionFor } from "./orvyq_fetch_full_music.mjs";

test("FULL_MUSIC_TRACKS declares exactly nine tracks, one per full_cues cue", () => {
  assert.equal(FULL_MUSIC_TRACKS.length, 9);
  const cueIds = FULL_MUSIC_TRACKS.map((track) => track.cueId);
  assert.equal(new Set(cueIds).size, 9, "every track must map to a distinct cue");
});

test("every track declares real scottbuckley.com.au URLs and complete metadata", () => {
  for (const track of FULL_MUSIC_TRACKS) {
    assert.match(track.sourcePageUrl, /^https:\/\/www\.scottbuckley\.com\.au\/library\//, `${track.trackId} source page`);
    assert.match(track.downloadUrl, /^https:\/\/www\.scottbuckley\.com\.au\/library\/wp-content\/uploads\/.+\.mp3$/, `${track.trackId} download url`);
    assert.ok(track.title?.length, `${track.trackId} needs a title`);
    assert.match(track.trackId, /^[a-z0-9]+(?:_[a-z0-9]+)*$/, `${track.trackId} must match the registry track_id pattern`);
  }
});

test("CUE_06_REGULATION_PARADOX reuses the already-vendored sb_signal_to_noise track (real Full Mix file)", () => {
  const cue06 = FULL_MUSIC_TRACKS.find((track) => track.cueId === "CUE_06_REGULATION_PARADOX");
  assert.equal(cue06.trackId, "sb_signal_to_noise");
  assert.equal(cue06.downloadUrl, "https://www.scottbuckley.com.au/library/wp-content/uploads/2020/04/sb_signaltonoise.mp3");
});

test("CUE_01 and CUE_02 use the No Piano Melody variants, distinct from CUE_06's Full Mix", () => {
  const cue01 = FULL_MUSIC_TRACKS.find((track) => track.cueId === "CUE_01_RACE_PARADOX");
  const cue02 = FULL_MUSIC_TRACKS.find((track) => track.cueId === "CUE_02_CONTROLLED_EVIDENCE");
  assert.match(cue01.downloadUrl, /nomelody/);
  assert.match(cue02.downloadUrl, /nomelody/);
  assert.notEqual(cue02.trackId, "sb_signal_to_noise");
});

test("attributionFor produces the required CC BY 4.0 attribution format", () => {
  assert.equal(attributionFor("Catalyst"), "'Catalyst' by Scott Buckley — released under CC-BY 4.0. www.scottbuckley.com.au");
});
