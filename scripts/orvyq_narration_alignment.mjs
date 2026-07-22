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
import { projectDir, readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";

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

  const alignment = {
    schema_version: "1.0-canonical",
    project_id: projectId,
    source_audio_sha256: await sha256OfFile(audioPath),
    model: report.model,
    generated_at: new Date().toISOString(),
    duration_seconds: report.source_duration_seconds,
    script_similarity: report.script_similarity,
    transcript: report.transcript,
    words: report.words.map((word) => ({ text: word.text, start: word.start, end: word.end, probability: word.probability }))
  };

  await writeJsonAtomic(path.join(dir, "voice", "narration_alignment.json"), alignment);
  return { word_count: alignment.words.length, duration_seconds: alignment.duration_seconds };
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
