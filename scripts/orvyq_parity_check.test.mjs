import { test } from "node:test";
import assert from "node:assert/strict";
import { checkProofFullParity, checkNoRenderTimeNetworkFetch } from "./orvyq_parity_check.mjs";

test("checkProofFullParity passes against the real scripts/orvyq_edit_plan.mjs and surfaces the known cinematic_body_footage asymmetry", async () => {
  const result = await checkProofFullParity();
  assert.equal(result.pass, true);
  assert.ok(result.findings.some((f) => f.severity === "warning" && f.message.includes("cinematic_body_footage")));
  assert.equal(result.findings.filter((f) => f.severity === "error").length, 0);
});

test("checkNoRenderTimeNetworkFetch passes: no render-time script calls fetch()", async () => {
  const result = await checkNoRenderTimeNetworkFetch();
  assert.equal(result.pass, true);
  assert.equal(result.findings.length, 0);
});
