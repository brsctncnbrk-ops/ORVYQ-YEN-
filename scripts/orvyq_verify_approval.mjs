#!/usr/bin/env node
// verifyApprovalRecord() / verifyFrozenCandidateFreshness() -- the gate a
// render (review or final) must pass before it's allowed to proceed.
//
// Approval identity model (task follow-up section 5): an approval is valid
// for a candidate if and only if candidate_hash + render_bundle_hash +
// candidate_source_sha all match the frozen candidate's own values. It is
// NOT gated on the current git HEAD SHA equaling the candidate's
// source_commit_sha -- that equality is what broke this in practice: the
// review workflow commits the frozen candidate, then a human approves it in
// a SEPARATE later commit, so by the time the final workflow runs, HEAD has
// moved past the commit the candidate was built from even though the
// candidate itself never changed. candidate_source_sha is carried as data
// (the source commit the candidate was actually built from) and compared
// for CONSISTENCY between the approval and the candidate, never against
// "whatever commit happens to be checked out right now."
//
// This replaces the earlier, stricter check (docs/canonical-candidate-audit.md):
// this repo's own history had a later proof run silently replace
// frozen_candidate.json without a matching new approval -- verifyApprovalRecord
// still catches exactly that, just via candidate_hash instead of a whole-file
// hash (which broke the moment created_at moved into operational_metadata,
// since a whole-file hash would change on every rebuild regardless of any
// real content change).
import path from "node:path";
import { projectDir, readJson, pathExists, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { computeCanonicalFrozenCandidate } from "./orvyq_frozen_candidate.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";

// Stage 1 (cheap, runs before any build step): confirms the approval on file
// still names the candidate actually committed at HEAD, for the right mode.
// Does NOT require direction/edit_plan.json, captions, the audio mix, or the
// asset registry to exist yet -- those are gitignored, pipeline-generated
// build outputs that don't exist until later steps run.
export async function verifyApprovalRecord(projectId = PROJECT_ID, { expectedMode = "full", approvedReviewRunId = null, actualReviewVideoSha256 = null } = {}) {
  const dir = projectDir(projectId);
  const approvalPath = path.join(dir, "qa", "proof_approval.json");
  const candidatePath = path.join(dir, "qa", "frozen_candidate.json");
  const failures = [];

  if (!(await pathExists(approvalPath)))
    return { pass: false, failures: ["No qa/proof_approval.json is committed -- render is blocked until a human approves a specific frozen candidate (schemas/proof_approval.schema.json)."] };
  if (!(await pathExists(candidatePath)))
    return { pass: false, failures: ["No qa/frozen_candidate.json is committed."] };

  const approval = await readJson(approvalPath);
  const storedCandidate = await readJson(candidatePath);
  const identity = storedCandidate.canonical_candidate_identity;

  if (approval.approved !== true) failures.push("qa/proof_approval.json.approved is not true.");

  if (!identity) {
    failures.push("qa/frozen_candidate.json has no canonical_candidate_identity -- it predates candidate-identity hardening and cannot be verified under the current model.");
    return { pass: false, failures, approval, storedCandidate };
  }

  if (!approval.candidate_hash) {
    failures.push("qa/proof_approval.json has no candidate_hash -- it predates candidate-identity hardening (see candidate_hash/render_bundle_hash/candidate_source_sha) and cannot approve a live candidate.");
  } else if (approval.candidate_hash !== storedCandidate.candidate_hash) {
    failures.push(
      `qa/proof_approval.json.candidate_hash (${approval.candidate_hash}) does not match the currently committed qa/frozen_candidate.json's own candidate_hash ` +
        `(${storedCandidate.candidate_hash}) -- the frozen candidate has changed (or been replaced) since this approval was recorded; the approval no longer covers what is on disk.`
    );
  }

  if (approval.render_bundle_hash && approval.render_bundle_hash !== storedCandidate.render_bundle_hash) {
    failures.push(`qa/proof_approval.json.render_bundle_hash (${approval.render_bundle_hash}) does not match the frozen candidate's render_bundle_hash (${storedCandidate.render_bundle_hash}).`);
  }

  // Consistency check ONLY -- this is deliberately NOT compared against the
  // current git HEAD. A commit that only adds/updates the approval record
  // (or any other metadata-only commit) moves HEAD without changing the
  // candidate the approval is about, and must never invalidate it.
  if (approval.candidate_source_sha && identity.source_commit_sha && approval.candidate_source_sha !== identity.source_commit_sha) {
    failures.push(
      `qa/proof_approval.json.candidate_source_sha (${approval.candidate_source_sha}) does not match qa/frozen_candidate.json's own source_commit_sha (${identity.source_commit_sha}) -- ` +
        "this approval was recorded against a different candidate build."
    );
  }

  if (identity.mode !== expectedMode)
    failures.push(`qa/frozen_candidate.json's mode is "${identity.mode}", not the required "${expectedMode}" -- no ${expectedMode}-mode candidate has been approved yet.`);

  // Task section 18: approval must belong to the FULL-LENGTH review
  // candidate, not a partial/short cut.
  if (Number.isFinite(approval.review_total_frames) && Number.isFinite(identity.total_frames) && approval.review_total_frames !== identity.total_frames) {
    failures.push(
      `qa/proof_approval.json.review_total_frames (${approval.review_total_frames}) does not equal the frozen candidate's own total_frames (${identity.total_frames}) -- ` +
        "only a review covering the full candidate can be approved; a partial-duration review cannot stand in for it."
    );
  }

  // The final workflow's own approved_review_run_id input (task section 5,
  // last rule) must name the exact review run the approval references.
  if (approvedReviewRunId && approval.review_run_id && approval.review_run_id !== String(approvedReviewRunId)) {
    failures.push(`qa/proof_approval.json.review_run_id (${approval.review_run_id}) does not match the run id given to this workflow (${approvedReviewRunId}).`);
  }

  // The actual downloaded review MP4's sha256 (computed by the caller from
  // the real file) must match what was approved -- catches a review
  // artifact that was silently replaced/re-uploaded after approval.
  if (actualReviewVideoSha256 && approval.review_video_sha256 && approval.review_video_sha256 !== actualReviewVideoSha256) {
    failures.push(`qa/proof_approval.json.review_video_sha256 (${approval.review_video_sha256}) does not match the actual review artifact's sha256 (${actualReviewVideoSha256}).`);
  }

  return { pass: failures.length === 0, failures, approval, storedCandidate };
}

// Stage 2 (runs after the render bundle has been placed/assembled, right
// before rendering): recomputes a frozen candidate from those real files and
// confirms candidate_hash/render_bundle_hash still match the committed,
// approved candidate exactly -- proving what is about to render is the same
// bytes a human actually reviewed, not something silently regenerated
// differently in between. Reports which specific identity field first
// diverged, for diagnostics, even though the pass/fail decision is made on
// the hash alone.
export async function verifyFrozenCandidateFreshness(projectId = PROJECT_ID, { renderReadyDir } = {}) {
  const dir = projectDir(projectId);
  const candidatePath = path.join(dir, "qa", "frozen_candidate.json");
  const storedCandidate = await readJson(candidatePath);
  const fresh = await computeCanonicalFrozenCandidate(projectId, { renderReadyDir });
  const failures = [];

  if (fresh.candidate_hash !== storedCandidate.candidate_hash) {
    failures.push(`qa/frozen_candidate.json.candidate_hash (${storedCandidate.candidate_hash}) no longer matches what the current real project files produce (${fresh.candidate_hash}).`);
    const storedIdentity = storedCandidate.canonical_candidate_identity || {};
    const freshIdentity = fresh.canonical_candidate_identity || {};
    const allFields = new Set([...Object.keys(storedIdentity), ...Object.keys(freshIdentity)]);
    for (const field of allFields) {
      if (JSON.stringify(storedIdentity[field]) !== JSON.stringify(freshIdentity[field])) {
        failures.push(`  - canonical_candidate_identity.${field}: stored=${JSON.stringify(storedIdentity[field])} fresh=${JSON.stringify(freshIdentity[field])}`);
      }
    }
  }
  if (fresh.render_bundle_hash !== storedCandidate.render_bundle_hash) {
    failures.push(`qa/frozen_candidate.json.render_bundle_hash (${storedCandidate.render_bundle_hash}) no longer matches the current real render bundle (${fresh.render_bundle_hash}).`);
  }

  return { pass: failures.length === 0, failures, fresh, storedCandidate };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const stage = args.stage || "early";
  const run =
    stage === "late"
      ? verifyFrozenCandidateFreshness(args["project-id"] || PROJECT_ID, { renderReadyDir: args["render-ready-dir"] || undefined })
      : verifyApprovalRecord(args["project-id"] || PROJECT_ID, { expectedMode: args.mode || "full", approvedReviewRunId: args["approved-review-run-id"] || null });
  run
    .then((result) => {
      printJson(result);
      if (!result.pass) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
