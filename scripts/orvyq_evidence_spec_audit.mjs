#!/usr/bin/env node
// Evidence-spec content gate -- fails BEFORE render when an evidence shot's
// authored PrimaryEvidenceSpec content (templates/remotion/src/types/
// evidence.ts) is missing, generic, empty, duplicated against its
// immediate neighbour, or contains a number this project's own verified
// data cannot support. This is deliberately separate from
// scripts/orvyq_mobile_legibility_audit.mjs (typography/length only) and
// scripts/orvyq_evidence_audit.mjs (weighted claim/source coverage only):
// neither of those checks that a shot's eyebrow/title/items/steps/left-
// right actually carry real authored content, which is exactly the defect
// class that let scripts/orvyq_full_production_plan.mjs ship 55 evidence
// shots with only kind/source_ids/source_label/font_px.
import path from "node:path";
import { projectDir, readJson, writeJsonAtomic } from "./lib/fs-utils.mjs";
import { loadResolvedEvidenceMap } from "./lib/orvyq-evidence.mjs";
import { claimLimitation } from "./lib/orvyq-evidence-authoring.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const TIMELINE_KINDS = new Set(["source_timeline", "source_article"]);
const CHAIN_KINDS = new Set(["concept_map", "evidence_chain"]);
const CONTRAST_KINDS = new Set(["comparison", "boundary"]);

const GENERIC_STRINGS = new Set(["evidence", "source", "untitled", "evidence card", "source evidence", "graphic", "context", "primary evidence", "verified context", "evidence boundary"]);

export function isGeneric(text, claimId, kind) {
  const clean = String(text || "").trim();
  if (!clean) return true;
  const lower = clean.toLowerCase();
  if (GENERIC_STRINGS.has(lower)) return true;
  if (clean === claimId) return true;
  if (lower === String(kind || "").toLowerCase().replace(/_/g, " ")) return true;
  return false;
}

// A conservative proxy for "body content contains unsupported information":
// every standalone 2+ digit number appearing in a shot's authored text must
// also appear, as a substring, somewhere in that claim's own verified data
// (narration_excerpt, evidence_requirements, recommended_rewrite, its
// cited sources' title/publisher/publication_date/limitation, and its
// section's title/dramatic_function). A number that appears nowhere in that
// real data was not derived from it -- exactly how the renderer's former
// hardcoded "16 leading models stress-tested" (real for CLM_004, fabricated
// for every OTHER source_article shot that inherited it) would be caught.
const NUMBER_TOKEN = /\b\d{2,}(?:\.\d+)?\b/g;

export function collectNumbers(text) {
  return [...String(text || "").matchAll(NUMBER_TOKEN)].map((match) => match[0]);
}

export function bodyText(evidence) {
  const parts = [evidence.title, evidence.eyebrow];
  for (const item of evidence.items || []) parts.push(item.label, item.value, item.detail);
  for (const step of evidence.steps || []) parts.push(step);
  parts.push(evidence.left, evidence.right, evidence.left_detail, evidence.right_detail, evidence.limitation);
  return parts.filter(Boolean).join(" \n ");
}

export function allowedText(claim, sources, section) {
  const parts = [claim.narration_excerpt, ...(claim.evidence_requirements || []), claim.recommended_rewrite];
  for (const source of sources) parts.push(source.title, source.publisher, source.publication_date, source.limitation);
  if (section) parts.push(section.title, section.dramatic_function);
  return parts.filter(Boolean).join(" \n ");
}

export function evidenceContentSignature(evidence) {
  return JSON.stringify({ eyebrow: evidence.eyebrow, title: evidence.title, items: evidence.items, steps: evidence.steps, left: evidence.left, right: evidence.right });
}

