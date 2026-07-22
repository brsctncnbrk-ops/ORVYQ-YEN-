#!/usr/bin/env node
// Weighted pre-render readiness score -- explicitly NOT the final Aperture
// alignment score, which requires human review. Deliberate change vs
// golden: `plan.preview` -> `plan.mode === "proof"`.
import path from "node:path";
import { projectDir, readJson, writeJsonAtomic } from "./lib/fs-utils.mjs";
import { auditMotionHook } from "./lib/orvyq-motion-hook.mjs";
const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

export async function buildAlignmentReadiness(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const [evidence, assetAudit, semantic, pacing, mobile, speech, audio, plan] = await Promise.all([
    readJson(path.join(dir, "qa", "evidence_coverage.json")),
    readJson(path.join(dir, "qa", "evidence_asset_audit.json")),
    readJson(path.join(dir, "qa", "semantic_visual_audit.json")),
    readJson(path.join(dir, "qa", "pacing_audit.json")),
    readJson(path.join(dir, "qa", "mobile_legibility_audit.json")),
    readJson(path.join(dir, "qa", "speech_transcript.json")),
    readJson(path.join(dir, "assets", "audio", "final_mix.metadata.json")),
    readJson(path.join(dir, "direction", "edit_plan.json"))
  ]);
  const motionHook = auditMotionHook(plan);
  const cinematicProof = plan.mode === "proof" && plan.quality_policy?.cinematic_body_footage === true;
  const primaryEvidenceTargets = cinematicProof
    ? { official_capture_fraction: 0.3, source_backed_fraction: 0.55 }
    : { official_capture_fraction: 0.55, source_backed_fraction: null };
  const primaryEvidenceReadiness = cinematicProof
    ? Math.min(clamp01(semantic.official_primary_capture_fraction / primaryEvidenceTargets.official_capture_fraction), clamp01(semantic.evidence_archive_fraction / primaryEvidenceTargets.source_backed_fraction))
    : clamp01(semantic.official_primary_capture_fraction / primaryEvidenceTargets.official_capture_fraction);

  const categories = {
    narration_integrity: { weight: 15, score: clamp01((speech.script_similarity || 0) / 0.98) * 15 },
    physical_primary_evidence: { weight: 25, score: assetAudit.pass ? primaryEvidenceReadiness * 25 : 0, targets: primaryEvidenceTargets },
    source_coverage: { weight: 15, score: clamp01(Math.min(evidence.weighted_supported_coverage, evidence.weighted_visual_evidence_coverage)) * 15 },
    motion_hook_discipline: { weight: 10, score: motionHook.pass && semantic.generic_stock_fraction <= 0.12 && assetAudit.legacy_footage_count === 0 ? 10 : 0 },
    pacing_structure: { weight: 10, score: pacing.pass ? Math.max(7, 10 - pacing.warnings.length) : 0 },
    mobile_hierarchy: { weight: 10, score: mobile.pass ? Math.max(8, 10 - mobile.warnings.length * 0.5) : 0 },
    sound_structure: { weight: 10, score: audio.music_sections?.length >= 3 ? 9 : 6 },
    technical_gate: { weight: 5, score: [evidence, assetAudit, semantic, pacing, mobile].every((audit) => audit.pass) && speech.passed ? 5 : 0 }
  };
  const raw = Object.values(categories).reduce((sum, category) => sum + category.score, 0);
  const ceiling = 90;
  const readiness = Math.min(ceiling, raw * 0.9);
  const pass = readiness >= 82 && Object.values(categories).every((category) => category.score >= category.weight * 0.65);

  const report = {
    schema_version: "1.0-canonical",
    project_id: projectId,
    mode: plan.mode,
    categories,
    raw_technical_points: raw,
    pre_render_readiness_score: readiness,
    automated_readiness_ceiling: ceiling,
    minimum_pre_render_readiness: 82,
    final_aperture_alignment_score: null,
    motion_hook: motionHook,
    human_rendered_video_review: {
      required: true,
      status: "pending",
      dimensions: ["actual primary evidence readability", "visual meaning and emotional resonance", "directed cinematic composition", "music arc", "whether the film feels authored rather than assembled"]
    },
    note: "This score is only a pre-render integrity gate. Automated metadata can never award or imply 95% Aperture alignment.",
    pass
  };
  await writeJsonAtomic(path.join(dir, "qa", "alignment_readiness.json"), report);
  if (!pass) throw new Error(`ORVYQ pre-render readiness ${readiness.toFixed(1)} is below 82`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildAlignmentReadiness()
    .then((report) => console.log(JSON.stringify({ ok: true, pre_render_readiness_score: report.pre_render_readiness_score, automated_readiness_ceiling: report.automated_readiness_ceiling, final_aperture_alignment_score: null })))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
