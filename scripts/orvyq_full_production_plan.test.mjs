import { test } from "node:test";
import assert from "node:assert/strict";
import { kindFor, titleCase, locateClaimWindow, sliceClaimWindow, quantizeShotsToFrames, expandFootageAssignments } from "./orvyq_full_production_plan.mjs";
import { tokenizeWords } from "./lib/orvyq-pause-resolver.mjs";

// Mirrors buildCanonicalEditPlan's own cumulative frame assignment
// (scripts/orvyq_edit_plan.mjs) exactly: a single running float cursor,
// start/end frame read off it via Math.round(cursor * fps) at each shot
// boundary, never reset or corrected between shots.
function assignFrames(shots, fps, startCursor = 0) {
  let cursor = startCursor;
  return shots.map((shot) => {
    const start_frame = Math.round(cursor * fps);
    cursor += shot.duration;
    const end_frame = Math.round(cursor * fps);
    return { ...shot, start_frame, end_frame };
  });
}

function wordsFrom(text, secondsPerWord = 0.5) {
  return text.split(/\s+/).map((w, i) => ({ text: w, start: i * secondsPerWord, end: (i + 1) * secondsPerWord - 0.05 }));
}

test("kindFor maps known visual_treatment vocabulary and falls back to boundary for unknown values", () => {
  assert.equal(kindFor("evidence_mosaic"), "concept_map");
  assert.equal(kindFor("comparison_overlay"), "comparison");
  assert.equal(kindFor("something_never_seen"), "boundary");
});

test("titleCase strips the SEC_NN_ prefix and title-cases each word", () => {
  assert.equal(titleCase("SEC_01_RACE_PARADOX"), "Race Paradox");
  assert.equal(titleCase("SEC_09_FINAL_PARADOX"), "Final Paradox");
});

test("locateClaimWindow finds an exact contiguous quote", () => {
  const words = wordsFrom("Introductory filler words here. Not someday. Right now. Then it kept going for a good while longer past this point.");
  const tokens = tokenizeWords(words);
  const claim = { claim_id: "CLM_TEST", narration_excerpt: "Not someday. Right now." };
  const { matchStart, matchEnd, nextSearchTokenIndex } = locateClaimWindow(tokens, claim, 0);
  assert.ok(matchStart < matchEnd);
  assert.ok(nextSearchTokenIndex > 0);
});

test("locateClaimWindow falls back to bag-of-words matching for a reordered paraphrase", () => {
  const words = wordsFrom(
    "Established companies large and well funded may in practice be able to absorb the complex compliance and reporting costs more easily than smaller rivals. Then narration continues for quite a while after that point to give the scanner room."
  );
  const tokens = tokenizeWords(words);
  const claim = { claim_id: "CLM_TEST", narration_excerpt: "Compliance costs may be easier for established companies to absorb" };
  const { matchStart, matchEnd } = locateClaimWindow(tokens, claim, 0);
  assert.ok(matchStart < matchEnd);
});

test("locateClaimWindow throws when a claim cannot be located at all", () => {
  const words = wordsFrom("This narration is entirely unrelated to the claim text and shares no real words with it whatsoever.");
  const tokens = tokenizeWords(words);
  const claim = { claim_id: "CLM_TEST", narration_excerpt: "Quantum toaster hypnosis breakfast negotiation zeppelin" };
  assert.throws(() => locateClaimWindow(tokens, claim, 0), /could not be located/);
});

test("sliceClaimWindow splits a window into slices no longer than the max, with no rotation and no artificial duration variation", () => {
  const claim = { visual_treatment: { primary: "evidence_mosaic", secondary: "comparison_overlay", metaphor: "distributed_risk" } };
  const slices = sliceClaimWindow(claim, 0, 20, 8);
  assert.ok(slices.every((slice) => slice.end - slice.start <= 8 + 1e-9));
  const total = slices.reduce((sum, slice) => sum + (slice.end - slice.start), 0);
  assert.ok(Math.abs(total - 20) < 1e-9);
  // Every slice uses the claim's own primary visual_treatment -- there is no
  // evidence/context/metaphor rotation and no forced "boundary" kind.
  for (const slice of slices) assert.equal(slice.kind, "concept_map");
  // Interior slices are exactly equal (no DURATION_VARIATION_DELTA jitter).
  const interior = slices.slice(0, -1);
  for (const slice of interior) assert.equal(slice.end - slice.start, interior[0].end - interior[0].start);
  // Every slice's own 0-based array index is directly usable as a
  // FOOTAGE_ASSIGNMENTS[claim_id][sliceIndex] key -- there is no positional
  // restriction on which slice may carry a footage assignment (no
  // "footageCandidateSlot" field, no every-third-slice rule).
  assert.ok(!("footageCandidateSlot" in slices[0]));
});

test("sliceClaimWindow returns a single slice when the window already fits within the cap", () => {
  const claim = { visual_treatment: { primary: "evidence_mosaic", secondary: "comparison_overlay" } };
  const slices = sliceClaimWindow(claim, 10, 14, 8);
  assert.equal(slices.length, 1);
  assert.equal(slices[0].start, 10);
  assert.equal(slices[0].end, 14);
});

