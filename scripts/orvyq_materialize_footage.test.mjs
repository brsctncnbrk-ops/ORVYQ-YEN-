import { test } from "node:test";
import assert from "node:assert/strict";
import { validateExternalManifest } from "./orvyq_materialize_footage.mjs";

function baseManifest(overrides = {}) {
  return {
    schema_version: 1,
    source_repository: "brsctncnbrk-ops/YouTube_pepline",
    source_commit: "6ae8ccc7142eac61ae270b7a68f11e73c8d08e68",
    imports: [
      { source_path: "a/clip.mp4", target_path: "assets/footage/clip.mp4", kind: "footage" },
      { source_path: "a/clip.mp4.provenance.json", target_path: "assets/footage/clip.mp4.provenance.json", kind: "provenance", companion_for: "assets/footage/clip.mp4" }
    ],
    ...overrides
  };
}

test("validateExternalManifest accepts a well-formed manifest with a matched footage/provenance pair", () => {
  assert.deepEqual(validateExternalManifest(baseManifest()), []);
});

test("validateExternalManifest rejects a footage import with no companion provenance entry", () => {
  const manifest = baseManifest({ imports: [{ source_path: "a/clip.mp4", target_path: "assets/footage/clip.mp4", kind: "footage" }] });
  const failures = validateExternalManifest(manifest);
  assert.ok(failures.some((f) => f.includes("no companion provenance entry")));
});

test("validateExternalManifest rejects a provenance entry whose companion_for points at nothing in the manifest", () => {
  const manifest = baseManifest({
    imports: [
      { source_path: "a/clip.mp4", target_path: "assets/footage/clip.mp4", kind: "footage" },
      { source_path: "a/clip.mp4.provenance.json", target_path: "assets/footage/clip.mp4.provenance.json", kind: "provenance", companion_for: "assets/footage/other.mp4" }
    ]
  });
  const failures = validateExternalManifest(manifest);
  assert.ok(failures.some((f) => f.includes("companion_for target does not exist")));
});

test("validateExternalManifest rejects a provenance entry with no companion_for at all", () => {
  const manifest = baseManifest({
    imports: [
      { source_path: "a/clip.mp4", target_path: "assets/footage/clip.mp4", kind: "footage" },
      { source_path: "a/clip.mp4.provenance.json", target_path: "assets/footage/clip.mp4.provenance.json", kind: "provenance" }
    ]
  });
  const failures = validateExternalManifest(manifest);
  assert.ok(failures.some((f) => f.includes("declares no companion_for")));
});

test("validateExternalManifest rejects a non-provenance entry that declares companion_for", () => {
  const manifest = baseManifest({
    imports: [
      { source_path: "a/clip.mp4", target_path: "assets/footage/clip.mp4", kind: "footage", companion_for: "assets/footage/clip.mp4" },
      { source_path: "a/clip.mp4.provenance.json", target_path: "assets/footage/clip.mp4.provenance.json", kind: "provenance", companion_for: "assets/footage/clip.mp4" }
    ]
  });
  const failures = validateExternalManifest(manifest);
  assert.ok(failures.some((f) => f.includes("only provenance entries may")));
});

test("validateExternalManifest rejects duplicate target_path entries", () => {
  const manifest = baseManifest({
    imports: [
      { source_path: "a/clip.mp4", target_path: "assets/footage/clip.mp4", kind: "footage" },
      { source_path: "b/clip.mp4", target_path: "assets/footage/clip.mp4", kind: "footage" },
      { source_path: "a/clip.mp4.provenance.json", target_path: "assets/footage/clip.mp4.provenance.json", kind: "provenance", companion_for: "assets/footage/clip.mp4" }
    ]
  });
  const failures = validateExternalManifest(manifest);
  assert.ok(failures.some((f) => f.includes("duplicate target_path")));
});

test("validateExternalManifest rejects a malformed source_commit and source_repository", () => {
  const manifest = baseManifest({ source_commit: "not-a-sha", source_repository: "not_a_valid_repo_string!!" });
  const failures = validateExternalManifest(manifest);
  assert.ok(failures.some((f) => f.includes("source_commit")));
  assert.ok(failures.some((f) => f.includes("source_repository")));
});

test("validateExternalManifest rejects a path that escapes its root", () => {
  const manifest = baseManifest({
    imports: [
      { source_path: "../../etc/passwd", target_path: "assets/footage/clip.mp4", kind: "footage" },
      { source_path: "a/clip.mp4.provenance.json", target_path: "assets/footage/clip.mp4.provenance.json", kind: "provenance", companion_for: "assets/footage/clip.mp4" }
    ]
  });
  const failures = validateExternalManifest(manifest);
  assert.ok(failures.some((f) => f.includes("escapes its root")));
});

test("validateExternalManifest accepts the real project manifest", async () => {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(
    await readFile(new URL("../projects/001-the-ai-race-no-one-can-afford-to-win/migration/external_assets.json", import.meta.url))
  );
  assert.deepEqual(validateExternalManifest(manifest), []);
});
