#!/usr/bin/env node
// Reports the REAL, materialized on-disk duration (from each asset's own
// provenance companion) of every footage clip FOOTAGE_ASSIGNMENTS or
// FULL_FOOTAGE_POOL references, alongside how much of that real duration
// every declared assignment (including multi-slice spans) actually
// consumes. This exists so a real trim-overrun failure (an assignment's
// trimInRatio/span asking for more of a clip than it actually has) can be
// diagnosed directly from a single CI artifact, without needing the real
// footage files locally -- see docs/canonical-candidate-audit.md.
import path from "node:path";
import { projectDir, readJson, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { FOOTAGE_ASSIGNMENTS, FULL_FOOTAGE_POOL, HOOK_PRELOADED_USAGE } from "./orvyq_full_production_plan.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";

export async function buildFootageDurationReport(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const assets = [...new Set([...FULL_FOOTAGE_POOL, ...Object.keys(HOOK_PRELOADED_USAGE)])].sort();
  const rows = [];
  for (const asset of assets) {
    let realDurationSeconds = null;
    let error = null;
    try {
      const provenance = await readJson(path.join(dir, `${asset}.provenance.json`));
      realDurationSeconds = Number(provenance.actual_duration_seconds ?? provenance.duration);
      if (!Number.isFinite(realDurationSeconds)) throw new Error("provenance has no usable duration field");
    } catch (readError) {
      error = readError.message;
    }
    const declaredUses = [];
    for (const [claimId, table] of Object.entries(FOOTAGE_ASSIGNMENTS)) {
      for (const [sliceIndex, entry] of Object.entries(table)) {
        if (entry.asset === asset) {
          const span = Math.max(1, Math.round(Number(entry.span) || 1));
          declaredUses.push({ claim_id: claimId, start_slice_index: Number(sliceIndex), span, trim_in_ratio: entry.trimInRatio });
        }
      }
    }
    rows.push({
      asset,
      real_duration_seconds: realDurationSeconds,
      real_duration_error: error,
      hook_preloaded_uses: HOOK_PRELOADED_USAGE[asset] || 0,
      declared_assignments: declaredUses
    });
  }
  return { schema_version: "1.0", project_id: projectId, assets: rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  buildFootageDurationReport(args["project-id"] || PROJECT_ID)
    .then((report) => printJson({ ok: true, ...report }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
