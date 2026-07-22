import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const REPO_ROOT = path.resolve(new URL("../../", import.meta.url).pathname);
export const PROJECTS_DIR = path.join(REPO_ROOT, "projects");
export const TEMPLATES_DIR = path.join(REPO_ROOT, "templates");
export const SCHEMAS_DIR = path.join(REPO_ROOT, "schemas");
export const MUSIC_LIBRARY_DIR = path.join(REPO_ROOT, "music_library");
export const MUSIC_REGISTRY_PATH = path.join(MUSIC_LIBRARY_DIR, "registry.json");
export const INDEX_PATH = path.join(PROJECTS_DIR, "_index.json");
export const PROJECT_ID_PATTERN = /^[0-9]{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assertValidProjectId(projectId) {
  if (typeof projectId !== "string" || !PROJECT_ID_PATTERN.test(projectId)) {
    throw new CliError(
      `Invalid project id "${projectId ?? ""}". Expected a value like 001-my-video.`,
      "INVALID_PROJECT_ID"
    );
  }

  const resolved = path.resolve(PROJECTS_DIR, projectId);
  const projectsRoot = path.resolve(PROJECTS_DIR) + path.sep;
  if (!resolved.startsWith(projectsRoot)) {
    throw new CliError("Project path escapes the projects directory.", "INVALID_PROJECT_ID");
  }

  return projectId;
}

export function projectDir(projectId) {
  assertValidProjectId(projectId);
  return path.join(PROJECTS_DIR, projectId);
}

export async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    const error = new Error(`Invalid JSON in ${filePath}: ${err.message}`);
    error.code = "INVALID_JSON";
    throw error;
  }
}

export async function readJsonSafe(filePath, fallback = null) {
  if (!(await pathExists(filePath))) return fallback;
  return readJson(filePath);
}

/**
 * Atomic write: write to a temp file in the same directory, then rename.
 * Rename is atomic on POSIX filesystems, avoiding torn writes if two
 * processes touch the same project concurrently.
 */
export async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(tmpPath, filePath);
}

export async function appendLine(filePath, line) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, line.endsWith("\n") ? line : line + "\n", "utf8");
}

// Never worth copying into a scaffolded project or a render_ready_project -
// build/VCS artifacts a developer's local checkout might happen to have
// (e.g. from testing templates/remotion/ locally), never source content.
const COPY_DIR_SKIP = new Set(["node_modules", ".git", "out", ".remotion"]);

export async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && COPY_DIR_SKIP.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

export async function listFiles(dir, { extensions = null } = {}) {
  if (!(await pathExists(dir))) return [];
  const out = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (!extensions || extensions.some((ext) => entry.name.endsWith(ext))) {
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out;
}

export function nowIso() {
  return new Date().toISOString();
}

/** Parses `--flag value` / `--flag=value` style args into an object. Bare `--flag` becomes true. */
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq !== -1) {
      args[token.slice(2, eq)] = token.slice(eq + 1);
    } else {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

export function printJson(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

export class CliError extends Error {
  constructor(message, code = "UNKNOWN_ERROR") {
    super(message);
    this.code = code;
  }
}
