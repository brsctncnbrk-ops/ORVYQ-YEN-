import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { computeAlignmentReadiness, buildAlignmentReadiness } from "./orvyq_alignment_score.mjs";
import { PROJECTS_DIR } from "./lib/fs-utils.mjs";

// A synthetic but internally-consistent stand-in for a canonical full-film
// candidate: source-backed evidence coverage and fraction both comfortably
// clear their minimums, contextual footage sits inside the 25-45% band, the
// uninterrupted-evidence run is under the 15s cap, and every upstream audit
// passes. Individual fields are overridden per test to isolate one rule at a
// time.
function baselineInputs(overrides = {}) {
  return {
    evidence: {
      pass: true,
      weighted_supported_coverage: 0.95,
      weighted_visual_evidence_coverage: 0.95,
      minimum_required: 0.9,
      ...overrides.evidence
    },
    assetAudit: { pass: true, legacy_footage_count: 0, ...overrides.assetAudit },
    semantic: {
      pass: true,
      evidence_archive_fraction: 0.44,
      contextual_body_footage_fraction: 0.35,
      maximum_uninterrupted_evidence_seconds: 12,
      official_primary_capture_fraction: 0.28,
      generic_stock_fraction: 0.05,
      ...overrides.semantic
    },
    pacing: { pass: true, warnings: [], ...overrides.pacing },
    mobile: { pass: true, warnings: [], ...overrides.mobile },
    speech: { passed: true, script_similarity: 0.99, ...overrides.speech },
    audio: { music_sections: [1, 2, 3, 4], ...overrides.audio },
    motionHook: { pass: true, ...overrides.motionHook }
  };
}

test("the current valid canonical full candidate passes the readiness formula", () => {
  const result = computeAlignmentReadiness(baselineInputs());
  assert.equal(result.pass, true);
  assert.ok(result.pre_render_readiness_score >= 82);
  assert.ok(result.pre_render_readiness_score <= 90);
  assert.equal(result.categories.source_backed_visual_evidence.score, 25);
  assert.equal(result.categories.motion_hook_discipline.score, 10);
});

test("zero source-backed evidence fails source_backed_visual_evidence and overall pass", () => {
  const result = computeAlignmentReadiness(baselineInputs({ semantic: { evidence_archive_fraction: 0 } }));
  assert.equal(result.categories.source_backed_visual_evidence.score, 0);
  assert.equal(result.pass, false);
});

test("evidence coverage below the required minimum fails the category floor", () => {
  const result = computeAlignmentReadiness(baselineInputs({ evidence: { weighted_visual_evidence_coverage: 0.5 } }));
  const category = result.categories.source_backed_visual_evidence;
  assert.ok(category.score < category.weight * 0.65);
  assert.equal(result.pass, false);
});

test("contextual footage below 25% fails motion_hook_discipline", () => {
  const result = computeAlignmentReadiness(baselineInputs({ semantic: { contextual_body_footage_fraction: 0.2 } }));
  assert.equal(result.categories.motion_hook_discipline.score, 0);
  assert.equal(result.pass, false);
});

test("contextual footage above 45% fails motion_hook_discipline", () => {
  const result = computeAlignmentReadiness(baselineInputs({ semantic: { contextual_body_footage_fraction: 0.5 } }));
  assert.equal(result.categories.motion_hook_discipline.score, 0);
  assert.equal(result.pass, false);
});

test("an uninterrupted evidence run over 15s fails motion_hook_discipline", () => {
  const result = computeAlignmentReadiness(baselineInputs({ semantic: { maximum_uninterrupted_evidence_seconds: 16 } }));
  assert.equal(result.categories.motion_hook_discipline.score, 0);
  assert.equal(result.pass, false);
});

test("legacy or unapproved footage fails motion_hook_discipline even when assetAudit otherwise passes", () => {
  const result = computeAlignmentReadiness(baselineInputs({ assetAudit: { legacy_footage_count: 1 } }));
  assert.equal(result.categories.motion_hook_discipline.score, 0);
  assert.equal(result.pass, false);
});

