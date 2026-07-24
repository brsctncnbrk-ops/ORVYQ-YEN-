import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyBlackSegments } from "./orvyq_near_black_audit.mjs";

test("a segment right at the end of the video is terminal (the allowed final fade)", () => {
  const { terminal_segments, nonterminal_violations } = classifyBlackSegments([{ start: 99, end: 100, duration: 1 }], 100);
  assert.equal(terminal_segments.length, 1);
  assert.equal(nonterminal_violations.length, 0);
});

test("a non-terminal segment under 1s is within limit, not a violation", () => {
  const { nonterminal_segments_within_limit, nonterminal_violations } = classifyBlackSegments([{ start: 20, end: 20.5, duration: 0.5 }], 100);
  assert.equal(nonterminal_segments_within_limit.length, 1);
  assert.equal(nonterminal_violations.length, 0);
});

test("a non-terminal segment over 1s is a violation", () => {
  const { nonterminal_violations } = classifyBlackSegments([{ start: 20, end: 21.5, duration: 1.5 }], 100);
  assert.equal(nonterminal_violations.length, 1);
});

// Regression test for the old full render's reported ~49 near-black segments
// totalling ~48.5s -- most of which, by construction (mechanical tension
// cards scattered throughout, not clustered at the very end), were
// non-terminal and must fail.
test("regression: ~49 scattered near-black segments (old full render, ~48.5s total, uneven durations) mostly fail as non-terminal violations", () => {
  const segments = [];
  let cursor = 10;
  for (let i = 0; i < 49; i += 1) {
    // Uneven durations averaging ~0.99s (matching the reported ~48.5s/49),
    // but with real variance so several individual cards exceed the 1s cap
    // -- a flat 48.5/49 average alone would (misleadingly) stay under it.
    const duration = i % 4 === 0 ? 2.6 : 0.55;
    segments.push({ start: cursor, end: cursor + duration, duration });
    cursor += 15;
  }
  const { nonterminal_violations, total_seconds } = classifyBlackSegments(segments, 857.29, { maxNonterminalSeconds: 1.0 });
  assert.ok(total_seconds > 30);
  assert.ok(nonterminal_violations.length > 0, "the old scattered near-black pattern must produce non-terminal violations");
});
