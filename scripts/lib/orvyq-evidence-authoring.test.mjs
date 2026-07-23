import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceContent, claimLimitation } from "./orvyq-evidence-authoring.mjs";

const SECTION = { section_id: "SEC_01_TEST", title: "Test Section", dramatic_function: "Establish the test premise." };

const SOURCE_A = { source_id: "SRC_A", publisher: "Example Institute", title: "Example Report One", publication_date: "2024-01-15", limitation: "Example limitation text." };
const SOURCE_B = { source_id: "SRC_B", publisher: "Other Authority", title: "Example Report Two", publication_date: "2025-06-01" };

function claim(overrides = {}) {
  return {
    claim_id: "CLM_001_TEST_CLAIM",
    section_id: "SEC_01_TEST",
    importance: 5,
    narration_excerpt: "This is the real narrated claim text.",
    status: "verified",
    source_ids: ["SRC_A", "SRC_B"],
    evidence_requirements: ["Show the real requirement.", "Do not overstate the finding."],
    ...overrides
  };
}

test("source_timeline: items are non-empty, real, and vary across repeat occurrences of the same claim/kind", () => {
  const c = claim();
  const occ0 = buildEvidenceContent({ claim: c, kind: "source_timeline", role: "evidence", displaySources: [SOURCE_A, SOURCE_B], ownSources: [SOURCE_A, SOURCE_B], section: SECTION, occurrence: 0 });
  const occ1 = buildEvidenceContent({ claim: c, kind: "source_timeline", role: "evidence", displaySources: [SOURCE_A, SOURCE_B], ownSources: [SOURCE_A, SOURCE_B], section: SECTION, occurrence: 1 });
  assert.ok(occ0.items.length >= 2 && occ0.items.length <= 4);
  for (const item of occ0.items) {
    assert.ok(item.label);
    assert.ok(item.value);
  }
  assert.notEqual(occ0.title, occ1.title, "repeat shots for the same claim/kind must not share a title");
  assert.notDeepEqual(occ0.items, occ1.items, "repeat shots for the same claim/kind must not share identical items");
});

test("source_article: items are non-empty and never contain content from an unrelated claim", () => {
  const c = claim();
  const result = buildEvidenceContent({ claim: c, kind: "source_article", role: "evidence", displaySources: [SOURCE_A], ownSources: [SOURCE_A], section: SECTION, occurrence: 0 });
  assert.ok(result.items.length >= 2);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("16 leading models"), "must not carry the old hardcoded CLM_004 stat");
});

test("concept_map and evidence_chain: steps are non-empty, meaningful strings", () => {
  const c = claim();
  for (const kind of ["concept_map", "evidence_chain"]) {
    const result = buildEvidenceContent({ claim: c, kind, role: "evidence", displaySources: [SOURCE_A], ownSources: [SOURCE_A], section: SECTION, occurrence: 0 });
    assert.ok(result.steps.length >= 3 && result.steps.length <= 5, `${kind} needs 3-5 steps`);
    for (const step of result.steps) {
      assert.ok(step.trim().length > 0);
      assert.notEqual(step, "undefined: undefined");
    }
  }
});

test("comparison and boundary: left/right/left_detail/right_detail are always populated", () => {
  const c = claim();
  for (const kind of ["comparison", "boundary"]) {
    const result = buildEvidenceContent({ claim: c, kind, role: "evidence", displaySources: [SOURCE_A], ownSources: [SOURCE_A], section: SECTION, occurrence: 0 });
    assert.ok(result.left && result.left.trim().length > 0);
    assert.ok(result.right && result.right.trim().length > 0);
  }
});

test("comparison: a claim with only a positive requirement still gets truthful left/right (no invented conclusion)", () => {
  const c = claim({ evidence_requirements: ["Frame this as the film's own synthesis, not a measured finding."] });
  const result = buildEvidenceContent({ claim: c, kind: "comparison", role: "evidence", displaySources: [SOURCE_B], ownSources: [SOURCE_B], section: SECTION, occurrence: 0 });
  assert.ok(result.left);
  assert.ok(result.right);
});

