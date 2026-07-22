#!/usr/bin/env node
// buildCanonicalEditPlan() -- the single edit-plan generator for BOTH proof
// and full render modes.
//
// This replaces two golden-repo scripts that were structurally different
// code paths (docs/migration-plan.md section 1): orvyq_preview_plan.mjs
// (dispatched to via an env-var boolean, wrote schema_version
// "7.0-cinematic-proof") and orvyq_edit_plan.mjs's full-production branch
// (wrote schema_version "5.1-evidence-led-full"). Both branches are here,
// in one function, sharing one output schema (edit_plan.schema.json,
// schema_version "1.0-canonical") and one `quality_policy` shape.
//
// What's still mode-specific, honestly: `mode: "proof"` still reads from
// direction/cinematic_proof_cut.json (+ its motion_hook.json /
// proof_preview_cut.json evidence-bridge dependencies) while `mode: "full"`
// reads from direction/editorial_blueprint.json's full_production.shots.
// This is NOT the same defect the golden system had. A 150-second proof and
// a 660+ second full film are genuinely different authored cuts -- the full
// film has ~5x the runtime to fill with claims the proof never touches, and
// its shot list does not exist yet (full_production.status is still
// "blocked_until_research_and_assets_complete" in the recovered project
// data). What WAS wrong, and is fixed here: both cuts now flow through the
// same function, the same per-asset-type validation rules, the same
// schema_version, and the same quality_policy field set -- there is no
// longer a second, independently-diverging code path or a second
// independently-enforced (or silently skipped) rule set for "full".
//
// The legacy non-cinematic 120-second zero-footage proof branch
// (ORVYQ_CINEMATIC_PROOF=0 in the golden system) is intentionally dropped,
// not ported: docs/file-classification.md section 1.7 confirms it was
// superseded before the approved proof shipped, and PR #10's title
// ("Build ORVYQ 150-second cinematic proof") + cinematic_revision_plan.json
// (`approval_status: "user_approved"`) confirm only the cinematic path was
// ever actually used. direction/proof_preview_cut.json is still read here
// as a real data dependency (the cinematic cut's evidence-bridge shots
// reference it by index), just not as a standalone alternate plan format.
import path from "node:path";
import { projectDir, readJson, writeJsonAtomic, pathExists, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { loadResolvedEvidenceMap } from "./lib/orvyq-evidence.mjs";
import { auditMotionHook } from "./lib/orvyq-motion-hook.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const FPS = 30;
const IMAGE_KINDS = new Set(["split_documents", "official_document", "official_figure", "official_screen", "image_sequence", "recap"]);
const NATIVE_KINDS = new Set(["source_timeline", "source_article", "concept_map", "boundary", "comparison", "evidence_chain"]);
const ALLOWED_ROLES = new Set(["evidence", "archive", "context", "metaphor", "graphic"]);
const ALLOWED_TRANSITIONS = new Set(["cut", "fade", "dissolve"]);
const round = (value) => Math.round(value * 1000) / 1000;

function sceneForFrame(scenes, frame) {
  return scenes.find((scene) => frame >= scene.start_frame && frame < scene.end_frame)?.scene_id || scenes.at(-1)?.scene_id || "scene_001";
}

function defaultFocus(evidence) {
  if (evidence.focus) return evidence.focus;
  if (evidence.kind === "official_document") return { scale: 1.12, x: 0, y: -3 };
  return undefined;
}

function fractionSummary(shots, totalFrames) {
  const framesOf = (predicate) => shots.filter(predicate).reduce((sum, shot) => sum + shot.end_frame - shot.start_frame, 0);
  const roleFrames = {};
  for (const shot of shots) roleFrames[shot.visual_role] = (roleFrames[shot.visual_role] || 0) + (shot.end_frame - shot.start_frame);
  return {
    actual_generic_stock_fraction: round(framesOf((shot) => shot.generic_stock === true) / totalFrames),
    actual_motion_hook_fraction: round(framesOf((shot) => shot.hook_footage === true) / totalFrames),
    actual_total_footage_fraction: round(framesOf((shot) => shot.asset_type === "footage") / totalFrames),
    actual_contextual_body_footage_fraction: round(framesOf((shot) => shot.contextual_footage === true) / totalFrames),
    actual_primary_evidence_fraction: round(framesOf((shot) => shot.asset_type === "evidence") / totalFrames),
    actual_full_screen_graphic_fraction: round(framesOf((shot) => shot.asset_type === "graphic") / totalFrames),
    role_fractions: Object.fromEntries(Object.entries(roleFrames).map(([role, frames]) => [role, round(frames / totalFrames)]))
  };
}

// ---- mode: "proof" -- reads direction/cinematic_proof_cut.json ----

async function resolveProofShots(dir) {
  const [proofCut, cinematicCut, motionHook] = await Promise.all([
    readJson(path.join(dir, "direction", "proof_preview_cut.json")),
    readJson(path.join(dir, "direction", "cinematic_proof_cut.json")),
    readJson(path.join(dir, "direction", "motion_hook.json"))
  ]);
  const resolved = (cinematicCut.shots || []).map((entry) => {
    let source = null;
    if (Number.isInteger(entry.source_motion_hook_index)) source = motionHook.shots?.[entry.source_motion_hook_index];
    if (Number.isInteger(entry.source_evidence_index)) source = proofCut.shots?.[entry.source_evidence_index];
    if ((entry.source_motion_hook_index !== undefined || entry.source_evidence_index !== undefined) && !source)
      throw new Error("Cinematic proof references a missing source shot");
    const merged = source
      ? {
          ...source,
          ...entry,
          ...(source.evidence || entry.evidence ? { evidence: { ...(source.evidence || {}), ...(entry.evidence || {}) } } : {}),
          ...(source.graphic || entry.graphic ? { graphic: { ...(source.graphic || {}), ...(entry.graphic || {}) } } : {})
        }
      : { ...entry };
    delete merged.source_motion_hook_index;
    delete merged.source_evidence_index;
    return merged;
  });
  return { cut: cinematicCut, cutShots: resolved, strategy: cinematicCut.strategy };
}

async function buildProofPlan(dir, projectId, blueprint) {
  const [evidenceManifest, runtimeManifest, { cut, cutShots, strategy }] = await Promise.all([
    readJson(path.join(dir, "research", "primary_evidence_manifest.json")),
    readJson(path.join(dir, "assets", "evidence", "primary_evidence.runtime.json")),
    resolveProofShots(dir)
  ]);
  if (!runtimeManifest.pass) throw new Error("Primary evidence runtime manifest did not pass");

  const manifestById = new Map((evidenceManifest.assets || []).map((asset) => [asset.evidence_asset_id, asset]));
  const runtimeById = new Map((runtimeManifest.assets || []).map((asset) => [asset.evidence_asset_id, asset]));
  const sourceLimit = blueprint.global_rules.max_uses_per_source;
  const assetUsage = new Map();
  const evidenceIdUsage = new Map();
  const scenes = cutShots.map((_, index) => ({ scene_id: `scene_${String(index + 1).padStart(3, "0")}`, start_frame: 0, end_frame: Infinity }));
  let cursorSeconds = 0;
  const shots = [];

  for (let index = 0; index < cutShots.length; index += 1) {
    const spec = cutShots[index];
    const startFrame = Math.round(cursorSeconds * FPS);
    cursorSeconds += Number(spec.duration);
    const endFrame = Math.round(cursorSeconds * FPS);
    const common = {
      shot_id: `shot_${String(index + 1).padStart(3, "0")}`,
      scene_id: sceneForFrame(scenes, index),
      start_frame: startFrame,
      end_frame: endFrame,
      claim_id: spec.claim_id,
      visual_role: spec.visual_role,
      generic_stock: Boolean(spec.generic_stock),
      editorial_purpose: spec.editorial_purpose,
      editorial_overlay: null,
      transition_in: spec.transition_in || (index === 0 ? "cut" : "cut"),
      transition_out: spec.transition_out || (index === cutShots.length - 1 ? "fade" : "cut"),
      text_overlay: null,
      sound_cue: spec.sound_cue || null,
      emphasis_card: spec.emphasis_card || null
    };

    if (spec.asset_type === "graphic") {
      shots.push({ ...common, asset_type: "graphic", graphic: spec.graphic, motif: spec.graphic.type });
      continue;
    }

    if (spec.asset_type === "footage") {
      const isHookFootage = spec.hook_footage === true;
      const isContextualFootage = spec.contextual_footage === true;
      if (!isHookFootage && !isContextualFootage)
        throw new Error(`${common.shot_id} footage must be either the approved motion hook or approved contextual body footage`);
      const absoluteVideo = path.join(dir, spec.video_asset || "");
      const provenancePath = path.join(dir, `${spec.video_asset}.provenance.json`);
      if (!(await pathExists(absoluteVideo))) throw new Error(`${common.shot_id} footage is missing: ${spec.video_asset}`);
      if (!(await pathExists(provenancePath))) throw new Error(`${common.shot_id} footage provenance is missing`);
      const provenance = await readJson(provenancePath);
      if (!provenance.approved_for_final_edit || !provenance.license_url) throw new Error(`${common.shot_id} footage is not licensed and approved`);
      const sourceDuration = Number(provenance.actual_duration_seconds || provenance.duration);
      if (!Number.isFinite(sourceDuration) || spec.trim_in_sec < 0 || spec.trim_out_sec <= spec.trim_in_sec || spec.trim_out_sec > sourceDuration + 0.02)
        throw new Error(`${common.shot_id} has an invalid footage trim`);
      if (Math.abs(spec.trim_out_sec - spec.trim_in_sec - Number(spec.duration)) > 0.02)
        throw new Error(`${common.shot_id} footage trim does not match shot duration`);
      shots.push({
        ...common,
        asset_type: "footage",
        video_asset: spec.video_asset,
        trim_in_sec: spec.trim_in_sec,
        trim_out_sec: spec.trim_out_sec,
        motion_variant: spec.motion_variant || "hold",
        hook_footage: isHookFootage,
        contextual_footage: isContextualFootage,
        provenance_mode: isHookFootage ? "approved_motion_hook" : "approved_contextual_footage",
        motif: spec.video_asset
      });
      continue;
    }

    if (spec.asset_type !== "evidence") throw new Error(`${common.shot_id} is not evidence, graphic, or approved footage`);
    const evidence = spec.evidence;
    if (!evidence?.kind || (!IMAGE_KINDS.has(evidence.kind) && !NATIVE_KINDS.has(evidence.kind)))
      throw new Error(`${common.shot_id} has unsupported evidence kind ${evidence?.kind}`);
    if (!(evidence.source_ids || []).length || !evidence.source_label) throw new Error(`${common.shot_id} lacks visible source attribution`);
    if ((evidence.font_px || 0) < blueprint.global_rules.minimum_overlay_font_px) throw new Error(`${common.shot_id} evidence typography is too small`);

    const images = evidence.image_assets || [];
    const ids = evidence.evidence_asset_ids || [];
    if (IMAGE_KINDS.has(evidence.kind)) {
      if (!images.length || images.length !== ids.length) throw new Error(`${common.shot_id} image evidence must pair every image with an evidence_asset_id`);
      for (let assetIndex = 0; assetIndex < ids.length; assetIndex += 1) {
        const id = ids[assetIndex];
        const declared = manifestById.get(id);
        const runtime = runtimeById.get(id);
        const image = images[assetIndex];
        if (!declared || !runtime) throw new Error(`${common.shot_id} references unavailable primary evidence ${id}`);
        if (declared.local_asset !== image || runtime.local_asset !== image) throw new Error(`${common.shot_id} primary evidence path mismatch for ${id}`);
        if (!(await pathExists(path.join(dir, image)))) throw new Error(`${common.shot_id} primary evidence file is missing: ${image}`);
        assetUsage.set(image, (assetUsage.get(image) || 0) + 1);
        evidenceIdUsage.set(id, (evidenceIdUsage.get(id) || 0) + 1);
        if (assetUsage.get(image) > sourceLimit) throw new Error(`${image} exceeds the ${sourceLimit}-use limit`);
      }
    } else if (images.length || ids.length) {
      throw new Error(`${common.shot_id} native source-derived graphic cannot smuggle image assets`);
    }

    const focus = defaultFocus(evidence);
    shots.push({
      ...common,
      asset_type: "evidence",
      evidence: { ...evidence, ...(focus ? { focus } : {}), provenance_mode: IMAGE_KINDS.has(evidence.kind) ? "official_primary_capture" : "source_derived_graphic" },
      motif: evidence.kind
    });
  }

  if (Math.abs(cursorSeconds - cut.duration_seconds) > 0.001)
    throw new Error(`Proof cut must total ${cut.duration_seconds}s, got ${cursorSeconds}s`);

  return {
    shots,
    durationFrames: Math.round(cut.duration_seconds * FPS),
    productionMode: blueprint.production_mode,
    strategy,
    sourceUsage: assetUsage,
    evidenceIdUsage,
    quality_policy_overrides: {
      proof_body_stock_assets_forbidden: false,
      cinematic_body_footage: true,
      contextual_footage_must_not_claim_literal_evidence: true,
      minimum_emphasis_beats: 4,
      maximum_uninterrupted_evidence_seconds: 15,
      motion_hook_min_seconds: 10,
      motion_hook_max_seconds: 14
    }
  };
}

// ---- mode: "full" -- reads direction/editorial_blueprint.json's full_production.shots ----

async function fullEvidenceAssetManifest(dir) {
  const manifest = await readJson(path.join(dir, "research", "evidence_asset_manifest.json"));
  return new Map((manifest.assets || manifest.evidence_assets || []).map((asset) => [asset.evidence_asset_id, asset]));
}

async function buildFullPlan(dir, projectId, blueprint) {
  const evidenceMap = await loadResolvedEvidenceMap(dir);
  const evidenceAssetsById = await fullEvidenceAssetManifest(dir);
  const validSourceIds = new Set(evidenceMap.source_catalog.map((source) => source.source_id));
  const full = blueprint.full_production;
  const unresolved = evidenceMap.claims.filter((claim) => ["rewrite_required", "source_required"].includes(claim.status));
  const unresolvedIds = new Set(unresolved.map((claim) => claim.claim_id));
  const activeDeclaredBlockers = (full.blocking_claim_ids || []).filter((claimId) => unresolvedIds.has(claimId));
  if (full.status !== "ready") throw new Error(`Full ORVYQ edit is blocked: full_production.status=${full.status}`);
  if (activeDeclaredBlockers.length || unresolved.length)
    throw new Error(`Full ORVYQ edit is blocked by unresolved claims: ${[...activeDeclaredBlockers, ...unresolved.map((claim) => claim.claim_id)].join(", ")}`);
  if (!Array.isArray(full.shots) || !full.shots.length)
    throw new Error("Full ORVYQ edit requires an explicit full_production.shots array; automatic footage fallback is forbidden");

  const claimIds = new Set(evidenceMap.claims.filter((claim) => claim.status !== "removed").map((claim) => claim.claim_id));
  const sourceUsage = new Map();
  let cursor = 0;
  const shots = [];

  for (let index = 0; index < full.shots.length; index += 1) {
    const spec = full.shots[index];
    const duration = Number(spec.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > blueprint.global_rules.max_shot_seconds)
      throw new Error(`full_production.shots[${index}] has invalid duration ${spec.duration}`);
    if (!claimIds.has(spec.claim_id)) throw new Error(`full_production.shots[${index}] has unknown or removed claim_id ${spec.claim_id}`);
    if (!ALLOWED_ROLES.has(spec.visual_role)) throw new Error(`full_production.shots[${index}] has invalid visual_role ${spec.visual_role}`);
    if (!spec.editorial_purpose || spec.editorial_purpose.length < 18) throw new Error(`full_production.shots[${index}] needs a specific editorial_purpose`);

    const startFrame = Math.round(cursor * FPS);
    cursor += duration;
    const endFrame = Math.round(cursor * FPS);
    const transitionIn = spec.transition_in || (index === 0 ? "fade" : "cut");
    const transitionOut = spec.transition_out || (index === full.shots.length - 1 ? "fade" : "cut");
    if (!ALLOWED_TRANSITIONS.has(transitionIn) || !ALLOWED_TRANSITIONS.has(transitionOut))
      throw new Error(`full_production.shots[${index}] has an invalid transition`);

    const common = {
      shot_id: `shot_${String(index + 1).padStart(3, "0")}`,
      scene_id: spec.scene_id,
      section_id: spec.section_id,
      start_frame: startFrame,
      end_frame: endFrame,
      claim_id: spec.claim_id,
      visual_role: spec.visual_role,
      generic_stock: spec.generic_stock === true,
      editorial_purpose: spec.editorial_purpose,
      editorial_overlay: spec.overlay || null,
      motif: spec.motif || spec.asset || spec.graphic?.type,
      transition_in: transitionIn,
      transition_out: transitionOut,
      text_overlay: null,
      sound_cue: null
    };

    if (spec.asset_type === "graphic") {
      if (!spec.graphic?.title) throw new Error(`full_production.shots[${index}] graphic requires a title`);
      shots.push({ ...common, asset_type: "graphic", graphic: spec.graphic });
      continue;
    }

    if (spec.asset_type === "evidence") {
      const evidence = spec.evidence;
      if (!evidence?.kind || (!IMAGE_KINDS.has(evidence.kind) && !NATIVE_KINDS.has(evidence.kind)))
        throw new Error(`${common.shot_id} has unsupported evidence kind ${evidence?.kind}`);
      const sourceIds = evidence.source_ids || [];
      if (!sourceIds.length || !evidence.source_label) throw new Error(`${common.shot_id} lacks visible source attribution`);
      for (const sourceId of sourceIds) {
        if (!validSourceIds.has(sourceId)) throw new Error(`${common.shot_id} references unknown source ${sourceId}`);
      }
      if ((evidence.font_px || 0) < blueprint.global_rules.minimum_overlay_font_px) throw new Error(`${common.shot_id} evidence typography is too small`);

      if (IMAGE_KINDS.has(evidence.kind)) {
        const images = evidence.image_assets || [];
        const ids = evidence.evidence_asset_ids || [];
        if (!images.length || images.length !== ids.length) throw new Error(`${common.shot_id} image evidence must pair every image with an evidence_asset_id`);
        for (let assetIndex = 0; assetIndex < ids.length; assetIndex += 1) {
          const id = ids[assetIndex];
          const declared = evidenceAssetsById.get(id);
          if (!declared) throw new Error(`${common.shot_id} references unknown full-production evidence asset ${id}`);
          if (declared.status !== "ready") throw new Error(`${common.shot_id} evidence asset ${id} is not ready (status=${declared.status}); automatic asset fallback is forbidden`);
          const image = images[assetIndex];
          if (!(await pathExists(path.join(dir, image)))) throw new Error(`${common.shot_id} evidence asset file is missing: ${image}`);
          sourceUsage.set(image, (sourceUsage.get(image) || 0) + 1);
          if (sourceUsage.get(image) > blueprint.global_rules.max_uses_per_source) throw new Error(`${image} exceeds the ${blueprint.global_rules.max_uses_per_source}-use limit`);
        }
      } else if (evidence.image_assets?.length || evidence.evidence_asset_ids?.length) {
        throw new Error(`${common.shot_id} native source-derived graphic cannot smuggle image assets`);
      }

      const focus = defaultFocus(evidence);
      shots.push({
        ...common,
        asset_type: "evidence",
        evidence: { ...evidence, ...(focus ? { focus } : {}), provenance_mode: IMAGE_KINDS.has(evidence.kind) ? "official_primary_capture" : "source_derived_graphic" },
        motif: spec.motif || evidence.kind
      });
      continue;
    }

    if (spec.asset_type !== "footage" || !spec.asset) throw new Error(`full_production.shots[${index}] must explicitly declare a footage asset, evidence, or graphic`);
    // Footage in full mode carries the exact same licensing/provenance
    // obligation as proof mode's footage branch (buildProofPlan above) --
    // the opening motion hook is real, licensed footage shared by both
    // cuts, not a full-mode-only exemption. This mirrors that branch's
    // checks (approved_for_final_edit, license_url, trim-vs-source-duration
    // bounds) instead of skipping them, and propagates hook_footage /
    // contextual_footage so auditMotionHook (which runs unconditionally for
    // both modes) can see them.
    const isHookFootage = spec.hook_footage === true;
    const isContextualFootage = spec.contextual_footage === true;
    if (!isHookFootage && !isContextualFootage)
      throw new Error(`${common.shot_id} footage must be either the approved motion hook or approved contextual body footage`);
    const absoluteVideo = path.join(dir, spec.asset);
    const provenancePath = path.join(dir, `${spec.asset}.provenance.json`);
    if (!(await pathExists(absoluteVideo))) throw new Error(`Missing full-edit asset: ${spec.asset}`);
    if (!(await pathExists(provenancePath))) throw new Error(`${common.shot_id} footage provenance is missing`);
    const provenance = await readJson(provenancePath);
    if (!provenance.approved_for_final_edit || !provenance.license_url) throw new Error(`${common.shot_id} footage is not licensed and approved`);
    const sourceDuration = Number(provenance.actual_duration_seconds || provenance.duration);
    const trimIn = Number(spec.trim_in_sec || 0);
    const trimOut = Number(spec.trim_out_sec || trimIn + duration);
    if (!Number.isFinite(sourceDuration) || trimIn < 0 || trimOut <= trimIn || trimOut > sourceDuration + 0.02)
      throw new Error(`${common.shot_id} has an invalid footage trim`);
    if (Math.abs(trimOut - trimIn - duration) > 0.02) throw new Error(`full_production.shots[${index}] trim does not match timeline duration`);
    sourceUsage.set(spec.asset, (sourceUsage.get(spec.asset) || 0) + 1);
    if (sourceUsage.get(spec.asset) > blueprint.global_rules.max_uses_per_source) throw new Error(`${spec.asset} exceeds the ${blueprint.global_rules.max_uses_per_source}-use limit`);
    shots.push({
      ...common,
      asset_type: "footage",
      video_asset: spec.asset,
      trim_in_sec: round(trimIn),
      trim_out_sec: round(trimOut),
      motion_variant: spec.motion || "hold",
      hook_footage: isHookFootage,
      contextual_footage: isContextualFootage,
      provenance_mode: isHookFootage ? "approved_motion_hook" : "approved_contextual_footage"
    });
  }

  return {
    shots,
    durationFrames: Math.round(cursor * FPS),
    productionMode: blueprint.production_mode,
    strategy: "evidence first, context second, metaphor only after the claim is established",
    sourceUsage,
    evidenceIdUsage: new Map(),
    quality_policy_overrides: { resolved_evidence_schema: evidenceMap.schema_version }
  };
}

// ---- shared assembly ----

export async function buildCanonicalEditPlan(projectId = PROJECT_ID, { mode = "proof", frameEnd = null } = {}) {
  if (mode !== "proof" && mode !== "full") throw new Error(`mode must be "proof" or "full", got "${mode}"`);
  const dir = projectDir(projectId);
  const blueprint = await readJson(path.join(dir, "direction", "editorial_blueprint.json"));

  const built = mode === "proof" ? await buildProofPlan(dir, projectId, blueprint) : await buildFullPlan(dir, projectId, blueprint);
  const { shots, durationFrames, productionMode, strategy, sourceUsage, evidenceIdUsage, quality_policy_overrides } = built;

  const hookAudit = auditMotionHook({
    fps: FPS,
    shots,
    quality_policy: { motion_hook_min_seconds: quality_policy_overrides.motion_hook_min_seconds || 10, motion_hook_max_seconds: quality_policy_overrides.motion_hook_max_seconds || 14, cinematic_body_footage: mode === "proof" }
  });
  if (!hookAudit.pass) throw new Error(`Motion hook failed: ${hookAudit.failures.join("; ")}`);

  const selectedEnd = Number.isFinite(frameEnd) && frameEnd > 0 ? Math.min(frameEnd, durationFrames) : durationFrames;

  const plan = {
    schema_version: "1.0-canonical",
    project_id: projectId,
    mode,
    frame_range: { start_frame: 0, end_frame: selectedEnd },
    fps: FPS,
    duration_frames: durationFrames,
    audio_mix_asset: "assets/audio/final_mix.mp3",
    captions_asset: "remotion/captions.json",
    production_mode: productionMode,
    strategy,
    render_source_sha: process.env.GITHUB_SHA || null,
    art_direction: {
      principle: mode === "proof"
        ? "short licensed motion hook first; then alternate source-backed evidence with semantically relevant licensed context footage and deliberate emphasis beats"
        : "evidence first, context second, metaphor only after the claim is established",
      topic: "AI competition, safety frameworks, governance, and controlled agentic-misalignment evaluations",
      palette: { ink: "#F5F0E7", accent: "#D95B53", information: "#86A9CC", ground: "#07101A" },
      source_treatment: "full-screen official captures and explicit source-derived graphics"
    },
    quality_policy: {
      ...blueprint.global_rules,
      keyword_only_visual_matching_forbidden: true,
      fake_data_graphics_forbidden: true,
      automatic_asset_fallback_forbidden: true,
      unrelated_stock_fallback_forbidden: true,
      non_overlapping_dissolves_forbidden: true,
      document_focus_required: true,
      metadata_cannot_define_evidence: true,
      motion_hook_required: true,
      ...quality_policy_overrides,
      ...fractionSummary(shots, durationFrames)
    },
    motion_hook: hookAudit,
    blacklisted_assets: [],
    source_usage: Object.fromEntries([...sourceUsage.entries()].sort((a, b) => b[1] - a[1])),
    evidence_asset_usage: Object.fromEntries([...evidenceIdUsage.entries()].sort((a, b) => b[1] - a[1])),
    shots
  };

  await writeJsonAtomic(path.join(dir, "direction", "edit_plan.json"), plan);
  return plan;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode || "proof";
  const frameEnd = args["frame-end"] ? Number.parseInt(args["frame-end"], 10) : null;
  buildCanonicalEditPlan(args["project-id"] || PROJECT_ID, { mode, frameEnd })
    .then((plan) =>
      printJson({
        ok: true,
        mode: plan.mode,
        shot_count: plan.shots.length,
        footage_count: plan.shots.filter((shot) => shot.asset_type === "footage").length,
        evidence_count: plan.shots.filter((shot) => shot.asset_type === "evidence").length,
        frame_range: plan.frame_range,
        duration_frames: plan.duration_frames,
        source_usage: plan.source_usage,
        primary_evidence_fraction: plan.quality_policy.actual_primary_evidence_fraction,
        output: "direction/edit_plan.json"
      })
    )
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
