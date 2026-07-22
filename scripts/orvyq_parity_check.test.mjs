import { test } from "node:test";
import assert from "node:assert/strict";
import { checkProofFullParity, checkNoRenderTimeNetworkFetch } from "./orvyq_parity_check.mjs";

test("checkProofFullParity passes against the real scripts/orvyq_edit_plan.mjs with no cinematic_body_footage mode asymmetry", async () => {
  const result = await checkProofFullParity();
  assert.equal(result.pass, true);
  assert.equal(result.findings.length, 0);
});

test("checkNoRenderTimeNetworkFetch passes: no render-time script calls fetch()", async () => {
  const result = await checkNoRenderTimeNetworkFetch();
  assert.equal(result.pass, true);
  assert.equal(result.findings.length, 0);
});
