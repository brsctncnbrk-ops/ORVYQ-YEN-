// Phase 2 canonical-schema validation.
//
// Two kinds of checks:
//  (1) REAL DATA -- validates project files actually recovered into this repo
//      (projects/<id>/direction/*.json, projects/<id>/config/*.json) against
//      the schema that already matches their real shape.
//  (2) FIXTURE -- the edit_plan/shot/timeline/captions/audio_mix/asset_registry/
//      evidence_registry/frozen_candidate/proof_approval schemas describe
//      canonical OUTPUTS that the Phase 3 pipeline will produce; no real
//      instance of them exists in this repo yet. Each fixture here is a
//      small hand-built representative example (fixture edit_plan/shot data
//      is drawn from the real golden 109-shot edit_plan.json content, not
//      invented) used to prove the schema is usable, not to claim the real
//      pipeline output has been validated. Phase 3/5 must re-run this
//      validator against the real generated files once they exist.
//
// Exits non-zero if any check fails, per the project's QA rule that a
// validation script must never silently pass a blocking condition.

import path from "node:path";
import { loadCanonicalAjv, readJson } from "./lib/schema-validate.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const PROJECT_DIR = path.resolve("projects", PROJECT_ID);

const ajv = loadCanonicalAjv();
const results = [];

function check(label, schemaFile, data, { kind }) {
  const validate = ajv.getSchema(schemaFile);
  if (!validate) throw new Error(`Unknown schema: ${schemaFile}`);
  const ok = validate(data);
  results.push({ label, schemaFile, kind, ok, errors: ok ? [] : validate.errors });
}

// ---- (1) REAL DATA ----

check(
  "direction/editorial_pause_map.json",
  "editorial_pauses.schema.json",
  readJson(path.join(PROJECT_DIR, "direction/editorial_pause_map.json")),
  { kind: "real" }
);

check(
  "direction/music_cue_sheet.json",
  "music_cues.schema.json",
  readJson(path.join(PROJECT_DIR, "direction/music_cue_sheet.json")),
  { kind: "real" }
);

{
  const videoConfig = readJson(path.join(PROJECT_DIR, "config/video_config.json"));
  const projectConfig = readJson(path.join(PROJECT_DIR, "config/project_config.json"));
  const canonicalProject = {
    schema_version: "1.0-canonical",
    project_id: projectConfig.project_id,
    title: projectConfig.project_name,
    fps: videoConfig.fps,
    width: videoConfig.width,
    height: videoConfig.height,
    // Provisional: config/video_config.json only carries a target_duration_sec
    // (660s), not a frame-accurate canonical duration -- the real
    // duration_frames is only known once Phase 3's buildCanonicalEditPlan()
    // resolves the actual full timeline. Recorded here as a placeholder
    // computed value, not asserted as final.
    duration_frames: videoConfig.target_duration_sec * videoConfig.fps,
    brand: { name: "ORVYQ", tagline: "Beyond the Known", palette: { ink: "#F3ECDD", signal: "#D84B4B", ground: "#05070C" } },
    created_at: projectConfig.created_at
  };
  check(
    "config/{video_config,project_config}.json (assembled)",
    "canonical_project.schema.json",
    canonicalProject,
    { kind: "real (assembled from multiple recovered files)" }
  );
}

// ---- (2) FIXTURES (schema shape proof only, not real pipeline output) ----

const fixtureFootageShot = {
  shot_id: "shot_008", scene_id: "scene_002", start_frame: 1376, end_frame: 1546,
  transition_in: "cut", transition_out: "cut", text_overlay: null, asset_type: "footage",
  video_asset: "assets/footage/scene_003_d69cde76dfac1e29bd6f9946.mp4",
  trim_in_sec: 9.949, trim_out_sec: 15.616
};
check("fixture footage shot (real golden shot content)", "shot.schema.json", fixtureFootageShot, { kind: "fixture" });

const fixtureGraphicShot = {
  shot_id: "shot_001", scene_id: "scene_001", start_frame: 0, end_frame: 216,
  transition_in: "fade", transition_out: "cut", text_overlay: null, asset_type: "graphic",
  graphic: { type: "brand_open", kicker: "ORVYQ PRESENTS", title: "THE AI RACE", subtitle: "What happens when capability moves faster than control?" },
  sound_cue: "pulse"
};
check("fixture graphic shot (real golden shot content)", "shot.schema.json", fixtureGraphicShot, { kind: "fixture" });

const fixtureEditPlan = {
  schema_version: "1.0-canonical",
  project_id: PROJECT_ID,
  mode: "proof",
  frame_range: { start_frame: 0, end_frame: 4500 },
  fps: 30,
  duration_frames: 21598,
  audio_mix_asset: "assets/audio/final_mix.mp3",
  brand: { name: "ORVYQ", tagline: "Beyond the Known", palette: { ink: "#F3ECDD", signal: "#D84B4B", ground: "#05070C" } },
  blacklisted_assets: [],
  shots: [fixtureGraphicShot, fixtureFootageShot],
  quality_policy: {}
};
check("fixture edit_plan (proof mode)", "edit_plan.schema.json", fixtureEditPlan, { kind: "fixture" });

const fixtureTimeline = { fps: 30, duration_frames: 21598, blacklisted_assets: [], shots: [fixtureGraphicShot, fixtureFootageShot] };
check("fixture timeline", "timeline.schema.json", fixtureTimeline, { kind: "fixture" });

