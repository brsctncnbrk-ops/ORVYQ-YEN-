#!/usr/bin/env node
// buildCanonicalNarrationAlignment() -- the single, committed source of truth
// for per-word ASR timestamps of the real narration recording against
// voice_script.txt. orvyq_speech_qa.py already produces this data (word-level
// timestamps + transcript) as a side effect of script-similarity validation,
// but writes it to qa/ (gitignored, ephemeral). This script repackages that
// same data into voice/narration_alignment.json, which IS committed (see
// .gitignore's carve-out, matching qa/frozen_candidate.json and
// qa/proof_approval.json), because every full-mode consumer that needs real
// narration timing -- editorial pause anchor resolution
// (scripts/lib/orvyq-pause-resolver.mjs), full shot planning, full caption
// building -- must read the SAME alignment instead of each invoking ASR
// independently. ASR itself requires network access to huggingface.co that
// this rebuild's sandbox does not have, so alignment is produced once in CI
// (see .github/workflows/orvyq-narration-validation.yml) and committed here,
// exactly like qa/frozen_candidate.json's bot-commit pattern.
import path from "node:path";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { projectDir, readJson, readJsonSafe, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";

async function sha256OfFile(absPath) {
  const buffer = await fs.readFile(absPath);
  return createHash("sha256").update(buffer).digest("hex");
}

export async function buildCanonicalNarrationAlignment(projectId = PROJECT_ID, { speechQaReportName = "full_narration_speech_qa.json" } = {}) {
  const dir = projectDir(projectId);
  const audioPath = path.join(dir, "assets", "audio", "final_voice.mp3");
  const reportPath = path.join(dir, "qa", speechQaReportName);
  const report = await readJson(reportPath);

  if (!Array.isArray(report.words) || report.words.length === 0) {
    throw new Error(`${reportPath} has no per-word timestamps -- was it produced with word_timestamps enabled?`);
  }

  const contentFields = {
    schema_version: "1.0-canonical",
    project_id: projectId,
    source_audio_sha256: await sha256OfFile(audioPath),
    model: report.model,
    duration_seconds: report.source_duration_seconds,
    script_similarity: report.script_similarity,
    transcript: report.transcript,
    words: report.words.map((word) => ({ text: word.text, start: word.start, end: word.end, probability: word.probability }))
  };

  // generated_at is operational metadata, not content: re-running ASR
  // against the exact same audio/script reproduces the exact same
  // contentFields (real, deterministic Whisper inference observed in this
  // project's own history), and a bare timestamp bump was the ONLY reason
  // orvyq-narration-validation.yml's "commit if changed" check ever saw a
  // diff, producing a bot commit on every run regardless of whether
  // anything real changed. Reuse the existing file's generated_at when the
  // real content is unchanged, so the file -- and therefore the commit
  // step's `git diff --cached --quiet` check -- stays genuinely stable.
  const alignmentPath = path.join(dir, "voice", "narration_alignment.json");
  const existing = await readJsonSafe(alignmentPath, null);
  const existingContentFields = existing ? { ...existing, generated_at: undefined } : null;
  const contentUnchanged = existingContentFields && JSON.stringify(existingContentFields) === JSON.stringify({ ...contentFields, generated_at: undefined });
  // Field order matches the historical file (generated_at right after
  // model) so an unchanged run also produces byte-identical JSON, not just
  // semantically-equal JSON.
  const alignment = {
    schema_version: contentFields.schema_version,
    project_id: contentFields.project_id,
    source_audio_sha256: contentFields.source_audio_sha256,
    model: contentFields.model,
    generated_at: contentUnchanged ? existing.generated_at : new Date().toISOString(),
    duration_seconds: contentFields.duration_seconds,
    script_similarity: contentFields.script_similarity,
    transcript: contentFields.transcript,
    words: contentFields.words
  };

  await writeJsonAtomic(alignmentPath, alignment);
  return { word_count: alignment.words.length, duration_seconds: alignment.duration_seconds, content_unchanged: Boolean(contentUnchanged) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  buildCanonicalNarrationAlignment(args["project-id"] || PROJECT_ID, { speechQaReportName: args["speech-qa-report"] || undefined })
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
