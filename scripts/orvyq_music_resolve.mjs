#!/usr/bin/env node
// resolveProjectMusic() -- the one call both orvyq-proof.yml and
// orvyq-full-render.yml make to obtain this project's licensed music,
// before any narration/edit-plan/render work runs. There is no fallback to
// a network fetch here: an unresolved track_id, missing asset, hash
// mismatch, or a track not approved for the requested mode all throw before
// any of these files are written.
//
// Full mode: direction/music_cue_sheet.json's full_cues each declare a real
// energy/instrumentation state and a track_id, but every cue's track_id now
// resolves to the SAME composition family (task follow-up section 12/16:
// only sb_signal_to_noise / sb_signal_to_noise_nomelody -- see
// composition_family in music_library/registry.json), so the candidate
// reads as one continuous musical world, not nine unrelated compositions.
// Each cue's track is resolved and verified independently against
// music_library/registry.json (hash, license, approved_for_full), extended
// to the exact length it needs (looping through a seamlessly crossfaded
// loop unit if its own source is shorter -- see buildSeamlessLoopUnit), and
// joined to its neighbors with a real overlapping ffmpeg `acrossfade`, with
// the duration each crossfade removes compensated for so the assembled bed
// lands on the exact candidate duration (see buildFullMusicBed) -- into one
// physical assets/music/approved_bed.mp3, the same asset
// scripts/orvyq_audio_mix.mjs has always read, so that script needed no
// structural changes to consume it.
//
// Proof mode still resolves a single track_id from proof_score, kept for
// schema/back-compat -- but as of the proof-is-a-frame-prefix restructuring
// in scripts/orvyq_edit_plan.mjs, no workflow invokes this path anymore:
// proof shares the full candidate's music like everything else it renders.
import path from "node:path";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import { createHash } from "node:crypto";
import { projectDir, readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { resolveCanonicalTrack, resolveCanonicalTrackToPath, loadMusicRegistry } from "./lib/orvyq-music-registry.mjs";
import { command, durationSecondsOf } from "./lib/orvyq-loudness.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";

// Real overlapping crossfade duration (ffmpeg `acrossfade`), used both (a)
// between adjacent cue segments in the final concatenated bed, and (b) at
// the internal loop seam built by buildSeamlessLoopUnit() when a single
// cue's source track is shorter than the cue needs. Task follow-up section
// 16 explicitly rejected the previous approach (afade-out to silence, hard
// concat, afade-in) -- that left a real, measurable silence gap at every
// boundary and a raw hard cut at every internal loop point. Both are now
// genuine overlapping crossfades with duration compensation (see
// buildCueSegment / buildFullMusicBed below), verified via real ffprobe/
// silencedetect in scripts/orvyq_music_resolve.test.mjs and in CI.
const CROSSFADE_SECONDS = 2.5;

// Groups distinct main/variant/stem files that are the SAME underlying
// composition (task follow-up section 12/16) -- see
// music_library/registry.json's own composition_family field.
export function distinctCompositionFamilies(cueRecords) {
  return [...new Set(cueRecords.map((record) => record.composition_family))];
}

// Fails loud, rather than silently shipping a multi-composition bed, if the
// candidate's music does not read as ONE continuous musical world. Exported
// as its own pure function (no ffmpeg / filesystem access) so it is unit-
// testable independently of buildFullMusicBed's real audio assembly.
export function assertSingleCompositionFamily(families) {
  if (families.length > 1) {
    throw new Error(
      `Full music bed uses ${families.length} distinct composition families (${families.join(", ")}) -- ` +
        "the candidate's music must be built from a single composition family's main/variant stems (task follow-up section 12/16), not multiple unrelated compositions."
    );
  }
  if (families.length === 1 && !families[0]) {
    throw new Error(
      "Full music bed cues resolved to a null/empty composition_family -- every track in music_library/registry.json must declare composition_family (task follow-up section 12)."
    );
  }
}

export function extractRequiredTrackId(cueSheet, mode) {
  if (mode !== "proof")
    throw new Error(`extractRequiredTrackId only resolves mode "proof" (full mode resolves one distinct track_id per cue -- see extractFullCueTrackIds); got "${mode}"`);
  const trackId = cueSheet.proof_score?.track_id;
  if (!trackId) throw new Error("direction/music_cue_sheet.json's proof_score does not declare a track_id");
  return trackId;
}

// Full mode assembles the music bed from real, distinct per-cue tracks, one
// per full_cues entry (see docs/full-production-guide.md) -- cues do not
// have to, and typically won't, all reference the same track_id.
export function extractFullCueTrackIds(cueSheet) {
  const cues = cueSheet.full_cues || [];
  if (!cues.length) throw new Error("direction/music_cue_sheet.json has no full_cues");
  const failures = [];
  for (const cue of cues) {
    if (!cue.track_id) failures.push(`full_cues entry ${cue.cue_id || "?"} does not declare a track_id`);
    if (!(Number(cue.end) > Number(cue.start))) failures.push(`full_cues entry ${cue.cue_id || "?"} has an invalid start/end (${cue.start}..${cue.end})`);
  }
  if (failures.length) throw new Error(failures.join("; "));
  return cues.map((cue) => ({ cue_id: cue.cue_id, section_id: cue.section_id, track_id: cue.track_id, start: Number(cue.start), end: Number(cue.end) }));
}

async function sha256File(absPath) {
  return createHash("sha256").update(await readFile(absPath)).digest("hex");
}

function quotedConcatList(paths) {
  return paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
}

// Builds a seamlessly loopable version of a source track: its own tail
// CROSSFADE_SECONDS blended (via a real ffmpeg `acrossfade`) into its own
// head, replacing what would otherwise be a raw hard cut back to time zero
// every time the track must repeat to cover a cue longer than its own
// duration (task follow-up section 16: "Ham tekrar noktalarında sert
// kesinti kullanma" -- do not use hard cuts at raw repeat points).
//
// Construction: bridge = acrossfade(tail_C, head_C) (length C, blends the
// track's ending into its own beginning); middle = source with its first
// and last C seconds removed. loopUnit = bridge + middle (hard concat is
// safe here -- the seam was deliberately crafted to already BE the smooth
// transition). Hard-concatenating loopUnit with itself any number of times
// (exactly what `-stream_loop -1` on the result does) is therefore
// seamless: the loop always exits the crossfaded bridge into the middle at
// the same point it would have anyway, and always re-enters the bridge at
// the point the middle would have ended at.
async function buildSeamlessLoopUnit({ sourcePath, sourceDuration, crossfadeSeconds, tempDir, cacheKey }) {
  if (!(sourceDuration > 2 * crossfadeSeconds))
    throw new Error(`Source track "${sourcePath}" (${sourceDuration}s) is too short to build a seamless ${crossfadeSeconds}s-crossfaded loop (needs to be longer than ${2 * crossfadeSeconds}s)`);
  const tailPath = path.join(tempDir, `${cacheKey}_tail.wav`);
  const headPath = path.join(tempDir, `${cacheKey}_head.wav`);
  const bridgePath = path.join(tempDir, `${cacheKey}_bridge.wav`);
  const middlePath = path.join(tempDir, `${cacheKey}_middle.wav`);
  const loopUnitPath = path.join(tempDir, `${cacheKey}_loopunit.wav`);
  await command("ffmpeg", ["-hide_banner", "-nostats", "-y", "-ss", String(sourceDuration - crossfadeSeconds), "-t", String(crossfadeSeconds), "-i", sourcePath, "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", tailPath]);
  await command("ffmpeg", ["-hide_banner", "-nostats", "-y", "-ss", "0", "-t", String(crossfadeSeconds), "-i", sourcePath, "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", headPath]);
  await command("ffmpeg", [
    "-hide_banner", "-nostats", "-y", "-i", tailPath, "-i", headPath,
    "-filter_complex", `[0:a][1:a]acrossfade=d=${crossfadeSeconds}:c1=tri:c2=tri[a]`,
    "-map", "[a]", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", bridgePath
  ]);
  await command("ffmpeg", ["-hide_banner", "-nostats", "-y", "-ss", String(crossfadeSeconds), "-t", String(sourceDuration - 2 * crossfadeSeconds), "-i", sourcePath, "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", middlePath]);
  const listFile = path.join(tempDir, `${cacheKey}_loopunit_concat.txt`);
  await writeFile(listFile, quotedConcatList([bridgePath, middlePath]));
  await command("ffmpeg", ["-hide_banner", "-nostats", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", loopUnitPath]);
  return loopUnitPath;
}

// Builds one cue's individually-loudness-normalized segment, `requiredDuration`
// seconds long. `requiredDuration` is the cue's own duration PLUS
// CROSSFADE_SECONDS of extra tail for every cue except the last (see
// buildFullMusicBed) -- the extra content is real continuing audio (more of
// the same seamless source/loop), not silence or a repeat, so the
// subsequent acrossfade against the next cue has real material to blend
// against instead of manufacturing an overlap out of nothing.
//
// If the resolved track is shorter than requiredDuration, it is looped via
// the seamless crossfaded loop unit above rather than a raw `-stream_loop`
// of the original file (which is a real hard cut at every repeat).
async function buildCueSegment({ sourcePath, requiredDuration, outputPath, tempDir, loopUnitCache }) {
  const sourceDuration = await durationSecondsOf(sourcePath);
  const needsLoop = sourceDuration + 0.01 < requiredDuration;
  let readPath = sourcePath;
  if (needsLoop) {
    if (!loopUnitCache.has(sourcePath)) {
      const cacheKey = `loop${loopUnitCache.size}`;
      loopUnitCache.set(sourcePath, await buildSeamlessLoopUnit({ sourcePath, sourceDuration, crossfadeSeconds: CROSSFADE_SECONDS, tempDir, cacheKey }));
    }
    readPath = loopUnitCache.get(sourcePath);
  }
  const inputArgs = needsLoop ? ["-stream_loop", "-1", "-i", readPath] : ["-i", readPath];
  const filters = ["atrim=duration=" + requiredDuration, "asetpts=PTS-STARTPTS", "loudnorm=I=-23:TP=-3:LRA=11", "aformat=sample_rates=48000:channel_layouts=stereo"];
  await command("ffmpeg", ["-hide_banner", "-nostats", "-y", ...inputArgs, "-filter:a", filters.join(","), "-t", String(requiredDuration), "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", outputPath]);
  return { looped: needsLoop, sourceDuration };
}

// Chains real ffmpeg `acrossfade` filters across every cue segment (task
// follow-up section 16: "Overlapping crossfade kullan"), instead of the
// previous `-f concat` hard splice. Each acrossfade shortens the combined
// output by CROSSFADE_SECONDS relative to len(left)+len(right) -- which is
// exactly why every segment except the last was built requiredDuration =
// duration + CROSSFADE_SECONDS long above ("Crossfade'in toplam süreyi
// kısaltmasını telafi et" / "Gerekirse her segmenti crossfade süresi kadar
// fazla üret"): folding the chain, each intermediate accumulates exactly
// +CROSSFADE_SECONDS of "banked" extension, and the final fold (against the
// unextended last segment) cancels it out, leaving the total equal to the
// plain sum of the cues' own nominal durations -- see
// docs/canonical-candidate-audit.md and orvyq_music_resolve.test.mjs for the
// worked proof/regression coverage of this arithmetic.
async function chainAcrossfade({ segmentPaths, crossfadeSeconds, outputPath }) {
  if (segmentPaths.length === 1) {
    await command("ffmpeg", ["-hide_banner", "-nostats", "-y", "-i", segmentPaths[0], "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", outputPath]);
    return;
  }
  const inputArgs = segmentPaths.flatMap((segmentPath) => ["-i", segmentPath]);
  const filterParts = [];
  let previousLabel = "0:a";
  for (let index = 1; index < segmentPaths.length; index += 1) {
    const outLabel = index === segmentPaths.length - 1 ? "out" : `cf${index}`;
    filterParts.push(`[${previousLabel}][${index}:a]acrossfade=d=${crossfadeSeconds}:c1=tri:c2=tri[${outLabel}]`);
    previousLabel = outLabel;
  }
  await command("ffmpeg", ["-hide_banner", "-nostats", "-y", ...inputArgs, "-filter_complex", filterParts.join(";"), "-map", "[out]", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", outputPath]);
}

const DURATION_TOLERANCE_SECONDS = 3 / 30 + 0.001; // "≤3 frames / ~0.1s" per task follow-up section 16

async function buildFullMusicBed({ dir, cues, registry, destination, targetDurationSeconds = null }) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "orvyq-music-bed-"));
  try {
    // Task follow-up section 16: "Signal to Noise kaynaklarını full
    // candidate süresine uzat" -- extend to the REAL candidate duration
    // (scripts/lib/orvyq-timeline.mjs's resolveCandidateTimeline()), not a
    // second, independently-authored total. Any small drift between the cue
    // sheet's own authored total and the real candidate duration is
    // absorbed by extending/shrinking only the FINAL cue -- every earlier
    // cue keeps the exact narration-synchronized start/end it was authored
    // against.
    let effectiveCues = cues;
    if (Number.isFinite(targetDurationSeconds) && targetDurationSeconds > 0) {
      const authoredTotal = cues.at(-1).end;
      const delta = targetDurationSeconds - authoredTotal;
      if (Math.abs(delta) > 0.001) effectiveCues = cues.map((cue, index) => (index === cues.length - 1 ? { ...cue, end: cue.end + delta } : cue));
    }
    const targetTotal = effectiveCues.at(-1).end - effectiveCues[0].start;

    const loopUnitCache = new Map();
    const segmentPaths = [];
    const cueRecords = [];
    for (let index = 0; index < effectiveCues.length; index += 1) {
      const cue = effectiveCues[index];
      const duration = cue.end - cue.start;
      if (!(duration > 0)) throw new Error(`Full music bed cue ${cue.cue_id} has a non-positive resolved duration (${duration}s)`);
      const isLast = index === effectiveCues.length - 1;
      const extraTailSeconds = isLast ? 0 : CROSSFADE_SECONDS;
      const requiredDuration = duration + extraTailSeconds;
      const { track, assetAbsPath } = await resolveCanonicalTrack(cue.track_id, { mode: "full", registry });
      const segmentPath = path.join(temp, `segment_${String(index + 1).padStart(2, "0")}.wav`);
      const { looped, sourceDuration } = await buildCueSegment({ sourcePath: assetAbsPath, requiredDuration, outputPath: segmentPath, tempDir: temp, loopUnitCache });
      segmentPaths.push(segmentPath);
      cueRecords.push({
        cue_id: cue.cue_id,
        section_id: cue.section_id,
        track_id: track.track_id,
        title: track.title,
        artist: track.artist,
        composition_family: track.composition_family || null,
        source_page_url: track.source_page_url,
        license_name: track.license_name,
        license_url: track.license_url,
        attribution: track.attribution,
        source_sha256: track.sha256,
        start_seconds: cue.start,
        end_seconds: cue.end,
        duration_seconds: duration,
        source_track_duration_seconds: sourceDuration,
        looped
      });
    }

    // Task follow-up section 12/16: the music bed must read as ONE
    // continuous musical world, not nine unrelated compositions. Being by
    // the same composer was not a strong enough guarantee (Catalyst,
    // Emergent, Undertow, Ephemera, Horizons, and Solace are all
    // Scott Buckley but are each their OWN distinct composition) -- this
    // checks the real composition_family tag (music_library/registry.json)
    // instead, and fails the build if more than one family is used.
    const distinctFamilies = distinctCompositionFamilies(cueRecords);
    assertSingleCompositionFamily(distinctFamilies);

    const crossfadedPath = path.join(temp, "bed_crossfaded.wav");
    await chainAcrossfade({ segmentPaths, crossfadeSeconds: CROSSFADE_SECONDS, outputPath: crossfadedPath });

    // The crossfade-chain accounting above is exact in theory (see
    // chainAcrossfade's own comment), but ffmpeg's real frame boundaries can
    // still shift the result by a handful of milliseconds. Rather than trust
    // the arithmetic alone, the assembled bed is measured with a real
    // ffprobe call, and an exact atrim/apad to the real target duration is
    // applied ("Son aşamada kesin candidate duration'a 'atrim' uygula"),
    // with the drift itself gated to the task's own ≤3-frame/~0.1s
    // tolerance -- a larger drift means the crossfade math is actually
    // wrong and must fail loud, not be silently papered over.
    const preTrimDuration = await durationSecondsOf(crossfadedPath);
    const drift = targetTotal - preTrimDuration;
    if (Math.abs(drift) > DURATION_TOLERANCE_SECONDS)
      throw new Error(`Full music bed crossfade assembly drifted ${drift.toFixed(3)}s from its target ${targetTotal}s total (assembled to ${preTrimDuration}s) -- exceeds the allowed ~3-frame/0.1s tolerance`);
    await command("ffmpeg", [
      "-hide_banner", "-nostats", "-y", "-i", crossfadedPath,
      "-af", `apad=pad_dur=${Math.max(0, drift)}`, "-t", String(targetTotal),
      "-ac", "2", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "192k", destination
    ]);

    const bytes = (await readFile(destination)).length;
    const sha256 = await sha256File(destination);
    const totalDuration = await durationSecondsOf(destination);
    if (Math.abs(totalDuration - targetTotal) > DURATION_TOLERANCE_SECONDS)
      throw new Error(`Full music bed final duration ${totalDuration}s does not match target ${targetTotal}s within tolerance (ffprobe-verified)`);
    const licenseUrls = new Set(cueRecords.map((record) => record.license_url));
    const licenseNames = new Set(cueRecords.map((record) => record.license_name));

    const distinctTrackIds = new Set(cueRecords.map((record) => record.track_id));
    const distinctArtists = new Set(cueRecords.map((record) => record.artist));
    const provenance = {
      schema_version: "1.1",
      asset: "assets/music/approved_bed.mp3",
      // Was "nine_cue_concatenation", then briefly "sequenced_tonal_arc" --
      // now the bed is built from a SINGLE composition family's own
      // main/no-melody stems only (task follow-up section 12), concatenated
      // with real overlapping ffmpeg `acrossfade` transitions and exact
      // duration compensation (task follow-up section 16), not merely
      // "same composer" (Catalyst/Emergent/Undertow/Ephemera/Horizons/Solace
      // are all Scott Buckley but are each a distinct composition, and are
      // no longer used as full_cues assignments -- see
      // docs/canonical-candidate-audit.md section 4).
      assembly: "single_composition_layered_bed",
      composition_family: distinctFamilies[0],
      single_tonal_world: distinctArtists.size === 1,
      distinct_track_count: distinctTrackIds.size,
      crossfade_seconds: CROSSFADE_SECONDS,
      crossfade_method: "ffmpeg_acrossfade_chain_with_duration_compensation",
      duration_verified_by: "ffprobe",
      duration_tolerance_seconds: DURATION_TOLERANCE_SECONDS,
      target_duration_seconds: Math.round(targetTotal * 1000) / 1000,
      cues: cueRecords,
      license: licenseNames.size === 1 ? [...licenseNames][0] : [...licenseNames].join(" / "),
      license_url: licenseUrls.size === 1 ? [...licenseUrls][0] : [...licenseUrls].join(" "),
      attribution: cueRecords.map((record) => record.attribution).filter((value, index, all) => all.indexOf(value) === index).join("\n"),
      approved_for_final_edit: true,
      sha256,
      bytes,
      duration_seconds: Math.round(totalDuration * 1000) / 1000,
      resolved_at: new Date().toISOString(),
      reproducibility: "canonical_registry_pinned",
      canonical_track_ids: cueRecords.map((record) => record.track_id)
    };
    await writeJsonAtomic(path.join(dir, "assets", "music", "approved_bed.provenance.json"), provenance);
    return { track_ids: provenance.canonical_track_ids, cue_count: cueRecords.length, duration_seconds: provenance.duration_seconds, ...provenance };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export async function resolveProjectMusic(projectId = PROJECT_ID, { mode, targetDurationSeconds = null } = {}) {
  if (mode !== "proof" && mode !== "full") throw new Error(`mode must be "proof" or "full", got "${mode}"`);
  const dir = projectDir(projectId);
  const cueSheet = await readJson(path.join(dir, "direction", "music_cue_sheet.json"));
  const registry = await loadMusicRegistry();
  const destination = path.join(dir, "assets", "music", "approved_bed.mp3");

  if (mode === "proof") {
    const trackId = extractRequiredTrackId(cueSheet, mode);
    const track = await resolveCanonicalTrackToPath(trackId, { mode, destinationAbsPath: destination, registry });
    const provenance = {
      schema_version: "1.0",
      asset: "assets/music/approved_bed.mp3",
      title: track.title,
      composer: track.artist,
      source_page_url: track.source_page_url,
      license: track.license_name,
      license_url: track.license_url,
      attribution: track.attribution,
      approved_for_final_edit: true,
      sha256: track.sha256,
      bytes: track.bytes,
      duration_seconds: track.duration_seconds,
      resolved_at: new Date().toISOString(),
      reproducibility: "canonical_registry_pinned",
      canonical_track_id: track.track_id
    };
    await writeJsonAtomic(path.join(dir, "assets", "music", "approved_bed.provenance.json"), provenance);
    return { mode, track_id: track.track_id, ...provenance };
  }

  const cues = extractFullCueTrackIds(cueSheet);
  const result = await buildFullMusicBed({ dir, cues, registry, destination, targetDurationSeconds });
  return { mode, ...result };
}

export { buildFullMusicBed };

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  resolveProjectMusic(args["project-id"] || PROJECT_ID, {
    mode: args.mode || "proof",
    targetDurationSeconds: args["target-duration-seconds"] ? Number.parseFloat(args["target-duration-seconds"]) : null
  })
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
