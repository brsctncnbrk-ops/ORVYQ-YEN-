#!/usr/bin/env node
// Mobile-legibility gate for evidence/overlay typography. Logic unchanged
// from golden; de-minified for readability during the rebuild.
import path from "node:path";
import { projectDir, readJson, writeJsonAtomic } from "./lib/fs-utils.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const IMAGE_KINDS = new Set(["split_documents", "official_document", "official_figure", "official_screen", "image_sequence", "recap"]);
const len = (value) => String(value || "").trim().length;

export async function runMobileLegibilityAudit(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const [plan, blueprint] = await Promise.all([
    readJson(path.join(dir, "direction", "edit_plan.json")),
    readJson(path.join(dir, "direction", "editorial_blueprint.json"))
  ]);
  const rules = blueprint.global_rules;
  const failures = [];
  const warnings = [];
  const reports = [];

  for (const shot of plan.shots) {
    const spec = shot.asset_type === "evidence" ? shot.evidence : shot.editorial_overlay;
    if (!spec) continue;
    const duration = (shot.end_frame - shot.start_frame) / plan.fps;
    const fontPx = Number(spec.font_px || 0);
    const titleChars = len(spec.title);
    const subtitleChars = len(spec.subtitle);
    const calloutChars = len(spec.callout);
    const limitationChars = len(spec.limitation);
    const sourceChars = len(spec.source_label || spec.eyebrow);
    if (fontPx < Number(rules.minimum_overlay_font_px || 28)) failures.push(`${shot.shot_id} font ${fontPx}px is below mobile minimum`);
    if (titleChars > 76) warnings.push(`${shot.shot_id} title has ${titleChars} characters`);
    if (subtitleChars > 150) failures.push(`${shot.shot_id} subtitle is too long`);
    if (calloutChars > 175) failures.push(`${shot.shot_id} callout is too long`);
    if (limitationChars > 150) warnings.push(`${shot.shot_id} limitation is long`);
    if (!sourceChars) failures.push(`${shot.shot_id} has no visible source/date hierarchy`);
    if (shot.asset_type === "evidence" && !(spec.source_ids || []).length) failures.push(`${shot.shot_id} has no source IDs`);
    if (IMAGE_KINDS.has(spec.kind) && duration < 4) failures.push(`${shot.shot_id} official evidence lasts only ${duration.toFixed(2)}s`);
    reports.push({ shot_id: shot.shot_id, type: spec.kind || spec.type, font_px: fontPx, duration_seconds: duration, title_chars: titleChars, source_chars: sourceChars, limitation_chars: limitationChars });
  }

  const report = {
    schema_version: "1.0-canonical",
    project_id: projectId,
    mode: plan.mode,
    minimum_font_px: Number(rules.minimum_overlay_font_px || 28),
    evidence_scenes: reports,
    warnings,
    failures,
    pass: failures.length === 0
  };
  await writeJsonAtomic(path.join(dir, "qa", "mobile_legibility_audit.json"), report);
  if (!report.pass) throw new Error(`ORVYQ mobile legibility audit failed: ${failures.join("; ")}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMobileLegibilityAudit().then((report) => console.log(JSON.stringify({ ok: true, ...report }))).catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  });
}
