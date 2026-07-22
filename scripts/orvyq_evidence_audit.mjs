#!/usr/bin/env node
// Weighted claim/source coverage gate -- shared by both render modes.
// Deliberate change vs golden: `plan.preview` (boolean) is now
// `plan.mode === "proof"` / `plan.mode === "full"`, matching the canonical
// edit_plan.schema.json shape from Phase 2/3. Logic is otherwise unchanged.
import path from "node:path";
import { projectDir, readJson, writeJsonAtomic } from "./lib/fs-utils.mjs";
import { loadResolvedEvidenceMap } from "./lib/orvyq-evidence.mjs";
import { auditMotionHook } from "./lib/orvyq-motion-hook.mjs";
const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const ALLOWED_STATUSES = new Set(["verified", "attributed_commentary"]);
const unique = (values) => [...new Set(values.filter(Boolean))];
const sourceIdsFor = (shot) =>
  unique([...(shot.evidence?.source_ids || []), ...(shot.editorial_overlay?.source_ids || [])]);
const isClaimSpecificEvidence = (shot) =>
  shot.asset_type === "evidence"
    ? sourceIdsFor(shot).length > 0
    : shot.asset_type === "graphic"
      ? sourceIdsFor(shot).length > 0 && shot.source_derived === true
      : false;

export async function runEvidenceAudit(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const [map, plan] = await Promise.all([loadResolvedEvidenceMap(dir), readJson(path.join(dir, "direction", "edit_plan.json"))]);
  const claimById = new Map(map.claims.map((claim) => [claim.claim_id, claim]));
  const sourceById = new Map(map.source_catalog.map((source) => [source.source_id, source]));
  const activeClaimIds = unique(plan.shots.map((shot) => shot.claim_id));
  const failures = [];
  const warnings = [];
  const claimReports = [];
  let totalWeight = 0, supportedWeight = 0, evidenceWeight = 0;
  const isProof = plan.mode === "proof";

  for (const shot of plan.shots) {
    if (!shot.claim_id || !claimById.has(shot.claim_id)) {
      failures.push(`${shot.shot_id} is missing a valid claim_id`);
      continue;
    }
    const usedSourceIds = sourceIdsFor(shot);
    for (const sourceId of usedSourceIds) if (!sourceById.has(sourceId)) failures.push(`${shot.shot_id} references unknown source ${sourceId}`);
    if (["evidence", "archive"].includes(shot.visual_role) && !isClaimSpecificEvidence(shot))
      failures.push(`${shot.shot_id} is marked ${shot.visual_role} but is not a source-backed evidence asset`);
    if (
      isProof && shot.asset_type === "footage" && shot.hook_footage !== true &&
      !(plan.quality_policy?.cinematic_body_footage === true && shot.contextual_footage === true && shot.provenance_mode === "approved_contextual_footage")
    )
      failures.push(`${shot.shot_id} uses unapproved footage outside the opening hook`);
  }
  const motionHook = auditMotionHook(plan);
  if (!motionHook.pass) failures.push(...motionHook.failures);

  for (const claimId of activeClaimIds) {
    const claim = claimById.get(claimId);
    if (!claim || claim.status === "removed") continue;
    const weight = Number(claim.importance || 1);
    totalWeight += weight;
    const shots = plan.shots.filter((shot) => shot.claim_id === claimId);
    const evidenceShots = shots.filter(isClaimSpecificEvidence);
    const usedSourceIds = unique(shots.flatMap(sourceIdsFor));
    const missingDeclaredSources = (claim.source_ids || []).filter((sourceId) => !sourceById.has(sourceId));
    if (missingDeclaredSources.length) failures.push(`${claimId} has unknown declared sources: ${missingDeclaredSources.join(", ")}`);
    const statusPass = ALLOWED_STATUSES.has(claim.status);
    if (statusPass) supportedWeight += weight;
    else failures.push(`${claimId} is active but status is ${claim.status}`);
    const critical = weight >= 5;
    const evidencePass = evidenceShots.length > 0 && (!critical || usedSourceIds.length > 0 || claim.status === "attributed_commentary");
    if (evidencePass) evidenceWeight += weight;
    else failures.push(`${claimId} has no physical, source-backed visual evidence`);
    if (claim.status === "attributed_commentary" && !shots.some((shot) => sourceIdsFor(shot).length))
      warnings.push(`${claimId} is attributed commentary but has no explicit source context`);
    claimReports.push({ claim_id: claimId, status: claim.status, importance: weight, shot_count: shots.length, physical_evidence_shot_count: evidenceShots.length, source_ids_used: usedSourceIds, status_pass: statusPass, evidence_pass: evidencePass });
  }

  const supportedCoverage = totalWeight ? supportedWeight / totalWeight : 0;
  const visualEvidenceCoverage = totalWeight ? evidenceWeight / totalWeight : 0;
  const minimum = isProof ? 0.9 : Number(map.full_render_gate?.minimum_weighted_verified_or_attributed_coverage || 0.9);
  if (supportedCoverage < minimum) failures.push(`weighted source coverage ${(supportedCoverage * 100).toFixed(1)}% is below ${(minimum * 100).toFixed(1)}%`);
  if (visualEvidenceCoverage < minimum) failures.push(`weighted physical visual-evidence coverage ${(visualEvidenceCoverage * 100).toFixed(1)}% is below ${(minimum * 100).toFixed(1)}%`);
  if (plan.mode === "full") {
    const unresolved = map.claims.filter((claim) => ["rewrite_required", "source_required"].includes(claim.status));
    if (unresolved.length) failures.push(`full render blocked by unresolved claims: ${unresolved.map((claim) => claim.claim_id).join(", ")}`);
  }

  const report = {
    schema_version: "1.0-canonical",
    project_id: projectId,
    mode: plan.mode,
    resolved_evidence_schema: map.schema_version,
    active_claim_count: activeClaimIds.length,
    weighted_supported_coverage: supportedCoverage,
    weighted_visual_evidence_coverage: visualEvidenceCoverage,
    minimum_required: minimum,
    metadata_only_evidence_rejected: true,
    motion_hook: motionHook,
    claim_reports: claimReports,
    warnings,
    failures,
    pass: failures.length === 0
  };
  await writeJsonAtomic(path.join(dir, "qa", "evidence_coverage.json"), report);
  if (!report.pass) throw new Error(`ORVYQ evidence audit failed: ${failures.join("; ")}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runEvidenceAudit()
    .then((report) => console.log(JSON.stringify({ ok: true, ...report })))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
