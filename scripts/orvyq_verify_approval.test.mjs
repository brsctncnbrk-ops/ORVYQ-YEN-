import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PROJECTS_DIR } from "./lib/fs-utils.mjs";
import { computeCanonicalFrozenCandidate, sha256OfJson } from "./orvyq_frozen_candidate.mjs";
import { verifyApprovalRecord } from "./orvyq_verify_approval.mjs";

const FIXTURE_PROJECT_ID = "998-verify-approval-fixture";
const FIXTURE_DIR = path.join(PROJECTS_DIR, FIXTURE_PROJECT_ID);

async function writeFixtureProject({ shotCount = 1, finalMixDuration = 30 } = {}) {
  await fs.mkdir(path.join(FIXTURE_DIR, "direction"), { recursive: true });
  await fs.mkdir(path.join(FIXTURE_DIR, "remotion"), { recursive: true });
  await fs.mkdir(path.join(FIXTURE_DIR, "assets", "audio"), { recursive: true });
  const shots = Array.from({ length: shotCount }, (_, i) => ({ shot_id: `shot_${i}` }));
  await fs.writeFile(
    path.join(FIXTURE_DIR, "direction", "edit_plan.json"),
    JSON.stringify({ fps: 30, duration_frames: 900, frame_range: { start_frame: 0, end_frame: 900 }, mode: "full", shots })
  );
  await fs.writeFile(path.join(FIXTURE_DIR, "remotion", "captions.json"), JSON.stringify({ captions: [] }));
  await fs.writeFile(path.join(FIXTURE_DIR, "assets", "audio", "final_mix.metadata.json"), JSON.stringify({ duration_seconds: finalMixDuration }));
  await fs.writeFile(path.join(FIXTURE_DIR, "assets", "asset_registry.json"), JSON.stringify({ schema_version: "1.0-canonical", project_id: FIXTURE_PROJECT_ID, assets: [] }));
}

async function writeFrozenCandidate(candidate) {
  await fs.mkdir(path.join(FIXTURE_DIR, "qa"), { recursive: true });
  await fs.writeFile(path.join(FIXTURE_DIR, "qa", "frozen_candidate.json"), JSON.stringify(candidate, null, 2));
}

async function writeApproval(approval) {
  await fs.mkdir(path.join(FIXTURE_DIR, "qa"), { recursive: true });
  await fs.writeFile(path.join(FIXTURE_DIR, "qa", "proof_approval.json"), JSON.stringify(approval, null, 2));
}

function approvalFor(candidate, overrides = {}) {
  return {
    approved: true,
    approved_by: "brsctncnbrk@gmail.com",
    approved_at: "2026-07-24T00:00:00Z",
    candidate_hash: candidate.candidate_hash,
    candidate_source_sha: candidate.canonical_candidate_identity.source_commit_sha,
    render_bundle_hash: candidate.render_bundle_hash,
    review_run_id: "30061057489",
    review_artifact_name: "orvyq-full-length-review-30061057489",
    review_total_frames: candidate.canonical_candidate_identity.total_frames,
    review_duration_seconds: 857.29,
    review_resolution: "1280x720",
    review_video_sha256: "3".repeat(64),
    ...overrides
  };
}

test("1. candidate produced, then ONLY an approval-record commit is added afterward -> PASS (no HEAD-SHA dependency)", async (t) => {
  await writeFixtureProject();
  t.after(() => fs.rm(FIXTURE_DIR, { recursive: true, force: true }));
  const candidate = await computeCanonicalFrozenCandidate(FIXTURE_PROJECT_ID);
  await writeFrozenCandidate(candidate);
  await writeApproval(approvalFor(candidate));

  // Simulate "HEAD has moved on" by passing a currentCommitSha-like concept
  // that is deliberately NOT checked anymore -- verifyApprovalRecord takes
  // no such parameter at all now, which is the fix itself: nothing here
  // depends on the current git HEAD.
  const result = await verifyApprovalRecord(FIXTURE_PROJECT_ID, { expectedMode: "full" });
  assert.equal(result.pass, true, result.failures.join("; "));
});

test("2. edit plan changes after approval -> FAIL", async (t) => {
  await writeFixtureProject();
  t.after(() => fs.rm(FIXTURE_DIR, { recursive: true, force: true }));
  const candidate = await computeCanonicalFrozenCandidate(FIXTURE_PROJECT_ID);
  await writeFrozenCandidate(candidate);
  await writeApproval(approvalFor(candidate));

  // Edit plan changes for real, then a NEW frozen candidate is computed and
  // committed WITHOUT a matching new approval (the failure mode itself).
  await writeFixtureProject({ shotCount: 2 });
  const changedCandidate = await computeCanonicalFrozenCandidate(FIXTURE_PROJECT_ID);
  await writeFrozenCandidate(changedCandidate);

  const result = await verifyApprovalRecord(FIXTURE_PROJECT_ID, { expectedMode: "full" });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((f) => f.includes("candidate_hash")));
});

test("3. final mix changes after approval -> FAIL", async (t) => {
  await writeFixtureProject({ finalMixDuration: 30 });
  t.after(() => fs.rm(FIXTURE_DIR, { recursive: true, force: true }));
  const candidate = await computeCanonicalFrozenCandidate(FIXTURE_PROJECT_ID);
  await writeFrozenCandidate(candidate);
  await writeApproval(approvalFor(candidate));

  await writeFixtureProject({ finalMixDuration: 45 });
  const changedCandidate = await computeCanonicalFrozenCandidate(FIXTURE_PROJECT_ID);
  await writeFrozenCandidate(changedCandidate);

  const result = await verifyApprovalRecord(FIXTURE_PROJECT_ID, { expectedMode: "full" });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((f) => f.includes("candidate_hash")));
});

