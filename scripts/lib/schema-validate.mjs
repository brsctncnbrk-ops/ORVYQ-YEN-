import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMAS_DIR = path.resolve(__dirname, "..", "..", "schemas");

export function loadCanonicalAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const file of fs.readdirSync(SCHEMAS_DIR)) {
    if (!file.endsWith(".schema.json")) continue;
    const schema = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, file), "utf8"));
    ajv.addSchema(schema, file);
  }
  return ajv;
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
