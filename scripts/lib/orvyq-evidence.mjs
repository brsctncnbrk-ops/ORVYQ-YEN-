import path from "node:path";
import { readJson, pathExists } from "./fs-utils.mjs";

export async function loadResolvedEvidenceMap(dir) {
  const base = await readJson(path.join(dir, "research", "evidence_map.json"));
  const resolutionPath = path.join(dir, "research", "evidence_resolutions.json");
  if (!(await pathExists(resolutionPath))) return base;

  const resolutions = await readJson(resolutionPath);
  const sourceMap = new Map(base.source_catalog.map((source) => [source.source_id, source]));
  for (const source of resolutions.source_additions || []) sourceMap.set(source.source_id, source);

  const claimMap = new Map(base.claims.map((claim) => [claim.claim_id, claim]));
  for (const claim of resolutions.claim_additions || []) {
    if (claimMap.has(claim.claim_id)) throw new Error(`Evidence claim addition duplicates ${claim.claim_id}`);
    claimMap.set(claim.claim_id, claim);
  }
  for (const override of resolutions.claim_overrides || []) {
    const existing = claimMap.get(override.claim_id);
    if (!existing) throw new Error(`Evidence resolution references unknown claim ${override.claim_id}`);
    claimMap.set(override.claim_id, { ...existing, ...override });
  }

  return {
    ...base,
    schema_version: `${base.schema_version}+resolution-${resolutions.schema_version || "1.0"}`,
    resolution_note: resolutions.note || null,
    source_catalog: [...sourceMap.values()],
    claims: [...claimMap.values()],
  };
}