test("eyebrow is uppercase, non-generic, and within 60 characters; title is within 90 and not the raw claim id", () => {
  const c = claim();
  const result = buildEvidenceContent({ claim: c, kind: "concept_map", role: "evidence", displaySources: [SOURCE_A], ownSources: [SOURCE_A], section: SECTION, occurrence: 0 });
  assert.equal(result.eyebrow, result.eyebrow.toUpperCase());
  assert.ok(result.eyebrow.length <= 60);
  assert.ok(result.title.length <= 90);
  assert.notEqual(result.title, c.claim_id);
  assert.notEqual(result.title.toLowerCase(), "evidence");
});

test("title truncation prioritizes the distinguishing source title over a long publisher name", () => {
  const longPublisherSource = { source_id: "SRC_LONG", publisher: "A Very Long Institutional Publisher Name That Eats Most Of A Budget", title: "The Distinguishing Report Title", publication_date: "2025-01-01" };
  const c = claim({ source_ids: ["SRC_LONG"] });
  const result = buildEvidenceContent({ claim: c, kind: "source_timeline", role: "evidence", displaySources: [longPublisherSource], ownSources: [longPublisherSource], section: SECTION, occurrence: 0 });
  assert.ok(result.title.includes("Distinguishing"), `title should retain the distinguishing report title, got: "${result.title}"`);
});

test("role rotation offset keeps a claim's evidence-role and context-role shots from opening on the same fact at occurrence 0", () => {
  const c = claim();
  const evidenceRole = buildEvidenceContent({ claim: c, kind: "comparison", role: "evidence", displaySources: [SOURCE_A], ownSources: [SOURCE_A], section: SECTION, occurrence: 0 });
  const contextRole = buildEvidenceContent({ claim: c, kind: "source_article", role: "context", displaySources: [SOURCE_A], ownSources: [SOURCE_A], section: SECTION, occurrence: 0 });
  assert.notEqual(evidenceRole.title, contextRole.title);
});

test("claimLimitation: prefers a cited source's own limitation field", () => {
  const c = claim();
  assert.equal(claimLimitation(c, [SOURCE_A, SOURCE_B]), "Example limitation text.");
});

test("claimLimitation: falls back to an attributed_commentary caveat when no source has a limitation", () => {
  const c = claim({ status: "attributed_commentary" });
  assert.equal(claimLimitation(c, [SOURCE_B]), "Attributed commentary, not a measured or universal industry finding.");
});

test("claimLimitation: returns null for a verified claim with no source limitation", () => {
  const c = claim({ status: "verified" });
  assert.equal(claimLimitation(c, [SOURCE_B]), null);
});

test("claimLimitation: the shared controlled-simulation source is always flagged even without a structured limitation field", () => {
  const c = claim({ source_ids: ["SRC_ANTHROPIC_AGENTIC_MISALIGNMENT_2025"], status: "verified" });
  const source = { source_id: "SRC_ANTHROPIC_AGENTIC_MISALIGNMENT_2025", publisher: "Anthropic Research", title: "Agentic Misalignment", publication_date: "2025-06-20" };
  assert.equal(claimLimitation(c, [source]), "Controlled simulation, not a documented real-world incident.");
});

test("a recap claim with no own source_ids still gets non-empty, non-recap-biased limitation handling", () => {
  const recapClaim = claim({ claim_id: "CLM_020_RECAP", source_ids: [], status: "attributed_commentary", evidence_requirements: ["Treat as the film's synthesis."] });
  const manySources = [SOURCE_A, SOURCE_B];
  const result = buildEvidenceContent({ claim: recapClaim, kind: "source_timeline", role: "evidence", displaySources: manySources, ownSources: [], section: SECTION, occurrence: 0 });
  assert.equal(result.limitation, "Attributed commentary, not a measured or universal industry finding.");
  assert.ok(result.items.length >= 2);
});
