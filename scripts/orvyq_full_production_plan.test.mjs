import { test } from "node:test";
import assert from "node:assert/strict";
import { kindFor, titleCase, locateClaimWindow, sliceClaimWindow } from "./orvyq_full_production_plan.mjs";
import { tokenizeWords } from "./lib/orvyq-pause-resolver.mjs";

function wordsFrom(text, secondsPerWord = 0.5) {
  return text.split(/\s+/).map((w, i) => ({ text: w, start: i * secondsPerWord, end: (i + 1) * secondsPerWord - 0.05 }));
}

test("kindFor maps known visual_treatment vocabulary and falls back to boundary for unknown values", () => {
  assert.equal(kindFor("evidence_mosaic"), "concept_map");
  assert.equal(kindFor("comparison_overlay"), "comparison");
  assert.equal(kindFor("something_never_seen"), "boundary");
});

test("titleCase strips the SEC_NN_ prefix and title-cases each word", () => {
  assert.equal(titleCase("SEC_01_RACE_PARADOX"), "Race Paradox");
  assert.equal(titleCase("SEC_09_FINAL_PARADOX"), "Final Paradox");
});

test("locateClaimWindow finds an exact contiguous quote", () => {
  const words = wordsFrom("Introductory filler words here. Not someday. Right now. Then it kept going for a good while longer past this point.");
  const tokens = tokenizeWords(words);
  const claim = { claim_id: "CLM_TEST", narration_excerpt: "Not someday. Right now." };
  const { matchStart, matchEnd, nextSearchTokenIndex } = locateClaimWindow(tokens, claim, 0);
  assert.ok(matchStart < matchEnd);
  assert.ok(nextSearchTokenIndex > 0);
});

test("locateClaimWindow falls back to bag-of-words matching for a reordered paraphrase", () => {
  const words = wordsFrom(
    "Established companies large and well funded may in practice be able to absorb the complex compliance and reporting costs more easily than smaller rivals. Then narration continues for quite a while after that point to give the scanner room."
  );
  const tokens = tokenizeWords(words);
  const claim = { claim_id: "CLM_TEST", narration_excerpt: "Compliance costs may be easier for established companies to absorb" };
  const { matchStart, matchEnd } = locateClaimWindow(tokens, claim, 0);
  assert.ok(matchStart < matchEnd);
});

test("locateClaimWindow throws when a claim cannot be located at all", () => {
  const words = wordsFrom("This narration is entirely unrelated to the claim text and shares no real words with it whatsoever.");
  const tokens = tokenizeWords(words);
  const claim = { claim_id: "CLM_TEST", narration_excerpt: "Quantum toaster hypnosis breakfast negotiation zeppelin" };
  assert.throws(() => locateClaimWindow(tokens, claim, 0), /could not be located/);
});

test("sliceClaimWindow splits a window into slices no longer than the max, rotating kind and role", () => {
  const claim = { visual_treatment: { primary: "evidence_mosaic", secondary: "comparison_overlay", metaphor: "distributed_risk" } };
  const slices = sliceClaimWindow(claim, 0, 20, 8);
  assert.ok(slices.every((slice) => slice.end - slice.start <= 8 + 1e-9));
  const total = slices.reduce((sum, slice) => sum + (slice.end - slice.start), 0);
  assert.ok(Math.abs(total - 20) < 1e-9);
  assert.equal(slices[0].kind, "concept_map");
  assert.equal(slices[0].role, "evidence");
});

test("sliceClaimWindow returns a single slice when the window already fits within the cap", () => {
  const claim = { visual_treatment: { primary: "evidence_mosaic", secondary: "comparison_overlay" } };
  const slices = sliceClaimWindow(claim, 10, 14, 8);
  assert.equal(slices.length, 1);
  assert.equal(slices[0].start, 10);
  assert.equal(slices[0].end, 14);
});
