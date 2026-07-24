import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PROJECTS_DIR } from "./lib/fs-utils.mjs";
import { computeCanonicalFrozenCandidate } from "./orvyq_frozen_candidate.mjs";

const FIXTURE_PROJECT_ID = "999-frozen-candidate-determinism-fixture";
const FIXTURE_DIR = path.join(PROJECTS_DIR, FIXTURE_PROJECT_ID);

async function writeFixtureProject() {
  await fs.mkdir(path.join(FIXTURE_DIR, "direction"), { recursive: true });
  await fs.mkdir(path.join(FIXTURE_DIR, "remotion"), { recursive: true });
  await fs.mkdir(path.join(FIXTURE_DIR, "assets", "audio"), { recursive: true });
  await fs.writeFile(
    path.join(FIXTURE_DIR, "direction", "edit_plan.json"),
    JSON.stringify({ fps: 30, duration_frames: 900, frame_range: { start_frame: 0, end_frame: 900 }, mode: "candidate", shots: [{ shot_id: "shot_001" }] })
  );
  await fs.writeFile(path.join(FIXTURE_DIR, "remotion", "captions.json"), JSON.stringify({ captions: [] }));
  await fs.writeFile(path.join(FIXTURE_DIR, "assets", "audio", "final_mix.metadata.json"), JSON.stringify({ duration_seconds: 30 }));
  await fs.writeFile(path.join(FIXTURE_DIR, "assets", "asset_registry.json"), JSON.stringify({ schema_version: "1.0-canonical", project_id: FIXTURE_PROJECT_ID, assets: [] }));
}

test("computeCanonicalFrozenCandidate is deterministic: same inputs produce the same candidate_hash and render_bundle_hash", async (t) => {
  await writeFixtureProject();
  t.after(() => fs.rm(FIXTURE_DIR, { recursive: true, force: true }));

  const first = await computeCanonicalFrozenCandidate(FIXTURE_PROJECT_ID);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await computeCanonicalFrozenCandidate(FIXTURE_PROJECT_ID);

  // operational_metadata.created_at is expected to differ (real wall-clock
  // timestamps) -- the whole point of splitting it out.
  assert.notEqual(first.operational_metadata.created_at, second.operational_metadata.created_at);

  // But everything that defines "the same candidate" must be byte-identical.
  assert.equal(first.candidate_hash, second.candidate_hash);
  assert.equal(first.render_bundle_hash, second.render_bundle_hash);
  assert.deepEqual(first.canonical_candidate_identity, second.canonical_candidate_identity);
});

test("candidate_hash changes when a real creative input (edit_plan.json) changes", async (t) => {
  await writeFixtureProject();
  t.after(() => fs.rm(FIXTURE_DIR, { recursive: true, force: true }));

  const before = await computeCanonicalFrozenCandidate(FIXTURE_PROJECT_ID);
  const editPlanPath = path.join(FIXTURE_DIR, "direction", "edit_plan.json");
  const editPlan = JSON.parse(await fs.readFile(editPlanPath, "utf8"));
  editPlan.shots.push({ shot_id: "shot_002" });
  await fs.writeFile(editPlanPath, JSON.stringify(editPlan));
  const after = await computeCanonicalFrozenCandidate(FIXTURE_PROJECT_ID);

  assert.notEqual(before.candidate_hash, after.candidate_hash);
  assert.notEqual(before.render_bundle_hash, after.render_bundle_hash);
});

test("candidate_hash is unaffected by operational-only fields (created_at is never part of the hashed identity)", async (t) => {
  await writeFixtureProject();
  t.after(() => fs.rm(FIXTURE_DIR, { recursive: true, force: true }));

  const candidate = await computeCanonicalFrozenCandidate(FIXTURE_PROJECT_ID);
  assert.ok(!("created_at" in candidate.canonical_candidate_identity), "created_at must not appear inside canonical_candidate_identity");
  assert.ok(!("approval_version" in candidate.canonical_candidate_identity), "approval_version must not appear inside canonical_candidate_identity");
});
