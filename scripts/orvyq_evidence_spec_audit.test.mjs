import { test } from "node:test";
import assert from "node:assert/strict";
import { isGeneric, collectNumbers, evaluateEvidenceShot } from "./orvyq_evidence_spec_audit.mjs";

const SECTION = { section_id: "SEC_01", title: "Test Section", dramatic_function: "Establish the premise." };
const SOURCE = { source_id: "SRC_A", publisher: "Example Institute", title: "Example Report", publication_date: "2024-01-15" };
const sourceById = new Map([["SRC_A", SOURCE]]);

function claim(overrides = {}) {
  return {
    claim_id: "CLM_001_TEST",
    narration_excerpt: "The real narrated claim text.",
    evidence_requirements: ["Show the real requirement."],
    status: "verified",
    source_ids: ["SRC_A"],
    ...overrides
  };
}

function baseEvidence(overrides = {}) {
  return {
    kind: "source_timeline",
    source_ids: ["SRC_A"],
    source_label: "Example Institute",
    font_px: 32,
    eyebrow: "EXAMPLE INSTITUTE — PRIMARY EVIDENCE",
    title: "Example Institute: Example Report",
    items: [{ label: "EXAMPLE INSTITUTE", value: "Jan 15, 2024", detail: "Example Report" }, { label: "WHAT THIS ESTABLISHES", value: "Show the real requirement." }],
    ...overrides
  };
}

test("isGeneric flags empty, blank, and known-placeholder strings", () => {
  assert.equal(isGeneric("", "CLM_001", "comparison"), true);
  assert.equal(isGeneric("   ", "CLM_001", "comparison"), true);
  assert.equal(isGeneric("Evidence", "CLM_001", "comparison"), true);
  assert.equal(isGeneric("CLM_001", "CLM_001", "comparison"), true);
  assert.equal(isGeneric("comparison", "CLM_001", "comparison"), true);
});

test("isGeneric accepts real claim-specific text", () => {
  assert.equal(isGeneric("Anthropic: Announcing our updated Responsible Scaling Policy", "CLM_001", "concept_map"), false);
});

test("collectNumbers finds standalone 2+ digit numbers, ignoring single digits", () => {
  assert.deepEqual(collectNumbers("16 models tested in 2025, not just 1"), ["16", "2025"]);
});

test("evaluateEvidenceShot: passes for a fully authored shot", () => {
  const shot = { shot_id: "shot_010", claim_id: "CLM_001_TEST" };
  const failures = evaluateEvidenceShot({ shot, evidence: baseEvidence(), claim: claim(), sourceById, section: SECTION, previousEvidence: null });
  assert.deepEqual(failures, []);
});

test("evaluateEvidenceShot: fails on a missing title", () => {
  const shot = { shot_id: "shot_005", claim_id: "CLM_001_TEST" };
  const failures = evaluateEvidenceShot({ shot, evidence: baseEvidence({ title: "" }), claim: claim(), sourceById, section: SECTION, previousEvidence: null });
  assert.ok(failures.some((f) => f.includes("missing a title")));
});

test("evaluateEvidenceShot: fails on a missing eyebrow", () => {
  const shot = { shot_id: "shot_005", claim_id: "CLM_001_TEST" };
  const failures = evaluateEvidenceShot({ shot, evidence: baseEvidence({ eyebrow: "" }), claim: claim(), sourceById, section: SECTION, previousEvidence: null });
  assert.ok(failures.some((f) => f.includes("missing an eyebrow")));
});

test("evaluateEvidenceShot: fails when source_ids reference an unknown source", () => {
  const shot = { shot_id: "shot_005", claim_id: "CLM_001_TEST" };
  const failures = evaluateEvidenceShot({ shot, evidence: baseEvidence({ source_ids: ["SRC_UNKNOWN"] }), claim: claim(), sourceById, section: SECTION, previousEvidence: null });
  assert.ok(failures.some((f) => f.includes("unknown source")));
});

test("evaluateEvidenceShot: fails when source_label is missing", () => {
  const shot = { shot_id: "shot_005", claim_id: "CLM_001_TEST" };
  const failures = evaluateEvidenceShot({ shot, evidence: baseEvidence({ source_label: "" }), claim: claim(), sourceById, section: SECTION, previousEvidence: null });
  assert.ok(failures.some((f) => f.includes("missing a source_label")));
});

