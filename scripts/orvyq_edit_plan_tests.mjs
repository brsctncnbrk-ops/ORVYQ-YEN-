#!/usr/bin/env node
// Whole-pipeline smoke test over the canonical edit plan, captions, and
// upstream QA reports. Deliberate changes vs golden (docs/migration-plan.md
// section 1 / docs/source-audit.md section 7):
//  - `plan.preview` -> `plan.mode === "proof"` / `"full"`.
//  - No longer reads remotion/composition.json (that authoring surface is
//    gone, see scripts/remotion_build.mjs); the invariant it checked
//    (plan.duration_frames <= composition.duration_frames) is replaced with
//    the meaningful one in the new model: frame_range.end_frame <=
//    duration_frames.
//  - audioMetadata.pause_windows now uses start_seconds/end_seconds
//    (schemas/audio_mix.schema.json), not start/end.
//  - The full-mode human-approval gate now checks qa/proof_approval.json
//    against schemas/proof_approval.schema.json's actual shape
//    (frozen_candidate_hash + approved), not an ad-hoc aperture_alignment_score
//    field that duplicated the same concept under a different name.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { projectDir, readJson, pathExists } from "./lib/fs-utils.mjs";
import { loadResolvedEvidenceMap } from "./lib/orvyq-evidence.mjs";
import { auditMotionHook } from "./lib/orvyq-motion-hook.mjs";
const run = promisify(execFile);
const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const VALID_ROLES = new Set(["evidence", "archive", "context", "metaphor", "graphic"]);
const VALID_KINDS = new Set(["split_documents", "official_document", "official_figure", "official_screen", "image_sequence", "source_timeline", "source_article", "concept_map", "boundary", "comparison", "recap", "evidence_chain"]);
const IMAGE_KINDS = new Set(["split_documents", "official_document", "official_figure", "official_screen", "image_sequence", "recap"]);
const FORBIDDEN = new Set(["benchmark", "market_pressure", "forecast", "trend_chart", "bar_chart", "line_chart"]);

async function videoDuration(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", file]);
  return Number.parseFloat(stdout.trim());
}