// Evaluates every content rule for a single evidence shot against its own
// claim/sources/section and (optionally) the immediately preceding evidence
// shot, returning the list of failure strings -- factored out of
// runEvidenceSpecAudit's file-reading loop so it's directly unit-testable
// against synthetic fixtures without needing a real project on disk.
export function evaluateEvidenceShot({ shot, evidence, claim, sourceById, section, previousEvidence }) {
  const failures = [];
  const kind = evidence.kind;

  if (!evidence.title) failures.push(`${shot.shot_id} is missing a title`);
  else if (isGeneric(evidence.title, shot.claim_id, kind)) failures.push(`${shot.shot_id} title is generic or empty: "${evidence.title}"`);

  if (!evidence.eyebrow) failures.push(`${shot.shot_id} is missing an eyebrow`);
  else if (isGeneric(evidence.eyebrow, shot.claim_id, kind)) failures.push(`${shot.shot_id} eyebrow is generic or empty: "${evidence.eyebrow}"`);

  const sourceIds = evidence.source_ids || [];
  if (!sourceIds.length) failures.push(`${shot.shot_id} has no source_ids`);
  for (const sourceId of sourceIds) if (!sourceById.has(sourceId)) failures.push(`${shot.shot_id} references unknown source ${sourceId}`);
  if (!evidence.source_label) failures.push(`${shot.shot_id} is missing a source_label`);

  if (TIMELINE_KINDS.has(kind) && !(evidence.items || []).length) failures.push(`${shot.shot_id} (${kind}) has no items`);
  if (CHAIN_KINDS.has(kind) && !(evidence.steps || []).length) failures.push(`${shot.shot_id} (${kind}) has no steps`);
  if (CONTRAST_KINDS.has(kind) && (!evidence.left || !evidence.right)) failures.push(`${shot.shot_id} (${kind}) has empty left or right content`);

  if (previousEvidence && evidenceContentSignature(previousEvidence.evidence) === evidenceContentSignature(evidence))
    failures.push(`${previousEvidence.shot_id} and ${shot.shot_id} are consecutive evidence scenes with identical authored content`);

  if (claim) {
    const ownSourceIds = (claim.source_ids || []).filter((id) => sourceById.has(id));
    const ownSources = ownSourceIds.map((id) => sourceById.get(id));
    const requiredLimitation = claimLimitation(claim, ownSources);
    if (requiredLimitation && !evidence.limitation) failures.push(`${shot.shot_id} omits ${claim.claim_id}'s required limitation`);

    const displaySources = sourceIds.map((id) => sourceById.get(id)).filter(Boolean);
    const allowed = allowedText(claim, [...new Set([...ownSources, ...displaySources])], section).toLowerCase();
    const unsupported = [...new Set(collectNumbers(bodyText(evidence)))].filter((number) => !allowed.includes(number.toLowerCase()));
    if (unsupported.length) failures.push(`${shot.shot_id} body contains number(s) not traceable to ${claim.claim_id}'s own verified data: ${unsupported.join(", ")}`);
  }

  return failures;
}

export async function runEvidenceSpecAudit(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const [plan, map] = await Promise.all([
    readJson(path.join(dir, "direction", "edit_plan.json")),
    loadResolvedEvidenceMap(dir)
  ]);
  const claimById = new Map(map.claims.map((claim) => [claim.claim_id, claim]));
  const sourceById = new Map(map.source_catalog.map((source) => [source.source_id, source]));
  const sectionById = new Map(map.sections.map((section) => [section.section_id, section]));

  const failures = [];
  const warnings = [];
  const shotReports = [];
  let previousEvidenceShot = null;

  for (const shot of plan.shots) {
    if (shot.asset_type !== "evidence") {
      previousEvidenceShot = null;
      continue;
    }
    const evidence = shot.evidence || {};
    const kind = evidence.kind;
    const claim = claimById.get(shot.claim_id);
    if (!claim) warnings.push(`${shot.shot_id} has no matching claim; limitation and unsupported-content checks were skipped`);

    failures.push(...evaluateEvidenceShot({ shot, evidence, claim, sourceById, section: sectionById.get(shot.section_id), previousEvidence: previousEvidenceShot }));

    shotReports.push({ shot_id: shot.shot_id, claim_id: shot.claim_id, kind, eyebrow: evidence.eyebrow, title: evidence.title, has_limitation: Boolean(evidence.limitation) });
    previousEvidenceShot = shot;
  }

  const report = {
    schema_version: "1.0-canonical",
    project_id: projectId,
    mode: plan.mode,
    evidence_shot_count: shotReports.length,
    shots: shotReports,
    warnings,
    failures,
    pass: failures.length === 0
  };
  await writeJsonAtomic(path.join(dir, "qa", "evidence_spec_audit.json"), report);
  if (!report.pass) throw new Error(`ORVYQ evidence spec audit failed: ${failures.join("; ")}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runEvidenceSpecAudit()
    .then((report) => console.log(JSON.stringify({ ok: true, ...report })))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