const fixtureCaptions = {
  schema_version: "1.0-canonical",
  style: { placement: "bottom_safe", line_count: 1, max_words: 7, max_chars: 52, font_size_px: 36, background: "none" },
  alignment: { recognized_words: 812, aligned_script_words: 780, mapped_words: 780, score: 0.94 },
  captions: [{ caption_id: "cap_001", scene_id: "scene_001", start_frame: 0, end_frame: 90, text: "Every major AI lab on Earth believes" }]
};
check("fixture captions", "captions.schema.json", fixtureCaptions, { kind: "fixture" });

const fixtureAudioMix = {
  schema_version: "1.0-canonical",
  mode: "proof",
  duration_seconds: 150,
  narration_duration_seconds: 114.2,
  pause_windows: [{ pause_id: "PAUSE_01_COMPETITION", start_seconds: 23.74, end_seconds: 28.74 }],
  music_sections: [{ id: "controlled_tension", start_seconds: 0, end_seconds: 35 }],
  sfx_placements: [{ sfx_id: "low_impact", at_seconds: 11 }],
  narration_ducking: { enabled: true },
  licensing: "CC BY 4.0 -- Scott Buckley, 'Signal to Noise'",
  measured: { integrated_lufs: -16.1, true_peak_dbtp: -1.6, loudness_range: 6.2 }
};
check("fixture audio_mix metadata", "audio_mix.schema.json", fixtureAudioMix, { kind: "fixture" });

const fixtureAssetRegistry = {
  schema_version: "1.0-canonical",
  project_id: PROJECT_ID,
  assets: [{
    asset_id: "scene_003_d69cde76dfac1e29bd6f9946",
    type: "footage",
    path: "assets/footage/scene_003_d69cde76dfac1e29bd6f9946.mp4",
    source: "pexels",
    source_url: "https://www.pexels.com/video/women-talking-in-the-office-8170427/",
    license: "https://www.pexels.com/license/",
    attribution: "",
    duration_seconds: 8.44,
    width: 3840,
    height: 2160,
    sha256: "cedebce1559975377d66b75dfbb1fd84f7df3368f99fec547a525773f3dfb8cb",
    semantic_keywords: ["office", "conversation", "corporate"],
    editorial_roles: ["context"],
    allowed_reuse_count: 2
  }]
};
check("fixture asset_registry (real golden provenance content)", "asset_registry.schema.json", fixtureAssetRegistry, { kind: "fixture" });

const fixtureEvidenceRegistry = {
  schema_version: "1.0-canonical",
  project_id: PROJECT_ID,
  sources: [{
    source_id: "SRC_ANTHROPIC_RSP_2024", publisher: "Anthropic", title: "Anthropic Responsible Scaling Policy",
    publication_date: "2024-10-15", url: "https://www-cdn.anthropic.com/616dee633636e5bd309cb73aed8622e80fe47839.pdf",
    source_type: "primary_research", official: true
  }],
  claims: [{
    claim_id: "CLM_001_LABS_PUBLISH_SAFETY_FRAMEWORKS", section_id: "SEC_01_RACE_PARADOX", importance: 5,
    narration_excerpt: "Every major AI lab on Earth believes moving this fast might be dangerous.",
    status: "verified", source_ids: ["SRC_ANTHROPIC_RSP_2024"]
  }],
  evidence_assets: [{
    evidence_asset_id: "EVID_RSP_COVER_CAPTURE", claim_ids: ["CLM_001_LABS_PUBLISH_SAFETY_FRAMEWORKS"],
    source_ids: ["SRC_ANTHROPIC_RSP_2024"], mode: "official_primary_capture", status: "ready",
    required_for_proof: true, required_for_full: true
  }]
};
check("fixture evidence_registry (real golden claim/source content)", "evidence_registry.schema.json", fixtureEvidenceRegistry, { kind: "fixture" });

const fixtureFrozenCandidate = {
  project_id: PROJECT_ID,
  source_commit_sha: "9affbd2494d8197a564c4a552b879fadb0e14a4a",
  renderer_version: "templates/remotion@1.0.0",
  timeline_hash: "0".repeat(64),
  edit_plan_hash: "0".repeat(64),
  caption_hash: "0".repeat(64),
  audio_mix_hash: "0".repeat(64),
  asset_registry_hash: "0".repeat(64),
  selected_render_range: { start_frame: 0, end_frame: 4500 },
  mode: "proof",
  created_at: "2026-07-22T00:00:00Z"
};
check("fixture frozen_candidate", "frozen_candidate.schema.json", fixtureFrozenCandidate, { kind: "fixture" });

const fixtureProofApproval = {
  frozen_candidate_hash: "1".repeat(64),
  approved: false,
  approved_by: "",
  approved_at: "2026-07-22T00:00:00Z",
  notes: "Not yet approved -- fixture only, exercises the schema.",
  proof_artifact: { workflow_run_id: "29655003486", artifact_name: "orvyq-cinematic-proof-150s-29655003486", duration_seconds: 150, resolution: "1920x1080", fps: 30 }
};
check("fixture proof_approval", "proof_approval.schema.json", fixtureProofApproval, { kind: "fixture" });

// ---- Report ----

let failed = 0;
for (const r of results) {
  const status = r.ok ? "PASS" : "FAIL";
  if (!r.ok) failed++;
  console.log(`[${status}] (${r.kind}) ${r.label} -- ${r.schemaFile}`);
  if (!r.ok) console.log(JSON.stringify(r.errors, null, 2));
}

console.log(`\n${results.length - failed}/${results.length} checks passed.`);

if (failed > 0) {
  process.exitCode = 1;
}