// expandFootageAssignments -- the direct replacement for the removed
// footageCandidateSlot/i%3 mechanism (task follow-up section 17): any slice
// index is addressable, and a single real clip may span several contiguous
// slices as one continuous, real-duration-verified pass instead of several
// separate uses.
test("expandFootageAssignments resolves a plain single-slice (span 1, default) assignment exactly as before", () => {
  const table = { CLM_TEST: { 2: { asset: "clip_a.mp4", trimInRatio: 0.5, motion: "hold", role: "context" } } };
  const sliceDurations = [6, 6, 6, 6];
  const expanded = expandFootageAssignments("CLM_TEST", sliceDurations, new Map([["clip_a.mp4", 20]]), table);
  assert.equal(expanded.size, 1);
  const entry = expanded.get(2);
  assert.equal(entry.asset, "clip_a.mp4");
  assert.equal(entry.trimInSec, 10); // 0.5 * 20, well under the 20 - 6 - 0.3 clamp
  assert.equal(entry.trimOutSec, 16);
});

test("expandFootageAssignments spans multiple contiguous slices with one continuous, contiguous trim", () => {
  const table = { CLM_TEST: { 1: { asset: "clip_a.mp4", trimInRatio: 0.1, span: 3, motion: "hold", role: "context" } } };
  const sliceDurations = [5, 5, 5, 5, 5];
  const expanded = expandFootageAssignments("CLM_TEST", sliceDurations, new Map([["clip_a.mp4", 30]]), table);
  assert.deepEqual([...expanded.keys()].sort(), [1, 2, 3]);
  const first = expanded.get(1);
  const second = expanded.get(2);
  const third = expanded.get(3);
  assert.equal(first.trimInSec, 3); // 0.1 * 30
  assert.equal(first.trimOutSec, 8); // + 5
  // Each subsequent slice's trim_in picks up exactly where the previous
  // one's trim_out left off -- true contiguity, not just "same asset".
  assert.equal(second.trimInSec, first.trimOutSec);
  assert.equal(second.trimOutSec, 13);
  assert.equal(third.trimInSec, second.trimOutSec);
  assert.equal(third.trimOutSec, 18);
});

test("expandFootageAssignments throws rather than silently overrunning a span past the clip's own real duration", () => {
  const table = { CLM_TEST: { 0: { asset: "clip_a.mp4", trimInRatio: 0.5, span: 2, motion: "hold", role: "context" } } };
  const sliceDurations = [7, 7];
  assert.throws(() => expandFootageAssignments("CLM_TEST", sliceDurations, new Map([["clip_a.mp4", 10]]), table), /overruns that real duration/);
});

test("expandFootageAssignments throws when a span reaches past the claim's own last slice", () => {
  const table = { CLM_TEST: { 0: { asset: "clip_a.mp4", trimInRatio: 0, span: 5, motion: "hold", role: "context" } } };
  const sliceDurations = [5, 5];
  assert.throws(() => expandFootageAssignments("CLM_TEST", sliceDurations, new Map([["clip_a.mp4", 100]]), table), /does not exist/);
});

test("expandFootageAssignments throws when two declared assignments both cover the same slice", () => {
  const table = { CLM_TEST: { 0: { asset: "clip_a.mp4", trimInRatio: 0, span: 2, motion: "hold", role: "context" }, 1: { asset: "clip_b.mp4", trimInRatio: 0, motion: "hold", role: "context" } } };
  const sliceDurations = [5, 5];
  const durations = new Map([["clip_a.mp4", 100], ["clip_b.mp4", 100]]);
  assert.throws(() => expandFootageAssignments("CLM_TEST", sliceDurations, durations, table), /more than one footage assignment/);
});

test("expandFootageAssignments returns an empty map for a claim with no declared assignments", () => {
  const expanded = expandFootageAssignments("CLM_NOT_IN_TABLE", [5, 5], new Map(), {});
  assert.equal(expanded.size, 0);
});

// Regression test for the "shot_XXX lacks evidence hierarchy"-adjacent proof
// failure: scripts/orvyq_edit_plan_tests.mjs asserts a footage shot's
// trim_out_sec - trim_in_sec matches its real frame-quantized on-screen
// length within 0.02s. Before quantizeShotsToFrames, a shot's own float
// `duration` could drift from that frame-quantized length by up to a full
// frame once cumulative Math.round(cursor * fps) rounding compounds across
// 100+ shots -- reproduced here with irregular real-world-shaped floats
// deliberately chosen to land near a frame boundary.
test("quantizeShotsToFrames: footage trims match their real frame-quantized on-screen length, even after 100+ shots of cumulative drift", () => {
  const fps = 30;
  const durations = [];
  for (let i = 0; i < 120; i += 1) durations.push(6.1 + ((i * 37) % 23) / 100);
  const shots = durations.map((duration, i) => ({
    asset_type: i % 3 === 2 ? "footage" : "evidence",
    duration,
    ...(i % 3 === 2 ? { trim_in_sec: (i * 1.7) % 40, trim_out_sec: (i * 1.7) % 40 + duration } : {})
  }));

  quantizeShotsToFrames(shots, fps);
  const withFrames = assignFrames(shots, fps, 11.3 /* a non-frame-exact starting cursor, like a real hookDuration */);

  for (const shot of withFrames) {
    if (shot.asset_type !== "footage") continue;
    const seconds = (shot.end_frame - shot.start_frame) / fps;
    const diff = Math.abs(shot.trim_out_sec - shot.trim_in_sec - seconds);
    assert.ok(diff < 0.001, `footage trim drifted ${diff}s from its real on-screen length`);
  }
});

test("quantizeShotsToFrames: leaves an already frame-exact duration and its footage trim unchanged (beyond millisecond rounding)", () => {
  const shots = [{ asset_type: "footage", duration: 6, trim_in_sec: 2, trim_out_sec: 8 }];
  quantizeShotsToFrames(shots, 30);
  assert.equal(shots[0].duration, 6);
  assert.equal(shots[0].trim_out_sec, 8);
});
