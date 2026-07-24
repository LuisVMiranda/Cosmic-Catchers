import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const archive = await readFile(path.join(root, "dist", "Cosmic-Catchers-direct-file.zip"));
const manifest = JSON.parse(await readFile(path.join(root, "baseline-manifest.json"), "utf8"));
const expectedNames = ["## JOGUE AQUI.html", ...manifest.assets.map((asset) => asset.name), "SHA256SUMS"];
const entries = new Map();
let offset = 0;

while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
  const method = archive.readUInt16LE(offset + 8);
  const compressedSize = archive.readUInt32LE(offset + 18);
  const filenameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  if (method !== 0) throw new Error("Release smoke verifier expects stored ZIP entries.");
  const filenameStart = offset + 30;
  const dataStart = filenameStart + filenameLength + extraLength;
  const name = archive.subarray(filenameStart, filenameStart + filenameLength).toString("utf8");
  entries.set(name, archive.subarray(dataStart, dataStart + compressedSize));
  offset = dataStart + compressedSize;
}

if (entries.size !== expectedNames.length) throw new Error(`ZIP contains ${entries.size} files; expected ${expectedNames.length}.`);
for (const name of expectedNames) {
  if (!entries.has(name)) throw new Error(`ZIP is missing root file: ${name}`);
}
for (const asset of manifest.assets) {
  const contents = entries.get(asset.name);
  const digest = createHash("sha256").update(contents).digest("hex");
  if (contents.length !== asset.bytes || digest !== asset.sha256) throw new Error(`ZIP asset changed: ${asset.name}`);
}
const html = entries.get("## JOGUE AQUI.html").toString("utf8");
if (!html.includes('<canvas id="game-canvas"') || !html.includes('<button id="mobile-pause-button"')) {
  throw new Error("ZIP HTML smoke contract failed.");
}
console.log(`Smoke-verified release ZIP (${entries.size} root files, exact original assets).`);
