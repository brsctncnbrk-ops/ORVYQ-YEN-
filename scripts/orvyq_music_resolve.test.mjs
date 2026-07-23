import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRequiredTrackId, extractFullCueTrackIds } from "./orvyq_music_resolve.mjs";

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
