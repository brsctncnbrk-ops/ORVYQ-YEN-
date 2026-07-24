#!/usr/bin/env node
// Review/final parity verifier (task section 15). Compares two render
// manifests -- one written by the review render step, one by the final
// render step, each a small JSON record of exactly which frozen candidate
// and frame range that render used, plus its own encode profile -- and fails
// hard on ANY difference outside the fields explicitly allowed to vary
// (resolution, codec, bitrate, CRF, encoder preset). This is what makes
// "the user's full-length review and the later final are identical except
// resolution/encode quality" an enforced invariant, not a hope.
import { readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";

const IDENTITY_FIELDS = [
  "candidate_hash",
  "edit_plan_hash",
  "caption_hash",
  "audio_mix_hash",
  "final_mix_audio_hash",
  "asset_registry_hash",
  "asset_manifest_hash",
  "total_frames",
  "fps",
  "frame_range",
  "composition_props",
  "render_ready_source_hash"
];
const ALLOWED_TO_DIFFER = new Set(["width", "height", "codec", "bitrate", "crf", "encoder_preset", "resolution"]);

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function checkReviewFinalParity(reviewManifest, finalManifest) {
  const failures = [];
  for (const field of IDENTITY_FIELDS) {
    const inReview = field in reviewManifest;
    const inFinal = field in finalManifest;
    if (!inReview && !inFinal) continue; // neither side declares it -- nothing to compare
    if (inReview !== inFinal) {
      failures.push(`"${field}" is present in ${inReview ? "review" : "final"} but not the other`);
      continue;
    }
    if (!deepEqual(reviewManifest[field], finalManifest[field])) {
      failures.push(`"${field}" differs: review=${JSON.stringify(reviewManifest[field])} final=${JSON.stringify(finalManifest[field])}`);
    }
  }

  // Any field NOT on the identity list and NOT explicitly allowed to differ
  // is unexpected drift -- report it too, rather than silently ignoring an
  // unrecognized field that might be a real creative difference.
  const allKeys = new Set([...Object.keys(reviewManifest), ...Object.keys(finalManifest)]);
  for (const key of allKeys) {
    if (IDENTITY_FIELDS.includes(key) || ALLOWED_TO_DIFFER.has(key)) continue;
    if (!deepEqual(reviewManifest[key], finalManifest[key])) {
      failures.push(`unrecognized field "${key}" differs between review and final and is not on the allowed-to-differ list: review=${JSON.stringify(reviewManifest[key])} final=${JSON.stringify(finalManifest[key])}`);
    }
  }

  return { failures, pass: failures.length === 0 };
}

export async function runReviewFinalParityCheck({ reviewManifestPath, finalManifestPath, reportPath }) {
  const [reviewManifest, finalManifest] = await Promise.all([readJson(reviewManifestPath), readJson(finalManifestPath)]);
  const result = checkReviewFinalParity(reviewManifest, finalManifest);
  const report = { schema_version: "1.0-canonical", identity_fields: IDENTITY_FIELDS, allowed_to_differ: [...ALLOWED_TO_DIFFER], ...result };
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