test("a failing motion hook audit fails motion_hook_discipline", () => {
  const result = computeAlignmentReadiness(baselineInputs({ motionHook: { pass: false } }));
  assert.equal(result.categories.motion_hook_discipline.score, 0);
  assert.equal(result.pass, false);
});

test("a failing semantic audit fails motion_hook_discipline even if the individual fractions look fine", () => {
  const result = computeAlignmentReadiness(baselineInputs({ semantic: { pass: false } }));
  assert.equal(result.categories.motion_hook_discipline.score, 0);
  assert.equal(result.pass, false);
});

test("official capture fraction and generic stock fraction stay diagnostic-only and never independently fail the category", () => {
  const result = computeAlignmentReadiness(
    baselineInputs({ semantic: { official_primary_capture_fraction: 0.02, generic_stock_fraction: 0.3 } })
  );
  assert.equal(result.categories.motion_hook_discipline.score, 10);
  assert.equal(result.categories.motion_hook_discipline.diagnostics.generic_stock_fraction, 0.3);
});

test("the automated ceiling stays 90 and the minimum passing readiness stays 82", () => {
  const result = computeAlignmentReadiness(baselineInputs());
  assert.equal(result.automated_readiness_ceiling, 90);
  assert.equal(result.minimum_pre_render_readiness, 82);
});

test("buildAlignmentReadiness keeps human review mandatory and the final Aperture score null", async () => {
  const projectId = "999-orvyq-alignment-fixture";
  const dir = path.join(PROJECTS_DIR, projectId);
  try {
    await fs.mkdir(path.join(dir, "qa"), { recursive: true });
    await fs.mkdir(path.join(dir, "direction"), { recursive: true });
    await fs.mkdir(path.join(dir, "assets", "audio"), { recursive: true });
    const write = (rel, data) => fs.writeFile(path.join(dir, rel), JSON.stringify(data));
    await Promise.all([
      write("qa/evidence_coverage.json", { pass: true, weighted_supported_coverage: 0.95, weighted_visual_evidence_coverage: 0.95, minimum_required: 0.9 }),
      write("qa/evidence_asset_audit.json", { pass: true, legacy_footage_count: 0 }),
      write("qa/semantic_visual_audit.json", {
        pass: true,
        evidence_archive_fraction: 0.44,
        contextual_body_footage_fraction: 0.35,
        maximum_uninterrupted_evidence_seconds: 12,
        official_primary_capture_fraction: 0.28,
        generic_stock_fraction: 0.05
      }),
      write("qa/pacing_audit.json", { pass: true, warnings: [] }),
      write("qa/mobile_legibility_audit.json", { pass: true, warnings: [] }),
      write("qa/speech_transcript.json", { passed: true, script_similarity: 0.99 }),
      write("assets/audio/final_mix.metadata.json", { music_sections: [1, 2, 3, 4] }),
      write("direction/edit_plan.json", {
        mode: "full",
        fps: 30,
        duration_frames: 450,
        quality_policy: { cinematic_body_footage: true },
        shots: [
          { shot_id: "shot_001", asset_type: "footage", hook_footage: true, video_asset: "a.mp4", trim_in_sec: 0, trim_out_sec: 12, start_frame: 0, end_frame: 360 },
          { shot_id: "shot_002", asset_type: "evidence", start_frame: 360, end_frame: 450, transition_in: "dissolve", evidence: {} }
        ]
      })
    ]);

    const report = await buildAlignmentReadiness(projectId);
    assert.equal(report.pass, true);
    assert.equal(report.final_aperture_alignment_score, null);
    assert.equal(report.human_rendered_video_review.required, true);
    assert.equal(report.human_rendered_video_review.status, "pending");
    assert.equal(report.automated_readiness_ceiling, 90);
    assert.equal(report.minimum_pre_render_readiness, 82);
    assert.equal(report.categories.source_backed_visual_evidence.weight, 25);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
