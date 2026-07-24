import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeFootageUsage } from "./orvyq_duplicate_footage_audit.mjs";

function footageShot(id, asset, { trim_in_sec = 0, trim_out_sec = 5, reuse_reason = null } = {}) {
  return { shot_id: id, asset_type: "footage", asset, trim_in_sec, trim_out_sec, reuse_reason, editorial_purpose: "Present evidence." };
}

test("a single use of an asset is never flagged", () => {
  const { failures } = analyzeFootageUsage([footageShot("shot_001", "assets/footage/a.mp4")]);
  assert.equal(failures.length, 0);
});

test("a second use without reuse_reason fails", () => {
  const shots = [footageShot("shot_001", "assets/footage/a.mp4"), footageShot("shot_050", "assets/footage/a.mp4", { trim_in_sec: 20, trim_out_sec: 25 })];
  const { failures } = analyzeFootageUsage(shots);
  assert.ok(failures.some((f) => f.includes("no reuse_reason")));
});

test("a second use WITH reuse_reason passes", () => {
  const shots = [
    footageShot("shot_001", "assets/footage/a.mp4"),
    footageShot("shot_050", "assets/footage/a.mp4", { trim_in_sec: 20, trim_out_sec: 25, reuse_reason: "Deliberate callback to the opening image." })
  ];
  const { failures } = analyzeFootageUsage(shots);
  assert.equal(failures.length, 0);
});

test("a third use is a hard failure even with a reuse_reason", () => {
  const shots = [
    footageShot("shot_001", "assets/footage/a.mp4"),
    footageShot("shot_050", "assets/footage/a.mp4", { trim_in_sec: 20, trim_out_sec: 25, reuse_reason: "callback" }),
    footageShot("shot_090", "assets/footage/a.mp4", { trim_in_sec: 40, trim_out_sec: 45, reuse_reason: "another callback" })
  ];
  const { failures } = analyzeFootageUsage(shots);
  assert.ok(failures.some((f) => f.includes("hard limit")));
});

test("two contiguous shots on the same clip (a pause continuation) count as one use, not two", () => {
  const shots = [
    footageShot("shot_010", "assets/footage/a.mp4", { trim_in_sec: 0, trim_out_sec: 5 }),
    footageShot("shot_011", "assets/footage/a.mp4", { trim_in_sec: 5, trim_out_sec: 9 }) // pause hold, contiguous trim
  ];
  const { failures, usage } = analyzeFootageUsage(shots);
  assert.equal(failures.length, 0);
  assert.equal(usage.find((u) => u.asset === "assets/footage/a.mp4").use_count, 1);
});

test("semantic category density is reported and warns past the repeat limit", () => {
  const shots = [1, 2, 3, 4].map((n) => footageShot(`shot_${n}`, `assets/footage/office_${n}.mp4`));
  shots.forEach((shot) => { shot.editorial_purpose = "Show office workers at their desks."; });
  const { warnings, semanticDensity } = analyzeFootageUsage(shots);
  assert.equal(semanticDensity.office_workers, 4);
  assert.ok(warnings.some((w) => w.includes("office_workers")));
});
