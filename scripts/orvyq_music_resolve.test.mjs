import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRequiredTrackId } from "./orvyq_music_resolve.mjs";

test("extractRequiredTrackId reads proof_score.track_id for proof mode", () => {
  const cueSheet = { proof_score: { track_id: "sb_signal_to_noise" }, full_cues: [] };
  assert.equal(extractRequiredTrackId(cueSheet, "proof"), "sb_signal_to_noise");
});

test("extractRequiredTrackId requires every full_cues entry to share one track_id (proof/full parity of resolution)", () => {
  const cueSheet = {
    full_cues: [
      { cue_id: "A", track_id: "full_score_v1" },
      { cue_id: "B", track_id: "full_score_v1" },
      { cue_id: "C", track_id: "full_score_v1" }
    ]
  };
  assert.equal(extractRequiredTrackId(cueSheet, "full"), "full_score_v1");
});

test("extractRequiredTrackId throws when proof_score has no track_id (unknown cue-sheet track_id case)", () => {
  const cueSheet = { proof_score: {}, full_cues: [] };
  assert.throws(() => extractRequiredTrackId(cueSheet, "proof"), /does not declare a track_id/);
});

test("extractRequiredTrackId throws when full_cues declare no track_id at all", () => {
  const cueSheet = { full_cues: [{ cue_id: "A" }, { cue_id: "B" }] };
  assert.throws(() => extractRequiredTrackId(cueSheet, "full"), /does not declare a track_id/);
});

test("extractRequiredTrackId throws when full_cues reference more than one distinct track_id", () => {
  const cueSheet = {
    full_cues: [
      { cue_id: "A", track_id: "full_score_v1" },
      { cue_id: "B", track_id: "full_score_v2" }
    ]
  };
  assert.throws(() => extractRequiredTrackId(cueSheet, "full"), /more than one distinct track_id/);
});

test("extractRequiredTrackId rejects an invalid mode", () => {
  assert.throws(() => extractRequiredTrackId({}, "preview"), /mode must be "proof" or "full"/);
});
