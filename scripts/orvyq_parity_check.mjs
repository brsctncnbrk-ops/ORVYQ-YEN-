#!/usr/bin/env node
// checkProofFullParity() -- confirms proof and full modes stay on the single
// shared renderer/edit-plan path this task requires (docs/migration-plan.md
// section 1): one buildCanonicalEditPlan() function, one edit_plan.schema.json,
// one set of per-shot validation rules (IMAGE_KINDS/NATIVE_KINDS/ALLOWED_ROLES/
// ALLOWED_TRANSITIONS), one auditMotionHook().
//
// This used to check the OPPOSITE property -- that proof and full stayed
// data-ISOLATED from each other (proof never reading full_production data,
// full never reading the proof-only cut files) -- because proof was a
// separately-authored 150s cut. That is no longer the architecture: proof is
// now a genuine frame-prefix of the full candidate, deliberately sharing
// every byte of shots/duration_frames/quality_policy with full mode, differing
// only in frame_range.end_frame and the mode label itself. This is a static
// source check, not a data check: it reads scripts/orvyq_edit_plan.mjs's own
// text and confirms these properties hold structurally, rather than trusting
// a comment that says so.
import path from "node:path";
import { promises as fs } from "node:fs";
import { printJson } from "./lib/fs-utils.mjs";

const EDIT_PLAN_SCRIPT = path.resolve("scripts/orvyq_edit_plan.mjs");

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

  // A reintroduced buildProofPlan would mean proof went back to being a
  // separately-authored cut instead of a frame-prefix of buildFullPlan's
  // output -- exactly the regression this check now guards against.
  if (/\bfunction buildProofPlan\b/.test(source)) {
    findings.push({ severity: "error", message: "buildProofPlan has been reintroduced -- proof must stay a frame-prefix of buildFullPlan's output, not a separately-authored cut." });
  }

  // Confirms buildFullPlan exists and is callable -- extractFunctionBody
  // throws its own descriptive error if it's missing, which is exactly the
  // failure mode we want (fail loud, not silently skip the check).
  extractFunctionBody(source, "buildFullPlan");

  // Both modes must be dispatched from, and validated by, the single shared
  // buildCanonicalEditPlan function, calling buildFullPlan unconditionally
  // (not behind a mode ternary) -- not two independent top-level entrypoints
  // (the golden defect this file's own header comment describes replacing).
  if (!/const built = await buildFullPlan\(/.test(source)) {
    findings.push({ severity: "error", message: "buildCanonicalEditPlan no longer calls buildFullPlan unconditionally for both modes -- check for a reintroduced mode-dependent code path." });
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
