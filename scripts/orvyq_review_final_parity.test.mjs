import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReviewFinalParity } from "./orvyq_review_final_parity.mjs";

function manifest(overrides = {}) {
  return {
    candidate_hash: "a".repeat(64),
    edit_plan_hash: "b".repeat(64),
    caption_hash: "c".repeat(64),
    audio_mix_hash: "d".repeat(64),
    final_mix_audio_hash: "e".repeat(64),
    asset_registry_hash: "f".repeat(64),
    total_frames: 25719,
    fps: 30,
    frame_range: { start_frame: 0, end_frame: 25719 },
    composition_props: { width: 1920, height: 1080 },
    width: 1280,
    height: 720,
    codec: "h264",
    bitrate: "6M",
    ...overrides
  };
}

test("identical candidates differing only in encode profile pass", () => {
  const review = manifest({ width: 1280, height: 720, bitrate: "6M" });
  const final = manifest({ width: 1920, height: 1080, bitrate: "16M" });
  const { pass } = checkReviewFinalParity(review, final);
  assert.equal(pass, true);
});

test("a different candidate_hash fails", () => {
  const review = manifest();
  const final = manifest({ candidate_hash: "z".repeat(64) });
  const { pass, failures } = checkReviewFinalParity(review, final);
  assert.equal(pass, false);
  assert.ok(failures.some((f) => f.includes("candidate_hash")));
});

test("a different total_frames (partial review vs full final) fails", () => {
  const review = manifest({ total_frames: 4500 });
  const final = manifest({ total_frames: 25719 });
  const { pass, failures } = checkReviewFinalParity(review, final);
  assert.equal(pass, false);
  assert.ok(failures.some((f) => f.includes("total_frames")));
});

test("a different frame_range fails", () => {
  const review = manifest({ frame_range: { start_frame: 0, end_frame: 4500 } });
  const final = manifest({ frame_range: { start_frame: 0, end_frame: 25719 } });
  const { pass, failures } = checkReviewFinalParity(review, final);
  assert.equal(pass, false);
  assert.ok(failures.some((f) => f.includes("frame_range")));
});

test("a different final_mix_audio_hash (different music) fails", () => {
  const review = manifest();
  const final = manifest({ final_mix_audio_hash: "9".repeat(64) });
  const { pass, failures } = checkReviewFinalParity(review, final);
  assert.equal(pass, false);
  assert.ok(failures.some((f) => f.includes("final_mix_audio_hash")));
});
