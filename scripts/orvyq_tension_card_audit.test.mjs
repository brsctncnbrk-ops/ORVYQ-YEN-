import { test } from "node:test";
import assert from "node:assert/strict";
import { auditTensionCards } from "./orvyq_tension_card_audit.mjs";

const FPS = 30;
function graphicShot(id, title, durationSeconds, type = "tension_card") {
  return { shot_id: id, asset_type: "graphic", graphic: { type, title }, start_frame: 0, end_frame: Math.round(durationSeconds * FPS) };
}

test("a compliant film with sparse, short, uniquely-titled emphasis cards passes", () => {
  const shots = [graphicShot("shot_010", "Distributed Risk", 3.5), graphicShot("shot_040", "A Different Gate", 3), graphicShot("shot_090", "Second Set Of Eyes", 4)];
  const { failures } = auditTensionCards(shots, FPS);
  assert.equal(failures.length, 0);
});

// Regression test for the old, known-bad full render: task description
// reports 19 tension cards totalling ~141 seconds -- both numbers blow past
// the new 50s total cap, and this must fail loudly, not warn.
test("regression: the old full render's ~19 cards / ~141s total fails the new cap", () => {
  const shots = [];
  for (let i = 0; i < 19; i += 1) shots.push(graphicShot(`shot_${100 + i}`, `Old Card ${i}`, 141 / 19));
  const { failures, emphasis_total_seconds } = auditTensionCards(shots, FPS);
  assert.ok(emphasis_total_seconds > 100);
  assert.ok(failures.some((f) => f.includes("exceeding the 50s cap")));
});

test("a repeated card title fails even if durations are otherwise compliant", () => {
  const shots = [graphicShot("shot_010", "Distributed Risk", 3), graphicShot("shot_050", "Distributed Risk", 3)];
  const { failures } = auditTensionCards(shots, FPS);
  assert.ok(failures.some((f) => f.includes("reused")));
});

test("a card over the 6s exception threshold fails", () => {
  const shots = [graphicShot("shot_010", "Long Hold", 8)];
  const { failures } = auditTensionCards(shots, FPS);
  assert.ok(failures.some((f) => f.includes("exception threshold")));
});

test("section_title and end_card graphics are structural, not counted against the emphasis budget", () => {
  const shots = [
    { shot_id: "shot_001", asset_type: "graphic", graphic: { type: "section_title", title: "Race Paradox" }, start_frame: 0, end_frame: 75 },
    { shot_id: "shot_999", asset_type: "graphic", graphic: { type: "end_card", title: "Closing line." }, start_frame: 1000, end_frame: 1120 }
  ];
  const { emphasis_beat_count, failures } = auditTensionCards(shots, FPS);
  assert.equal(emphasis_beat_count, 0);
  assert.equal(failures.length, 0);
});