test("evaluateEvidenceShot: fails when source_timeline/source_article has no items (the original shot_005 defect)", () => {
  const shot = { shot_id: "shot_005", claim_id: "CLM_001_TEST" };
  const bareEvidence = { kind: "source_timeline", source_ids: ["SRC_A"], source_label: "Example Institute", font_px: 32 };
  const failures = evaluateEvidenceShot({ shot, evidence: bareEvidence, claim: claim(), sourceById, section: SECTION, previousEvidence: null });
  assert.ok(failures.some((f) => f.includes("missing a title")));
  assert.ok(failures.some((f) => f.includes("missing an eyebrow")));
  assert.ok(failures.some((f) => f.includes("has no items")));
});

test("evaluateEvidenceShot: fails when concept_map/evidence_chain has no steps", () => {
  const shot = { shot_id: "shot_005", claim_id: "CLM_001_TEST" };
  const failures = evaluateEvidenceShot({ shot, evidence: baseEvidence({ kind: "evidence_chain", items: undefined, steps: [] }), claim: claim(), sourceById, section: SECTION, previousEvidence: null });
  assert.ok(failures.some((f) => f.includes("has no steps")));
});

test("evaluateEvidenceShot: fails when comparison/boundary has empty left or right", () => {
  const shot = { shot_id: "shot_005", claim_id: "CLM_001_TEST" };
  const failures = evaluateEvidenceShot({ shot, evidence: baseEvidence({ kind: "comparison", items: undefined, left: "Supports this.", right: "" }), claim: claim(), sourceById, section: SECTION, previousEvidence: null });
  assert.ok(failures.some((f) => f.includes("empty left or right")));
});

test("evaluateEvidenceShot: fails when two consecutive evidence scenes repeat identical authored content", () => {
  const previousShot = { shot_id: "shot_004", claim_id: "CLM_001_TEST", evidence: baseEvidence() };
  const shot = { shot_id: "shot_005", claim_id: "CLM_001_TEST" };
  const failures = evaluateEvidenceShot({ shot, evidence: baseEvidence(), claim: claim(), sourceById, section: SECTION, previousEvidence: previousShot });
  assert.ok(failures.some((f) => f.includes("consecutive evidence scenes with identical authored content")));
});

test("evaluateEvidenceShot: does not flag two adjacent shots with genuinely different content", () => {
  const previousShot = { shot_id: "shot_004", claim_id: "CLM_001_TEST", evidence: baseEvidence({ title: "A different real title" }) };
  const shot = { shot_id: "shot_005", claim_id: "CLM_001_TEST" };
  const failures = evaluateEvidenceShot({ shot, evidence: baseEvidence(), claim: claim(), sourceById, section: SECTION, previousEvidence: previousShot });
  assert.ok(!failures.some((f) => f.includes("identical authored content")));
});

test("evaluateEvidenceShot: fails when a required limitation is omitted", () => {
  const shot = { shot_id: "shot_005", claim_id: "CLM_001_TEST" };
  const sourceWithLimitation = new Map([["SRC_A", { ...SOURCE, limitation: "Real registered limitation." }]]);
  const failures = evaluateEvidenceShot({ shot, evidence: baseEvidence({ limitation: undefined }), claim: claim(), sourceById: sourceWithLimitation, section: SECTION, previousEvidence: null });
  assert.ok(failures.some((f) => f.includes("omits") && f.includes("required limitation")));
});

test("evaluateEvidenceShot: fails when body content contains a number unsupported by the claim's own verified data", () => {
  const shot = { shot_id: "shot_005", claim_id: "CLM_001_TEST" };
  const evidence = baseEvidence({ kind: "comparison", items: undefined, left: "16 leading models were stress-tested.", right: "Not a real-world incident." });
  const failures = evaluateEvidenceShot({ shot, evidence, claim: claim(), sourceById, section: SECTION, previousEvidence: null });
  assert.ok(failures.some((f) => f.includes("not traceable") && f.includes("16")));
});

test("evaluateEvidenceShot: does not flag a number that is genuinely present in the claim's own data", () => {
  const shot = { shot_id: "shot_005", claim_id: "CLM_001_TEST" };
  const c = claim({ narration_excerpt: "16 leading models were stress-tested in this real claim." });
  const evidence = baseEvidence({ kind: "comparison", items: undefined, left: "16 leading models were stress-tested.", right: "Not a real-world incident." });
  const failures = evaluateEvidenceShot({ shot, evidence, claim: c, sourceById, section: SECTION, previousEvidence: null });
  assert.ok(!failures.some((f) => f.includes("not traceable")));
});
