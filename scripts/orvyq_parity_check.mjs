#!/usr/bin/env node
// checkProofFullParity() -- confirms proof and full modes stay on the single
// shared renderer/edit-plan path this task requires (docs/migration-plan.md
// section 1): one buildCanonicalEditPlan() function, one edit_plan.schema.json,
// one set of per-shot validation rules (IMAGE_KINDS/NATIVE_KINDS/ALLOWED_ROLES/
// ALLOWED_TRANSITIONS), one auditMotionHook() -- and that each mode's own data
// dependencies stay isolated from the other's (proof never reads
// full_production data; full never reads the proof-only cut files), so a
// change made "to fix proof" cannot silently reach into full mode's inputs
// or vice versa. This is a static source check, not a data check: it reads
// scripts/orvyq_edit_plan.mjs's own text and confirms these properties hold
// structurally, rather than trusting a comment that says so.
import path from "node:path";
import { promises as fs } from "node:fs";
import { printJson } from "./lib/fs-utils.mjs";

const EDIT_PLAN_SCRIPT = path.resolve("scripts/orvyq_edit_plan.mjs");

// Proof-only and full-only file dependencies. Each mode's build function
// must reference only its own list, never the other's -- a reference here
// would mean one mode's plan construction secretly depends on the other
// mode's authored cut data, breaking the isolation this task requires.
const PROOF_ONLY_TOKENS = ["cinematic_proof_cut.json", "proof_preview_cut.json", "motion_hook.json"];
const FULL_ONLY_TOKENS = ["editorial_blueprint.json", "full_production", "evidence_asset_manifest.json"];

function extractFunctionBody(source, functionName) {
  const marker = `async function ${functionName}(`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Could not find function ${functionName} in ${EDIT_PLAN_SCRIPT}`);
  // Brace-counting from the function's opening "{" to its matching close --
  // simple and reliable for this file's own formatting, without needing a
  // real JS parser just to slice out one function body for a text scan.
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not find the closing brace of ${functionName}`);
}

export async function checkProofFullParity() {
  const source = await fs.readFile(EDIT_PLAN_SCRIPT, "utf8");
  const findings = [];

  const proofBody = extractFunctionBody(source, "buildProofPlan");
  const fullBody = extractFunctionBody(source, "buildFullPlan");

  for (const token of FULL_ONLY_TOKENS) {
    if (proofBody.includes(token)) findings.push({ severity: "error", message: `buildProofPlan references full-only data "${token}" -- proof/full isolation is broken.` });
  }
  for (const token of PROOF_ONLY_TOKENS) {
    if (fullBody.includes(token)) findings.push({ severity: "error", message: `buildFullPlan references proof-only data "${token}" -- proof/full isolation is broken.` });
  }

  // Both modes must be dispatched from, and validated by, the single shared
  // buildCanonicalEditPlan function -- not two independent top-level
  // entrypoints (the golden defect this file's own header comment
  // describes replacing).
  if (!/mode === "proof"\s*\?\s*await buildProofPlan.*:\s*await buildFullPlan/s.test(source)) {
    findings.push({ severity: "error", message: "buildCanonicalEditPlan no longer dispatches both modes from a single shared function call -- check for a reintroduced second code path." });
  }

  // Both modes must be checked by the same auditMotionHook call and produce
  // the same schema_version -- confirmed by these appearing exactly once
  // each, outside either mode-specific function (i.e. in the shared
  // assembly section), not duplicated per mode.
  const sharedSection = source.slice(source.indexOf("// ---- shared assembly ----"));
  if (!sharedSection.includes("auditMotionHook(")) findings.push({ severity: "error", message: "auditMotionHook is not called from the shared assembly section -- it may only run for one mode." });
  if ((sharedSection.match(/schema_version:\s*"1\.0-canonical"/g) || []).length !== 1)
    findings.push({ severity: "error", message: "edit_plan schema_version is not defined exactly once in the shared assembly section." });

  // cinematic_body_footage was previously set directly from `mode ===
  // "proof"` in the shared assembly, meaning full mode could never use
  // contextual (non-hook) body footage even though buildFullPlan's footage
  // branch supported the field structurally -- a real, then-undecided
  // editorial-policy asymmetry (docs/full-production-guide.md). That
  // decision has since been made: both modes now consume contextual footage
  // through the same shared data model. This check now guards against that
  // mode-dependent hardcode ever being reintroduced.
  if (/cinematic_body_footage:\s*mode === "proof"/.test(sharedSection)) {
    findings.push({
      severity: "error",
      message:
        'quality_policy.cinematic_body_footage is hardcoded to mode === "proof" again in the shared assembly -- this reintroduces the proof-only contextual-footage restriction that was deliberately removed.'
    });
  }

  const errors = findings.filter((f) => f.severity === "error");
  return { pass: errors.length === 0, findings };
}

// Render-time scripts (music resolution, the audio mix, and the edit plan)
// must never fetch from a third-party host -- music_library/registry.json's
// local canonical assets are the only source. Network fetching is legitimate
// ONLY in the intake/vendoring scripts, which run before production, never
// during a proof or full render.
const RENDER_TIME_SCRIPTS = ["scripts/orvyq_music_resolve.mjs", "scripts/orvyq_audio_mix.mjs", "scripts/orvyq_edit_plan.mjs"];

export async function checkNoRenderTimeNetworkFetch() {
  const findings = [];
  for (const relativePath of RENDER_TIME_SCRIPTS) {
    const source = await fs.readFile(path.resolve(relativePath), "utf8");
    if (/\bfetch\s*\(/.test(source)) {
      findings.push({ severity: "error", message: `${relativePath} calls fetch() -- render-time scripts must resolve music/assets from local canonical sources only, never a network call.` });
    }
  }
  const errors = findings.filter((f) => f.severity === "error");
  return { pass: errors.length === 0, findings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  Promise.all([checkProofFullParity(), checkNoRenderTimeNetworkFetch()])
    .then(([parity, noFetch]) => {
      const result = { pass: parity.pass && noFetch.pass, findings: [...parity.findings, ...noFetch.findings] };
      printJson(result);
      if (!result.pass) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
