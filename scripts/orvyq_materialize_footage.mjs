#!/usr/bin/env node
// materializeExternalFootage() -- ports ORVYQ's (brsctncnbrk-ops/ORVYQ,
// src/lib/materialize.ts) materializeExternalAssets() mechanism into this
// repo's canonical pipeline: fetch a pinned, immutable commit from an
// external source repository over git + Git LFS, hash-verify every file
// against its own LFS pointer's sha256/size before trusting it, and copy the
// verified bytes into this project's assets/ tree. Both proof mode (via
// direction/motion_hook.json) and full mode (via
// direction/editorial_blueprint.json's full_production.shots) read footage
// through the exact same assets/footage/<file> paths this writes -- there is
// no mode argument here because there is nothing mode-specific left to
// select; every footage file in the manifest is real, licensed, and used by
// at least one of the two shared cuts.
//
// One deliberate fix over the ported original: the original ran a global
// `git lfs fsck` after pulling only a subset of the source tree's LFS
// pointers. `git lfs fsck` reports every OTHER LFS pointer in the checked-out
// tree that was never pulled as a corrupt/missing object and exits non-zero
// -- a false failure on any partial checkout, verified directly against this
// exact source commit (git-lfs 3.4.1) before writing this script. The real
// integrity check -- comparing each pulled file's actual sha256 and byte
// size against its own LFS pointer -- already happens per-file below and is
// sufficient; the redundant, broken global fsck call is not ported.
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { projectDir, readJson, writeJsonAtomic, pathExists, parseArgs, printJson } from "./lib/fs-utils.mjs";

const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";

function safeRelative(value, label) {
  if (!value || typeof value !== "string" || path.isAbsolute(value) || value.includes("\\"))
    throw new Error(`${label} must be a non-empty POSIX relative path`);
  const normalized = path.posix.normalize(value);
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../"))
    throw new Error(`${label} escapes its root: ${value}`);
  return normalized;
}

export function validateExternalManifest(manifest) {
  const failures = [];
  if (manifest.schema_version !== 1) failures.push("schema_version must be 1");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(manifest.source_repository)) failures.push("source_repository must be owner/name");
  if (!/^[a-f0-9]{40}$/.test(manifest.source_commit)) failures.push("source_commit must be a full 40-character SHA");
  const targets = new Set();
  for (const [index, item] of (manifest.imports || []).entries()) {
    try { safeRelative(item.source_path, `imports[${index}].source_path`); } catch (error) { failures.push(String(error.message || error)); }
    try { safeRelative(item.target_path, `imports[${index}].target_path`); } catch (error) { failures.push(String(error.message || error)); }
    if (!["footage", "narration", "provenance"].includes(item.kind)) failures.push(`imports[${index}].kind is invalid`);
    if (targets.has(item.target_path)) failures.push(`duplicate target_path ${item.target_path}`);
    targets.add(item.target_path);
    if (item.companion_for) {
      try { safeRelative(item.companion_for, `imports[${index}].companion_for`); } catch (error) { failures.push(String(error.message || error)); }
    }
  }
  return failures;
}

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function parseLfsPointer(text) {
  if (!text.startsWith("version https://git-lfs.github.com/spec/v1")) return null;
  const oid = text.match(/oid sha256:([a-f0-9]{64})/)?.[1];
  const size = Number(text.match(/size (\d+)/)?.[1]);
  if (!oid || !Number.isFinite(size)) throw new Error("Malformed Git LFS pointer");
  return { oid, size };
}

async function sha256File(absPath) {
  const buffer = await readFile(absPath);
  return createHash("sha256").update(buffer).digest("hex");
}

export async function materializeExternalFootage(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const manifestFile = path.join(dir, "migration", "external_assets.json");
  if (!(await pathExists(manifestFile))) {
    console.log("No external asset manifest; nothing to materialize");
    return { materialized: 0 };
  }
  const manifest = await readJson(manifestFile);
  const failures = validateExternalManifest(manifest);
  if (failures.length) throw new Error(`Invalid external asset manifest:\n- ${failures.join("\n- ")}`);

  const temp = await mkdtemp(path.join(os.tmpdir(), "orvyq-external-"));
  const checkout = path.join(temp, "source");
  const records = [];
  try {
    await mkdir(checkout, { recursive: true });
    run("git", ["init", "--quiet"], checkout);
    run("git", ["remote", "add", "origin", `https://github.com/${manifest.source_repository}.git`], checkout);
    run("git", ["fetch", "--depth=1", "origin", manifest.source_commit], checkout, { GIT_LFS_SKIP_SMUDGE: "1" });
    run("git", ["checkout", "--detach", "FETCH_HEAD"], checkout, { GIT_LFS_SKIP_SMUDGE: "1" });
    run("git", ["lfs", "install", "--local"], checkout);

    const pointers = new Map();
    for (const item of manifest.imports) {
      const pointerText = run("git", ["show", `HEAD:${item.source_path}`], checkout);
      pointers.set(item.source_path, parseLfsPointer(pointerText));
    }
    const lfsPaths = [...new Set(manifest.imports.filter((item) => pointers.get(item.source_path)).map((item) => item.source_path))];
    if (lfsPaths.length) {
      run("git", ["lfs", "pull", "--include", lfsPaths.join(","), "--exclude", ""], checkout);
      // Deliberately no `git lfs fsck` here -- see file header. Per-file
      // sha256/size verification against each pulled file's own LFS pointer
      // (below) is the real integrity check.
    }

    for (const item of manifest.imports) {
      const source = path.join(checkout, item.source_path);
      const target = path.join(dir, safeRelative(item.target_path, "target_path"));
      if (!(await pathExists(source))) throw new Error(`External source file is missing after checkout: ${item.source_path}`);
      const pointer = pointers.get(item.source_path) ?? null;
      const sourceBytes = await readFile(source);
      if (pointer) {
        if (sourceBytes.byteLength !== pointer.size) throw new Error(`${item.source_path} size ${sourceBytes.byteLength} != LFS pointer ${pointer.size}`);
        const digest = await sha256File(source);
        if (digest !== pointer.oid) throw new Error(`${item.source_path} SHA-256 ${digest} != LFS pointer ${pointer.oid}`);
      }
      await mkdir(path.dirname(target), { recursive: true });
      await cp(source, target);
      records.push({
        source_repository: manifest.source_repository,
        source_commit: manifest.source_commit,
        source_path: item.source_path,
        target_path: item.target_path,
        kind: item.kind,
        lfs_oid_sha256: pointer?.oid ?? null,
        size_bytes: sourceBytes.byteLength,
        materialized_sha256: await sha256File(target)
      });
    }
    await writeJsonAtomic(path.join(dir, "qa", "external_assets.provenance.json"), {
      schema_version: 1,
      project_id: projectId,
      source_repository: manifest.source_repository,
      source_commit: manifest.source_commit,
      generated_at: new Date().toISOString(),
      records
    });
    console.log(`Materialized ${records.length} external asset files from ${manifest.source_repository}@${manifest.source_commit}`);
    return { materialized: records.length };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  materializeExternalFootage(args["project-id"] || PROJECT_ID)
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