test("4. an asset (registry) changes after approval -> FAIL", async (t) => {
  await writeFixtureProject();
  t.after(() => fs.rm(FIXTURE_DIR, { recursive: true, force: true }));
  const candidate = await computeCanonicalFrozenCandidate(FIXTURE_PROJECT_ID);
  await writeFrozenCandidate(candidate);
  await writeApproval(approvalFor(candidate));

  await fs.writeFile(path.join(FIXTURE_DIR, "x.mp4"), "fake video bytes");
  await fs.writeFile(
    path.join(FIXTURE_DIR, "assets", "asset_registry.json"),
    JSON.stringify({ schema_version: "1.0-canonical", project_id: FIXTURE_PROJECT_ID, assets: [{ asset_id: "a1", type: "footage", path: "x.mp4", source: "s", license: "l", sha256: "0".repeat(64) }] })
  );
  const changedCandidate = await computeCanonicalFrozenCandidate(FIXTURE_PROJECT_ID);
  await writeFrozenCandidate(changedCandidate);

  const result = await verifyApprovalRecord(FIXTURE_PROJECT_ID, { expectedMode: "full" });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((f) => f.includes("candidate_hash")));
});

test("5. review run ID mismatch (final workflow input vs approval record) -> FAIL", async (t) => {
  await writeFixtureProject();
  t.after(() => fs.rm(FIXTURE_DIR, { recursive: true, force: true }));
  const candidate = await computeCanonicalFrozenCandidate(FIXTURE_PROJECT_ID);
  await writeFrozenCandidate(candidate);
  await writeApproval(approvalFor(candidate, { review_run_id: "30061057489" }));

  const result = await verifyApprovalRecord(FIXTURE_PROJECT_ID, { expectedMode: "full", approvedReviewRunId: "99999999999" });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((f) => f.includes("review_run_id")));
});

test("6. review artifact SHA mismatch -> FAIL", async (t) => {
  await writeFixtureProject();
  t.after(() => fs.rm(FIXTURE_DIR, { recursive: true, force: true }));
  const candidate = await computeCanonicalFrozenCandidate(FIXTURE_PROJECT_ID);
  await writeFrozenCandidate(candidate);
  await writeApproval(approvalFor(candidate, { review_video_sha256: "3".repeat(64) }));

  const result = await verifyApprovalRecord(FIXTURE_PROJECT_ID, { expectedMode: "full", actualReviewVideoSha256: "4".repeat(64) });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((f) => f.includes("review_video_sha256")));
});

test("7. a DIFFERENT candidate's approval record is used -> FAIL", async (t) => {
  await writeFixtureProject();
  t.after(() => fs.rm(FIXTURE_DIR, { recursive: true, force: true }));
  const candidate = await computeCanonicalFrozenCandidate(FIXTURE_PROJECT_ID);
  await writeFrozenCandidate(candidate);

  // Approval for a wholly unrelated, fabricated candidate.
  await writeApproval(
    approvalFor({
      candidate_hash: sha256OfJson({ not: "the-real-candidate" }),
      render_bundle_hash: sha256OfJson({ not: "the-real-bundle" }),
      canonical_candidate_identity: { source_commit_sha: "f".repeat(40), total_frames: 12345 }
    })
  );

  const result = await verifyApprovalRecord(FIXTURE_PROJECT_ID, { expectedMode: "full" });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((f) => f.includes("candidate_hash")));
});

test("approving before candidate-identity hardening (no canonical_candidate_identity) fails clearly rather than crashing", async (t) => {
  await writeFixtureProject();
  t.after(() => fs.rm(FIXTURE_DIR, { recursive: true, force: true }));
  await writeFrozenCandidate({ project_id: FIXTURE_PROJECT_ID, source_commit_sha: "0".repeat(40), mode: "full", created_at: "2026-01-01T00:00:00Z" });
  await writeApproval({ approved: true, frozen_candidate_hash: "1".repeat(64), approved_at: "2026-01-01T00:00:00Z" });

  const result = await verifyApprovalRecord(FIXTURE_PROJECT_ID, { expectedMode: "full" });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((f) => f.includes("predates candidate-identity hardening")));
});

test("wrong mode fails", async (t) => {
  await writeFixtureProject();
  t.after(() => fs.rm(FIXTURE_DIR, { recursive: true, force: true }));
  const candidate = await computeCanonicalFrozenCandidate(FIXTURE_PROJECT_ID);
  await writeFrozenCandidate(candidate);
  await writeApproval(approvalFor(candidate));

  const result = await verifyApprovalRecord(FIXTURE_PROJECT_ID, { expectedMode: "review-only-mode-that-never-matches" });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((f) => f.includes('required "review-only-mode-that-never-matches"')));
});

test("a partial-duration review (review_total_frames < candidate total_frames) fails", async (t) => {
  await writeFixtureProject();
  t.after(() => fs.rm(FIXTURE_DIR, { recursive: true, force: true }));
  const candidate = await computeCanonicalFrozenCandidate(FIXTURE_PROJECT_ID);
  await writeFrozenCandidate(candidate);
  await writeApproval(approvalFor(candidate, { review_total_frames: 100 }));

  const result = await verifyApprovalRecord(FIXTURE_PROJECT_ID, { expectedMode: "full" });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((f) => f.includes("review_total_frames")));
});
