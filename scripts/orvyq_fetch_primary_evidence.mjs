#!/usr/bin/env node
import path from "node:path";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projectDir, readJson, writeJsonAtomic, pathExists } from "./lib/fs-utils.mjs";

const run = promisify(execFile);
const PROJECT_ID = "001-the-ai-race-no-one-can-afford-to-win";
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

function assertMagic(buffer, mime, assetId) {
  if (mime === "application/pdf" && buffer.subarray(0, 4).toString("ascii") !== "%PDF") throw new Error(`${assetId} did not download as a PDF`);
  if (mime === "image/png" && buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error(`${assetId} did not download as a PNG`);
}

async function fetchBuffer(url, allowedHosts) {
  const parsed = new URL(url);
  if (!allowedHosts.includes(parsed.hostname)) throw new Error(`Evidence host is not allowlisted: ${parsed.hostname}`);
  const response = await fetch(parsed, { redirect: "follow", headers: { "user-agent": "ORVYQ-primary-evidence-fetch/2.0" }, signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`Evidence download failed ${response.status}: ${url}`);
  const finalUrl = new URL(response.url);
  if (!allowedHosts.includes(finalUrl.hostname)) throw new Error(`Evidence redirect escaped allowlist: ${finalUrl.hostname}`);
  return { buffer: Buffer.from(await response.arrayBuffer()), final_url: finalUrl.toString(), content_type: response.headers.get("content-type") || null };
}

export async function fetchPrimaryEvidence(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const manifest = await readJson(path.join(dir, "research", "primary_evidence_manifest.json"));
  const allowedHosts = manifest.policy?.allowed_hosts || [];
  const downloadGroups = new Map();
  for (const asset of manifest.assets || []) {
    const existing = downloadGroups.get(asset.download_asset);
    if (existing && existing.source_url !== asset.source_url) throw new Error(`Conflicting URLs for ${asset.download_asset}`);
    downloadGroups.set(asset.download_asset, asset);
  }

  const downloadRecords = new Map();
  for (const [relativePath, asset] of downloadGroups.entries()) {
    const target = path.join(dir, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const { buffer, final_url, content_type } = await fetchBuffer(asset.source_url, allowedHosts);
    if (buffer.length < Number(asset.min_bytes || 1)) throw new Error(`${asset.evidence_asset_id} downloaded only ${buffer.length} bytes`);
    assertMagic(buffer, asset.mime, asset.evidence_asset_id);
    await fs.writeFile(target, buffer);
    downloadRecords.set(relativePath, { source_url: asset.source_url, final_url, content_type, bytes: buffer.length, sha256: sha256(buffer) });
  }

  const runtimeAssets = [];
  for (const asset of manifest.assets || []) {
    const rawPath = path.join(dir, asset.download_asset);
    const localPath = path.join(dir, asset.local_asset);
    if (asset.mime === "application/pdf") {
      const prefix = localPath.replace(/\.png$/i, "");
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await run("pdftoppm", ["-f", String(asset.page_number), "-l", String(asset.page_number), "-singlefile", "-png", "-r", "150", rawPath, prefix], { maxBuffer: 20 * 1024 * 1024 });
    }
    if (!(await pathExists(localPath))) throw new Error(`Primary evidence output missing: ${asset.local_asset}`);
    const localBuffer = await fs.readFile(localPath);
    if (localBuffer.length < 30000) throw new Error(`Primary evidence output is unexpectedly small: ${asset.local_asset}`);
    assertMagic(localBuffer, "image/png", asset.evidence_asset_id);
    runtimeAssets.push({ evidence_asset_id: asset.evidence_asset_id, source_ids: asset.source_ids, source_url: asset.source_url, final_url: downloadRecords.get(asset.download_asset)?.final_url || asset.source_url, local_asset: asset.local_asset, download_asset: asset.download_asset, page_number: asset.page_number || null, provenance_mode: asset.provenance_mode, caption: asset.caption, bytes: localBuffer.length, sha256: sha256(localBuffer) });
  }

  const runtime = { schema_version: "2.0", project_id: projectId, generated_at: new Date().toISOString(), policy: manifest.policy, downloads: Object.fromEntries(downloadRecords), assets: runtimeAssets, pass: runtimeAssets.length === (manifest.assets || []).length };
  await writeJsonAtomic(path.join(dir, manifest.policy.runtime_manifest), runtime);
  return runtime;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fetchPrimaryEvidence().then((runtime) => console.log(JSON.stringify({ ok: true, asset_count: runtime.assets.length, total_bytes: runtime.assets.reduce((sum, asset) => sum + asset.bytes, 0), runtime_manifest: runtime.policy.runtime_manifest }))).catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
}
