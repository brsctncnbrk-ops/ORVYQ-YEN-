import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PROJECTS_DIR } from "./lib/fs-utils.mjs";
import { buildCanonicalNarrationAlignment } from "./orvyq_narration_alignment.mjs";

const FIXTURE_PROJECT_ID = "997-narration-alignment-fixture";
const FIXTURE_DIR = path.join(PROJECTS_DIR, FIXTURE_PROJECT_ID);

async function writeFixture({ transcript = "hello world" } = {}) {
  await fs.mkdir(path.join(FIXTURE_DIR, "assets", "audio"), { recursive: true });
  await fs.mkdir(path.join(FIXTURE_DIR, "qa"), { recursive: true });
  await fs.mkdir(path.join(FIXTURE_DIR, "voice"), { recursive: true });
  await fs.writeFile(path.join(FIXTURE_DIR, "assets", "audio", "final_voice.mp3"), "fake narration bytes");
  await fs.writeFile(
    path.join(FIXTURE_DIR, "qa", "full_narration_speech_qa.json"),
    JSON.stringify({
      model: "tiny.en",
      source_duration_seconds: 12.34,
      script_similarity: 0.98,
      transcript,
      words: [{ text: "hello", start: 0, end: 0.5, probability: 0.99 }, { text: "world", start: 0.5, end: 1.0, probability: 0.98 }]
    })
  );
}

test("re-running ASR against unchanged content reuses the same generated_at (no spurious commit-worthy diff)", async (t) => {
  await writeFixture();
  t.after(() => fs.rm(FIXTURE_DIR, { recursive: true, force: true }));

  const first = await buildCanonicalNarrationAlignment(FIXTURE_PROJECT_ID);
  assert.equal(first.content_unchanged, false);
  const firstFile = await fs.readFile(path.join(FIXTURE_DIR, "voice", "narration_alignment.json"), "utf8");

  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await buildCanonicalNarrationAlignment(FIXTURE_PROJECT_ID);
  assert.equal(second.content_unchanged, true);
  const secondFile = await fs.readFile(path.join(FIXTURE_DIR, "voice", "narration_alignment.json"), "utf8");

  // Byte-identical -- this is exactly what makes `git diff --cached --quiet`
  // in orvyq-narration-validation.yml correctly see "nothing to commit".
  assert.equal(firstFile, secondFile);
});

test("a real content change (different transcript) gets a fresh generated_at", async (t) => {
  await writeFixture({ transcript: "hello world" });
  t.after(() => fs.rm(FIXTURE_DIR, { recursive: true, force: true }));

  await buildCanonicalNarrationAlignment(FIXTURE_PROJECT_ID);
  const firstFile = JSON.parse(await fs.readFile(path.join(FIXTURE_DIR, "voice", "narration_alignment.json"), "utf8"));

  await writeFixture({ transcript: "a completely different real transcript" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const result = await buildCanonicalNarrationAlignment(FIXTURE_PROJECT_ID);
  assert.equal(result.content_unchanged, false);
  const secondFile = JSON.parse(await fs.readFile(path.join(FIXTURE_DIR, "voice", "narration_alignment.json"), "utf8"));

  assert.notEqual(firstFile.generated_at, secondFile.generated_at);
  assert.notEqual(firstFile.transcript, secondFile.transcript);
});
