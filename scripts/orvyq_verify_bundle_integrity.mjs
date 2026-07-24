#!/usr/bin/env node
// verifyBundleIntegrity() -- for a workflow that downloaded a candidate
// bundle (an orvyq-validated-candidate-bundle-<run_id> or
// orvyq-render-bundle-<run_id> artifact) and placed it into the project
// tree WITHOUT rebuilding anything: confirms every placed file's real
// sha256 (and the placed render_ready_project directory's own tree hash)
// still matches what the bundle's own qa/frozen_candidate.json recorded at
// freeze time. This is a self-consistency check against the bundle's OWN
// recorded identity (proving the download/placement did not corrupt or
// silently substitute a file) -- not an independent recomputation of the
// candidate from scratch, which a consumer of an already-frozen bundle must
// never do (see docs/canonical-candidate-audit.md: "validation candidate ==
// review candidate == final candidate").
import path from "node:path";
import { projectDir, readJson, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { sha256OfFile, sha256OfDirectoryTree } from "./orvyq_frozen_candidate.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";

export async function verifyBundleIntegrity(projectId = PROJECT_ID, { renderReadyDir } = {}) {
  const dir = projectDir(projectId);
  const candidate = await readJson(path.join(dir, "qa", "frozen_candidate.json"));
  const identity = candidate.canonical_candidate_identity;
  if (!identity) throw new Error("qa/frozen_candidate.json has no canonical_candidate_identity -- this bundle predates candidate-identity hardening");

  const fileChecks = [
    ["edit_plan_hash", path.join(dir, "direction", "edit_plan.json")],
    ["caption_hash", path.join(dir, "remotion", "captions.json")],
    ["audio_mix_metadata_hash", path.join(dir, "assets", "audio", "final_mix.metadata.json")],
    ["asset_registry_hash", path.join(dir, "assets", "asset_registry.json")],
    ["final_mix_audio_hash", path.join(dir, "assets", "audio", "final_mix.mp3")],
    ["music_bed_hash", path.join(dir, "assets", "music", "approved_bed.mp3")]
  ];

  const mismatches = [];
  for (const [field, filePath] of fileChecks) {
    const expected = identity[field];
    if (!expected) continue; // field not recorded for this candidate -- nothing to check
    const actual = await sha256OfFile(filePath);
    if (actual !== expected) mismatches.push(`${field}: expected ${expected}, got ${actual} (${filePath})`);
  }

  if (identity.render_ready_source_hash) {
    const actualTreeHash = await sha256OfDirectoryTree(renderReadyDir || path.join(dir, "remotion", "render_ready_project"));
    if (actualTreeHash !== identity.render_ready_source_hash)
      mismatches.push(`render_ready_source_hash: expected ${identity.render_ready_source_hash}, got ${actualTreeHash} (render_ready_project directory)`);
  }

  if (mismatches.length)
    throw new Error(`Bundle integrity check failed -- ${mismatches.length} file(s) do not match the bundle's own frozen_candidate.json:\n- ${mismatches.join("\n- ")}`);

  return { ok: true, candidate_hash: candidate.candidate_hash, render_bundle_hash: candidate.render_bundle_hash, checked: fileChecks.filter(([field]) => identity[field]).map(([field]) => field).concat(identity.render_ready_source_hash ? ["render_ready_source_hash"] : []) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  verifyBundleIntegrity(args["project-id"] || PROJECT_ID, { renderReadyDir: args["render-ready-dir"] || undefined })
    .then((result) => printJson(result))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
