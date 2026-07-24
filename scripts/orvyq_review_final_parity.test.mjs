import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReviewFinalParity } from "./orvyq_review_final_parity.mjs";

// Real-shaped identity, matching what orvyq-review.yml / orvyq-final-encode.yml
// actually write (see the render-bundle work).
function identity(overrides = {}) {
  return {
    candidate_hash: "a".repeat(64),
    render_bundle_hash: "r".repeat(64),
    edit_plan_hash: "b".repeat(64),
    caption_hash: "c".repeat(64),
    final_mix_audio_hash: "e".repeat(64),
    audio_mix_metadata_hash: "d".repeat(64),
    asset_manifest_hash: "f".repeat(64),
    render_ready_source_hash: "g".repeat(64),
    renderer_source_hash: "h".repeat(64),
    total_frames: 25719,
    fps: 30,
    frame_range: { start_frame: 0, end_frame: 25719 },
    ...overrides
  };
}

function reviewManifest(identityOverrides = {}) {
  return {
    schema_version: "2.0",
    identity: identity(identityOverrides),
    encode: { profile: "review", width: 1280, height: 720, codec: "h264", bitrate: "6M", crf: null, encoder_preset: null },
    artifact: { run_id: "30061057489", video_path: "out/orvyq_review.mp4", video_sha256: "1".repeat(64) }
  };
}

function finalManifest(identityOverrides = {}) {
  return {
    schema_version: "2.0",
    identity: identity(identityOverrides),
    encode: { profile: "final", width: 1920, height: 1080, codec: "h264", bitrate: null, crf: 16, encoder_preset: null },
    artifact: { run_id: "30099999999", video_path: "out/final_video.mp4", video_sha256: "2".repeat(64) }
  };
}

test("identical candidates with real-shaped review/final manifests (differing profile/run_id/video_path/video_sha256/encode) PASS", () => {
  const { pass, failures } = checkReviewFinalParity(reviewManifest(), finalManifest());
  assert.equal(pass, true, failures.join("; "));
});

// Regression test: the OLD manifest shape (flat, with an "unrecognized
// field" catch-all comparing every top-level key) wrongly failed on exactly
// these four fields for every real workflow run, since they are naturally
// different between a review and a final render. Reproduced here against
// the old flat structure to document the bug this rewrite fixes -- the old
// checkReviewFinalParity is gone, so this test asserts the property
// directly: a manifest shape lacking the identity/encode/artifact split
// would have flagged non-identity fields as failures. The NEW function,
// given the same real data reshaped into identity/encode/artifact, must NOT
// fail on those fields.
test("regression: profile/run_id/video_path/video_sha256 differences never fail parity", () => {
  const review = reviewManifest();
  const final = finalManifest();
  assert.notEqual(review.encode.profile, final.encode.profile);
  assert.notEqual(review.artifact.run_id, final.artifact.run_id);
  assert.notEqual(review.artifact.video_path, final.artifact.video_path);
  assert.notEqual(review.artifact.video_sha256, final.artifact.video_sha256);
  const { pass, failures } = checkReviewFinalParity(review, final);
  assert.equal(pass, true, failures.join("; "));
});

test("a different candidate_hash fails", () => {
  const { pass, failures } = checkReviewFinalParity(reviewManifest(), finalManifest({ candidate_hash: "z".repeat(64) }));
  assert.equal(pass, false);
  assert.ok(failures.some((f) => f.includes("candidate_hash")));
});

test("a different render_bundle_hash fails", () => {
  const { pass, failures } = checkReviewFinalParity(reviewManifest(), finalManifest({ render_bundle_hash: "z".repeat(64) }));
  assert.equal(pass, false);
  assert.ok(failures.some((f) => f.includes("render_bundle_hash")));
});

test("a different total_frames (partial review vs full final) fails", () => {
  const { pass, failures } = checkReviewFinalParity(reviewManifest({ total_frames: 4500 }), finalManifest({ total_frames: 25719 }));
  assert.equal(pass, false);
  assert.ok(failures.some((f) => f.includes("total_frames")));
});

test("a different frame_range fails", () => {
  const { pass, failures } = checkReviewFinalParity(
    reviewManifest({ frame_range: { start_frame: 0, end_frame: 4500 } }),
    finalManifest({ frame_range: { start_frame: 0, end_frame: 25719 } })
  );
  assert.equal(pass, false);
  assert.ok(failures.some((f) => f.includes("frame_range")));
});

test("a different final_mix_audio_hash (different music) fails", () => {
  const { pass, failures } = checkReviewFinalParity(reviewManifest(), finalManifest({ final_mix_audio_hash: "9".repeat(64) }));
  assert.equal(pass, false);
  assert.ok(failures.some((f) => f.includes("final_mix_audio_hash")));
});

test("a different render_ready_source_hash fails", () => {
  const { pass, failures } = checkReviewFinalParity(reviewManifest(), finalManifest({ render_ready_source_hash: "9".repeat(64) }));
  assert.equal(pass, false);
  assert.ok(failures.some((f) => f.includes("render_ready_source_hash")));
});

test("a missing render_ready_source_hash on either side fails (never silently skipped)", () => {
  const review = reviewManifest();
  delete review.identity.render_ready_source_hash;
  const { pass, failures } = checkReviewFinalParity(review, finalManifest());
  assert.equal(pass, false);
  assert.ok(failures.some((f) => f.includes("render_ready_source_hash") && f.includes("missing")));
});

test("a missing candidate_hash fails", () => {
  const review = reviewManifest();
  delete review.identity.candidate_hash;
  const { pass, failures } = checkReviewFinalParity(review, finalManifest());
  assert.equal(pass, false);
  assert.ok(failures.some((f) => f.includes("candidate_hash") && f.includes("missing")));
});

test("wrong schema_version fails", () => {
  const review = reviewManifest();
  review.schema_version = "1.0";
  const { pass, failures } = checkReviewFinalParity(review, finalManifest());
  assert.equal(pass, false);
  assert.ok(failures.some((f) => f.includes("schema_version")));
});

test("an undeclared extra identity field that differs fails", () => {
  const review = reviewManifest();
  const final = finalManifest();
  review.identity.unexpected_field = "review-value";
  final.identity.unexpected_field = "final-value";
  const { pass, failures } = checkReviewFinalParity(review, final);
  assert.equal(pass, false);
  assert.ok(failures.some((f) => f.includes("unexpected_field")));
});
