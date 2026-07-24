#!/usr/bin/env node
// verifyApprovalRecord() / verifyFrozenCandidateFreshness() -- replaces the
// golden defect in orvyq-full-render.yml's own gate, which only ever checked
// `require(qa/proof_approval.json).approved === true`. That check passes
// even when the frozen_candidate the approval references has since been
// replaced, or when the project files a candidate's hashes describe have
// since changed. This is not a hypothetical: this repo's own history has it
// happen for real -- proof_approval.json's frozen_candidate_hash
// (cb5346cb...) was recorded against the frozen_candidate.json committed by
// workflow run 29921936297 (git commit b448869), but a LATER proof run
// (29924729353, commit 36540fe) overwrote qa/frozen_candidate.json with a
// different candidate (different source_commit_sha, edit_plan_hash,
// asset_registry_hash) without a matching new approval. Under the old
// approved===true-only check, a full render gated on that file would have
// silently passed anyway. verifyApprovalRecord() below catches exactly this.
import path from "node:path";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { projectDir, readJson, pathExists, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { computeCanonicalFrozenCandidate } from "./orvyq_frozen_candidate.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const FRESHNESS_FIELDS = ["edit_plan_hash", "caption_hash", "audio_mix_hash", "asset_registry_hash", "timeline_hash", "renderer_version"];
const OPTIONAL_HARDENED_FIELDS = [
  "renderer_commit_sha",
  "narration_sha256",
  "pause_map_hash",
  "script_hash",
  "final_mix_audio_hash",
  "music_bed_hash",
  "remotion_scene_config_hash",
  "remotion_asset_map_hash",
  "renderer_package_lock_hash",
  "renderer_source_tree_hash",
  "asset_manifest_hash"
];

async function sha256OfFile(absPath) {
  return createHash("sha256").update(await fs.readFile(absPath)).digest("hex");
}

function resolveCurrentCommitSha() {
  return process.env.GITHUB_SHA || null;
}

// Stage 1 (cheap, runs before any build step): confirms the approval on file
// still names the candidate actually committed at HEAD, for the right mode
// and commit. Does NOT require direction/edit_plan.json, captions, the
// audio mix, or the asset registry to exist yet -- those are gitignored,
// pipeline-generated build outputs that don't exist until later steps run.
export async function verifyApprovalRecord(projectId = PROJECT_ID, { expectedMode = "full", currentCommitSha = resolveCurrentCommitSha() } = {}) {
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

  if (approval.approved !== true) failures.push("qa/proof_approval.json.approved is not true.");

  const storedCandidateFileHash = await sha256OfFile(candidatePath);
  if (storedCandidateFileHash !== approval.frozen_candidate_hash) {
    failures.push(
      `qa/proof_approval.json.frozen_candidate_hash (${approval.frozen_candidate_hash}) does not match the sha256 of the currently committed ` +
        `qa/frozen_candidate.json (${storedCandidateFileHash}) -- the frozen candidate has been replaced since this approval was recorded; ` +
        "the approval no longer covers what is on disk."
    );
  }

  if (storedCandidate.mode !== expectedMode)
    failures.push(`qa/frozen_candidate.json.mode is "${storedCandidate.mode}", not the required "${expectedMode}" -- no ${expectedMode}-mode candidate has been approved yet.`);

  if (currentCommitSha && storedCandidate.source_commit_sha !== currentCommitSha)
    failures.push(`qa/frozen_candidate.json.source_commit_sha (${storedCandidate.source_commit_sha}) does not match the commit being verified (${currentCommitSha}).`);

  // Task section 18: approval must belong to the FULL-LENGTH review
  // candidate, not a partial/short cut. Checked only when the approval
  // actually declares review_total_frames (the new field) -- a historical
  // approval recorded before this hardening has neither this field nor any
  // claim to be a full-length review, and is already correctly rejected by
  // the hash-freshness check above if it's ever used against a live build.
  if (Number.isFinite(approval.review_total_frames) && Number.isFinite(storedCandidate.total_frames) && approval.review_total_frames !== storedCandidate.total_frames) {
    failures.push(
      `qa/proof_approval.json.review_total_frames (${approval.review_total_frames}) does not equal the frozen candidate's own total_frames (${storedCandidate.total_frames}) -- ` +
        "only a review covering the full candidate can be approved; a partial-duration review cannot stand in for it."
    );
  }

  return { pass: failures.length === 0, failures, approval, storedCandidate };
}

// Stage 2 (runs after the edit plan, captions, audio mix and asset registry
// have just been rebuilt from real data, right before rendering): recomputes
// a frozen candidate from those real, just-built files and confirms every
// hash still matches the committed, approved candidate exactly -- proving
// what is about to render is the same bytes a human actually reviewed, not
// something silently regenerated differently in between.
export async function verifyFrozenCandidateFreshness(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const candidatePath = path.join(dir, "qa", "frozen_candidate.json");
  const storedCandidate = await readJson(candidatePath);
  const fresh = await computeCanonicalFrozenCandidate(projectId);
  const failures = [];
  for (const field of FRESHNESS_FIELDS) {
    if (fresh[field] !== storedCandidate[field])
      failures.push(`qa/frozen_candidate.json.${field} (${storedCandidate[field]}) no longer matches the current real project files (${fresh[field]}) -- project data changed since this candidate was recorded.`);
  }
  for (const field of OPTIONAL_HARDENED_FIELDS) {
    if (storedCandidate[field] && fresh[field] && storedCandidate[field] !== fresh[field])
      failures.push(`qa/frozen_candidate.json.${field} (${storedCandidate[field]}) does not match the current real value (${fresh[field]}).`);
  }
  return { pass: failures.length === 0, failures, fresh, storedCandidate };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const stage = args.stage || "early";
  const run = stage === "late" ? verifyFrozenCandidateFreshness(args["project-id"] || PROJECT_ID) : verifyApprovalRecord(args["project-id"] || PROJECT_ID, { expectedMode: args.mode || "full" });
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
