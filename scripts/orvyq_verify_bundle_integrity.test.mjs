import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PROJECTS_DIR } from "./lib/fs-utils.mjs";
import { computeCanonicalFrozenCandidate } from "./orvyq_frozen_candidate.mjs";
import { verifyBundleIntegrity } from "./orvyq_verify_bundle_integrity.mjs";

const FIXTURE_PROJECT_ID = "996-bundle-integrity-fixture";
const FIXTURE_DIR = path.join(PROJECTS_DIR, FIXTURE_PROJECT_ID);

async function writeFixtureProject() {
  await fs.mkdir(path.join(FIXTURE_DIR, "direction"), { recursive: true });
  await fs.mkdir(path.join(FIXTURE_DIR, "remotion"), { recursive: true });
  await fs.mkdir(path.join(FIXTURE_DIR, "assets", "audio"), { recursive: true });
  await fs.mkdir(path.join(FIXTURE_DIR, "qa"), { recursive: true });
  await fs.writeFile(
    path.join(FIXTURE_DIR, "direction", "edit_plan.json"),
    JSON.stringify({ fps: 30, duration_frames: 900, frame_range: { start_frame: 0, end_frame: 900 }, mode: "candidate", shots: [{ shot_id: "shot_001" }] })
  );
  await fs.writeFile(path.join(FIXTURE_DIR, "remotion", "captions.json"), JSON.stringify({ captions: [] }));
  await fs.writeFile(path.join(FIXTURE_DIR, "assets", "audio", "final_mix.metadata.json"), JSON.stringify({ duration_seconds: 30 }));
  await fs.writeFile(path.join(FIXTURE_DIR, "assets", "asset_registry.json"), JSON.stringify({ schema_version: "1.0-canonical", project_id: FIXTURE_PROJECT_ID, assets: [] }));
}

test("verifyBundleIntegrity passes when every placed file matches the bundle's own frozen_candidate.json", async (t) => {
  await writeFixtureProject();
  t.after(() => fs.rm(FIXTURE_DIR, { recursive: true, force: true }));

  const candidate = await computeCanonicalFrozenCandidate(FIXTURE_PROJECT_ID);
  await fs.writeFile(path.join(FIXTURE_DIR, "qa", "frozen_candidate.json"), JSON.stringify(candidate));

  const result = await verifyBundleIntegrity(FIXTURE_PROJECT_ID);
  assert.equal(result.ok, true);
  assert.equal(result.candidate_hash, candidate.candidate_hash);
});

test("verifyBundleIntegrity fails when a placed file was altered after freezing (corruption/tamper in transit)", async (t) => {
  await writeFixtureProject();
  t.after(() => fs.rm(FIXTURE_DIR, { recursive: true, force: true }));

  const candidate = await computeCanonicalFrozenCandidate(FIXTURE_PROJECT_ID);
  await fs.writeFile(path.join(FIXTURE_DIR, "qa", "frozen_candidate.json"), JSON.stringify(candidate));

  // Simulate a bundle that got corrupted/altered between upload and download.
  const editPlanPath = path.join(FIXTURE_DIR, "direction", "edit_plan.json");
  const editPlan = JSON.parse(await fs.readFile(editPlanPath, "utf8"));
  editPlan.shots.push({ shot_id: "shot_injected" });
  await fs.writeFile(editPlanPath, JSON.stringify(editPlan));

  await assert.rejects(() => verifyBundleIntegrity(FIXTURE_PROJECT_ID), /edit_plan_hash.*expected/s);
});

test("verifyBundleIntegrity fails when the render_ready_project directory was altered", async (t) => {
  await writeFixtureProject();
  await fs.mkdir(path.join(FIXTURE_DIR, "remotion", "render_ready_project", "src"), { recursive: true });
  await fs.writeFile(path.join(FIXTURE_DIR, "remotion", "render_ready_project", "src", "index.ts"), "export const x = 1;\n");
  t.after(() => fs.rm(FIXTURE_DIR, { recursive: true, force: true }));

  const candidate = await computeCanonicalFrozenCandidate(FIXTURE_PROJECT_ID);
  await fs.writeFile(path.join(FIXTURE_DIR, "qa", "frozen_candidate.json"), JSON.stringify(candidate));

  await fs.writeFile(path.join(FIXTURE_DIR, "remotion", "render_ready_project", "src", "index.ts"), "export const x = 2; // tampered\n");

  await assert.rejects(() => verifyBundleIntegrity(FIXTURE_PROJECT_ID), /render_ready_source_hash.*expected/s);
});

test("verifyBundleIntegrity throws clearly on a pre-hardening candidate with no canonical_candidate_identity", async (t) => {
  await writeFixtureProject();
  t.after(() => fs.rm(FIXTURE_DIR, { recursive: true, force: true }));
  await fs.writeFile(path.join(FIXTURE_DIR, "qa", "frozen_candidate.json"), JSON.stringify({ project_id: FIXTURE_PROJECT_ID }));
  await assert.rejects(() => verifyBundleIntegrity(FIXTURE_PROJECT_ID), /predates candidate-identity hardening/);
});
