import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyApprovalRecord } from "./orvyq_verify_approval.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";

test("verifyApprovalRecord requires a full-mode candidate for a full-mode check", async () => {
  const result = await verifyApprovalRecord(PROJECT_ID, { expectedMode: "full", currentCommitSha: null });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((f) => f.includes('required "full"')));
});

test("verifyApprovalRecord accepts the committed candidate's own mode when checked against itself", async () => {
  // Regardless of the hash-drift finding below, mode-matching in isolation
  // must not itself produce a false failure for the mode the candidate
  // actually declares.
  const result = await verifyApprovalRecord(PROJECT_ID, { expectedMode: "proof", currentCommitSha: null });
  assert.ok(!result.failures.some((f) => f.includes("is not the required")));
});

test("verifyApprovalRecord detects that the committed frozen_candidate.json no longer matches the approved hash", async () => {
  // Real, currently-existing drift in this repo's own history: a later
  // proof run (workflow 29924729353) overwrote qa/frozen_candidate.json
  // after qa/proof_approval.json's frozen_candidate_hash had already been
  // recorded against the earlier, approved run (29921936297). This is
  // exactly the case the old `approved === true`-only check would have
  // missed.
  const result = await verifyApprovalRecord(PROJECT_ID, { expectedMode: "proof", currentCommitSha: null });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((f) => f.includes("does not match the sha256")));
});