export async function validateCanonicalEditPlan(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const [plan, captions, audioMetadata, speechQa, blueprint, evidenceMap, evidenceAudit, assetAudit, semanticAudit, pacingAudit, mobileAudit] = await Promise.all([
    readJson(path.join(dir, "direction", "edit_plan.json")),
    readJson(path.join(dir, "remotion", "captions.json")),
    readJson(path.join(dir, "assets", "audio", "final_mix.metadata.json")),
    readJson(path.join(dir, "qa", "speech_transcript.json")),
    readJson(path.join(dir, "direction", "editorial_blueprint.json")),
    loadResolvedEvidenceMap(dir),
    readJson(path.join(dir, "qa", "evidence_coverage.json")),
    readJson(path.join(dir, "qa", "evidence_asset_audit.json")),
    readJson(path.join(dir, "qa", "semantic_visual_audit.json")),
    readJson(path.join(dir, "qa", "pacing_audit.json")),
    readJson(path.join(dir, "qa", "mobile_legibility_audit.json"))
  ]);
  const isProof = plan.mode === "proof";
  const shots = plan.shots;
  const claimIds = new Set(evidenceMap.claims.filter((claim) => claim.status !== "removed").map((claim) => claim.claim_id));
  const sourceIds = new Set(evidenceMap.source_catalog.map((source) => source.source_id));
  const maxUses = Number(blueprint.global_rules.max_uses_per_source || 2);

  assert.equal(plan.schema_version, "1.0-canonical");
  assert.ok(["proof", "full"].includes(plan.mode));
  assert.equal(plan.production_mode, "evidence_led_video_essay");
  assert.equal(plan.audio_mix_asset, "assets/audio/final_mix.mp3");
  assert.equal(plan.captions_asset, "remotion/captions.json");
  assert.ok(await pathExists(path.join(dir, plan.audio_mix_asset)));
  assert.equal(audioMetadata.procedural_noise_generation, false);
  assert.ok(["original_tonal_score", "approved_licensed_bed"].includes(audioMetadata.music_profile));
  if (plan.quality_policy?.cinematic_body_footage) {
    assert.equal(audioMetadata.sfx_origin, "original_synthesized_sfx");
    assert.ok((audioMetadata.sfx_assets || []).length >= 3);
    assert.ok((audioMetadata.pause_windows || []).length >= 4);
    assert.ok(audioMetadata.editorial_pause_seconds >= 20);
  } else {
    assert.deepEqual(audioMetadata.sfx_assets, []);
  }
  assert.equal(speechQa.passed, true);
  assert.ok(speechQa.script_similarity >= Number(blueprint.global_rules.minimum_script_similarity || 0.85));
  for (const audit of [evidenceAudit, assetAudit, semanticAudit, pacingAudit, mobileAudit]) assert.equal(audit.pass, true, `audit failed: ${(audit.failures || []).join(", ")}`);
  assert.ok(Array.isArray(shots) && shots.length);
  assert.equal(shots[0].start_frame, 0);
  assert.equal(shots.at(-1).end_frame, plan.duration_frames);
  assert.ok(plan.frame_range.end_frame <= plan.duration_frames);
  assert.ok(plan.frame_range.start_frame === 0);

  const motionHook = auditMotionHook(plan);
  assert.equal(motionHook.pass, true, motionHook.failures.join(", "));
  if (isProof) {
    assert.equal(plan.quality_policy?.proof_body_stock_assets_forbidden, !plan.quality_policy?.cinematic_body_footage);
    assert.equal(plan.quality_policy?.motion_hook_required, true);
    assert.equal(plan.quality_policy?.metadata_cannot_define_evidence, true);
  }

  const imageUsage = new Map();
  const evidenceUsage = new Map();
  const footageUsage = new Map();
  const shotDurations = new Set();
  let pureGraphicFrames = 0, evidenceFrames = 0, contextualFootageFrames = 0, emphasisBeats = 0, previousSignature = null, previousFootage = null;

  for (let index = 0; index < shots.length; index++) {
    const shot = shots[index];
    const frames = shot.end_frame - shot.start_frame;
    const seconds = frames / plan.fps;
    shotDurations.add(frames);
    if (shot.asset_type !== "footage") previousFootage = null;
    assert.ok(frames > 0 && seconds <= Number(blueprint.global_rules.max_shot_seconds || 8) + 0.001, `${shot.shot_id} invalid duration`);
    if (index > 0) assert.equal(shot.start_frame, shots[index - 1].end_frame);
    assert.ok(["cut", "fade", "dissolve"].includes(shot.transition_in));
    assert.ok(["cut", "fade", "dissolve"].includes(shot.transition_out));
    if (shot.emphasis_card) {
      emphasisBeats += 1;
      assert.equal(shot.asset_type, "footage");
      assert.ok(shot.emphasis_card.title?.length >= 8);
      assert.ok(shot.emphasis_card.eyebrow?.length >= 5);
      assert.ok(["low_impact", "tonal_bloom"].includes(shot.sound_cue));
    } else {
      assert.equal(shot.sound_cue ?? null, null);
    }
    assert.ok(claimIds.has(shot.claim_id));
    assert.ok(VALID_ROLES.has(shot.visual_role));
    assert.ok(shot.editorial_purpose?.length >= 18);
    if (shot.asset_type === "graphic") {
      pureGraphicFrames += frames;
      assert.ok(shot.graphic?.title);
      assert.ok(!FORBIDDEN.has(shot.graphic?.type));
      previousSignature = `graphic:${shot.graphic.type}:${shot.graphic.title}`;
      continue;
    }
    if (shot.asset_type === "evidence") {
      evidenceFrames += frames;
      const spec = shot.evidence || {};
      assert.ok(VALID_KINDS.has(spec.kind), `${shot.shot_id} invalid evidence kind`);
      assert.ok(spec.title && spec.eyebrow && spec.source_label, `${shot.shot_id} lacks evidence hierarchy`);
      assert.ok((spec.font_px || 0) >= Number(blueprint.global_rules.minimum_overlay_font_px || 28));
      assert.ok((spec.source_ids || []).length);
      for (const sourceId of spec.source_ids || []) assert.ok(sourceIds.has(sourceId));
      const images = spec.image_assets || [];
      const assetIds = spec.evidence_asset_ids || [];
      if (IMAGE_KINDS.has(spec.kind)) {
        assert.ok(images.length);
        assert.equal(images.length, assetIds.length);
      } else {
        assert.equal(images.length, 0);
        assert.equal(assetIds.length, 0);
      }
      for (const image of images) {
        assert.match(image, /^assets\/evidence\//);
        assert.ok(await pathExists(path.join(dir, image)), `missing ${image}`);
        imageUsage.set(image, (imageUsage.get(image) || 0) + 1);
        assert.ok(imageUsage.get(image) <= maxUses, `${image} exceeds use limit`);
      }
      for (const assetId of assetIds) {
        evidenceUsage.set(assetId, (evidenceUsage.get(assetId) || 0) + 1);
        assert.ok(evidenceUsage.get(assetId) <= maxUses);
      }
      const signature = images.length ? `images:${images.join("|")}` : `native:${spec.kind}:${spec.title}`;
      assert.notEqual(signature, previousSignature, `${shot.shot_id} repeats identical evidence`);
      previousSignature = signature;
      continue;
    }
    assert.equal(shot.asset_type, "footage");
    if (isProof) {
      const approvedHook = shot.hook_footage === true;
      const approvedContext = plan.quality_policy?.cinematic_body_footage === true && shot.contextual_footage === true && shot.provenance_mode === "approved_contextual_footage";
      assert.ok(approvedHook || approvedContext);
      if (approvedContext) contextualFootageFrames += frames;
    }
    // A shot that continues the immediately preceding shot's own asset from
    // exactly where its trim left off (an editorial pause hold on the same
    // footage, split into two shots so neither exceeds max_shot_seconds --
    // see scripts/orvyq_full_production_plan.mjs's pause-insertion pass) is
    // one continuous use of that clip, not a second one. This mirrors
    // buildFullPlan's own previousFootage/isContinuationOfPrevious check in
    // scripts/orvyq_edit_plan.mjs exactly, so this test's usage counting
    // agrees with the real max_uses_per_source enforcement the edit plan
    // itself already applied when it was built.
    const isContinuationOfPrevious = previousFootage?.asset === shot.video_asset && Math.abs(previousFootage.trimOut - shot.trim_in_sec) < 0.02;
    if (!isContinuationOfPrevious) {
      footageUsage.set(shot.video_asset, (footageUsage.get(shot.video_asset) || 0) + 1);
      assert.ok(footageUsage.get(shot.video_asset) <= maxUses);
    }
    previousFootage = { asset: shot.video_asset, trimOut: shot.trim_out_sec };
    const file = path.join(dir, shot.video_asset);
    assert.ok(await pathExists(file));
    const sourceDuration = await videoDuration(file);
    assert.ok(shot.trim_out_sec > shot.trim_in_sec);
    assert.ok(Math.abs(shot.trim_out_sec - shot.trim_in_sec - seconds) < 0.02);
    assert.ok(shot.trim_out_sec <= sourceDuration + 0.02);
    previousSignature = `footage:${shot.video_asset}`;
  }

  const graphicFraction = pureGraphicFrames / plan.duration_frames;
  const evidenceFraction = evidenceFrames / plan.duration_frames;
  const contextualFootageFraction = contextualFootageFrames / plan.duration_frames;
  // Proof is now a genuine frame-prefix of the full candidate: both modes
  // share the exact same plan.shots/duration_frames (see
  // scripts/orvyq_edit_plan.mjs), so there is only one real fraction profile
  // to check regardless of plan.mode -- matching the same recalibrated
  // thresholds scripts/orvyq_semantic_visual_audit.mjs applies (measured
  // against the real full_production shot list: ~44.1% evidence, ~17.1%
  // graphics, ~37.5% contextual footage, 8 emphasis beats).
  assert.ok(graphicFraction <= 0.2);
  if (plan.quality_policy?.cinematic_body_footage) {
    assert.ok(evidenceFraction >= 0.4);
    assert.ok(contextualFootageFraction >= 0.25);
    assert.ok(contextualFootageFraction <= 0.45);
    assert.ok(emphasisBeats >= 4);
  }
  assert.ok(shotDurations.size >= 5);
  assert.equal(captions.source, "qa/speech_transcript.json");
  assert.equal(captions.text_source, "voice/voice_script.txt");
  assert.equal(captions.style?.line_count, 1);
  assert.equal(captions.style?.active_word_effect, false);
  assert.equal(captions.style?.background, "none");
  if (plan.quality_policy?.cinematic_body_footage) assert.ok(captions.style?.max_speech_gap_seconds <= 0.8);
  assert.ok(captions.captions.length);
  assert.ok(captions.captions[0].start_frame <= 3);
  assert.match(captions.captions[0].text, /^Every major AI lab\b/i);
  let previousCaptionEnd = -1;
  for (const caption of captions.captions) {
    const words = caption.text.trim().split(/\s+/);
    assert.ok(words.length <= 7);
    assert.ok(caption.text.length <= 52);
    assert.ok(caption.end_frame > caption.start_frame);
    assert.ok(caption.start_frame >= previousCaptionEnd);
    previousCaptionEnd = caption.end_frame;
  }
  if (plan.quality_policy?.cinematic_body_footage) {
    for (const pause of audioMetadata.pause_windows || []) {
      const pauseStartFrame = Math.ceil(Number(pause.start_seconds) * plan.fps);
      const pauseEndFrame = Math.floor(Number(pause.end_seconds) * plan.fps);
      const overlappingCaptions = captions.captions.filter((caption) => caption.start_frame < pauseEndFrame && caption.end_frame > pauseStartFrame);
      assert.deepEqual(overlappingCaptions, [], `${pause.pause_id} must remain caption-free`);
    }
  }

  if (plan.mode === "full") {
    const approvalPath = path.join(dir, "qa", "proof_approval.json");
    const narrationPath = path.join(dir, "voice", "narration_status.json");
    assert.ok(await pathExists(approvalPath), "full render requires qa/proof_approval.json");
    assert.ok(await pathExists(narrationPath));
    const [approval, narration] = await Promise.all([readJson(approvalPath), readJson(narrationPath)]);
    assert.equal(approval.approved, true, "the frozen candidate that produced the proof has not been approved");
    assert.ok(approval.frozen_candidate_hash, "proof approval must reference a frozen candidate hash");
    assert.equal(narration.full_narration_requires_regeneration, false);
    assert.equal(narration.full_narration_approved, true);
  }

  return {
    mode: plan.mode,
    production_mode: plan.production_mode,
    shot_count: shots.length,
    evidence_shot_count: shots.filter((shot) => shot.asset_type === "evidence").length,
    approved_hook_footage_count: shots.filter((shot) => shot.asset_type === "footage" && shot.hook_footage === true).length,
    legacy_footage_count: shots.filter((shot) => shot.asset_type === "footage" && shot.hook_footage !== true && shot.contextual_footage !== true).length,
    contextual_footage_count: shots.filter((shot) => shot.asset_type === "footage" && shot.contextual_footage === true).length,
    emphasis_beat_count: shots.filter((shot) => shot.emphasis_card).length,
    motion_hook: motionHook,
    pure_graphic_count: shots.filter((shot) => shot.asset_type === "graphic").length,
    evidence_fraction: evidenceFraction,
    unique_primary_images: imageUsage.size,
    max_primary_image_uses: Math.max(0, ...imageUsage.values()),
    caption_count: captions.captions.length,
    speech_similarity: speechQa.script_similarity
  };
}

if (import.meta.url === `file://${process.argv[1]}`)
  validateCanonicalEditPlan()
    .then((result) => console.log(JSON.stringify({ ok: true, ...result })))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
