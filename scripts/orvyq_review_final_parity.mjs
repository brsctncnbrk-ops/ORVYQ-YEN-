#!/usr/bin/env node
// Review/final parity verifier (task section 15, hardened per section 4 of
// the follow-up task). Compares two render manifests -- one written by the
// review render step, one by the final render step -- using an explicit
// three-section schema so "fields that naturally differ" (profile, run_id,
// video_path, video_sha256, encode settings) can never accidentally be
// compared as if they were creative identity:
//
//   { schema_version, identity: {...}, encode: {...}, artifact: {...} }
//
// Only `identity` is compared, and it must match EXACTLY, field for field,
// with no undeclared extra keys on either side. `encode` and `artifact` are
// never compared at all -- they are expected to differ by construction (a
// review encode has its own resolution/bitrate/run_id/video path/hash; the
// final encode has its own). This replaces the old flat-manifest shape
// whose "unrecognized field" catch-all wrongly failed on profile/run_id/
// video_path/video_sha256 in every real run (see
// docs/canonical-candidate-audit.md and the regression test below, which
// reproduces that exact failure against real review/final manifests).
import { readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";

export const SCHEMA_VERSION = "2.0";

// Every one of these must be present, with an identical value, in BOTH
// manifests' `identity` section. This is the complete definition of "the
// same candidate" -- task section 4: nothing that touches frames, editorial
// content, audio, or render-ready source may differ between review and
// final.
export const REQUIRED_IDENTITY_FIELDS = [
  "candidate_hash",
  "render_bundle_hash",
  "edit_plan_hash",
  "caption_hash",
  "final_mix_audio_hash",
  "audio_mix_metadata_hash",
  "asset_manifest_hash",
  "render_ready_source_hash",
  "renderer_source_hash",
  "total_frames",
  "fps",
  "frame_range"
];

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function validateManifestShape(manifest, label) {
  const failures = [];
  if (manifest.schema_version !== SCHEMA_VERSION) failures.push(`${label} manifest schema_version is "${manifest.schema_version}", expected "${SCHEMA_VERSION}"`);
  if (!manifest.identity || typeof manifest.identity !== "object") {
    failures.push(`${label} manifest has no "identity" section`);
    return failures;
  }
  for (const field of REQUIRED_IDENTITY_FIELDS) {
    const value = manifest.identity[field];
    const missing = value === undefined || value === null || value === "";
    if (missing) failures.push(`${label} manifest identity.${field} is missing -- a candidate cannot be verified without it`);
  }
  return failures;
}

export function checkReviewFinalParity(reviewManifest, finalManifest) {
  const failures = [
    ...validateManifestShape(reviewManifest, "review"),
    ...validateManifestShape(finalManifest, "final")
  ];
  if (failures.length) return { failures, pass: false };

  const reviewIdentity = reviewManifest.identity;
  const finalIdentity = finalManifest.identity;
  const allKeys = new Set([...Object.keys(reviewIdentity), ...Object.keys(finalIdentity)]);
  for (const field of allKeys) {
    const inReview = field in reviewIdentity;
    const inFinal = field in finalIdentity;
    if (inReview !== inFinal) {
      failures.push(`identity.${field} is present in ${inReview ? "review" : "final"} but not the other -- an undeclared identity field is never allowed to differ silently`);
      continue;
    }
    if (!deepEqual(reviewIdentity[field], finalIdentity[field])) {
      failures.push(`identity.${field} differs: review=${JSON.stringify(reviewIdentity[field])} final=${JSON.stringify(finalIdentity[field])}`);
    }
  }

  // `encode` and `artifact` are deliberately never compared -- see file
  // header. This is a documentation no-op, kept so a future edit that adds
  // a stray comparison of those sections has to delete this comment first.
  void reviewManifest.encode;
  void reviewManifest.artifact;

  return { failures, pass: failures.length === 0 };
}

export async function runReviewFinalParityCheck({ reviewManifestPath, finalManifestPath, reportPath }) {
  const [reviewManifest, finalManifest] = await Promise.all([readJson(reviewManifestPath), readJson(finalManifestPath)]);
  const result = checkReviewFinalParity(reviewManifest, finalManifest);
  const report = { schema_version: SCHEMA_VERSION, required_identity_fields: REQUIRED_IDENTITY_FIELDS, ...result };
  if (reportPath) await writeJsonAtomic(reportPath, report);
  if (!report.pass) throw new Error(`ORVYQ review/final parity check failed: ${result.failures.join("; ")}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args["review-manifest"] || !args["final-manifest"]) {
    console.error("Usage: node scripts/orvyq_review_final_parity.mjs --review-manifest <path> --final-manifest <path> [--report <path>]");
    process.exitCode = 1;
  } else {
    runReviewFinalParityCheck({ reviewManifestPath: args["review-manifest"], finalManifestPath: args["final-manifest"], reportPath: args.report })
      .then((report) => printJson({ ok: true, ...report }))
      .catch((error) => {
        console.error(JSON.stringify({ ok: false, error: error.message }));
        process.exitCode = 1;
      });
  }
}
