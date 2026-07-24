import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(path.join(root, "baseline-manifest.json"), "utf8"));
const filename = path.join(root, "dist", "## JOGUE AQUI.html");
const releaseBytes = await readFile(filename);
const html = releaseBytes.toString("utf8");
const file = await stat(filename);
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const idSet = new Set(ids);

const canonicalBytes = await readFile(path.join(root, "## JOGUE AQUI.html"));
if (!canonicalBytes.equals(releaseBytes)) {
  throw new Error("Repository-root playable HTML is stale; it must exactly match the verified dist release.");
}

if (file.size > manifest.maximumReleaseHtmlBytes) {
  throw new Error(`Release HTML is ${file.size} bytes; budget is ${manifest.maximumReleaseHtmlBytes}.`);
}
if (/\b(?:import|export)\s/.test(html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "")) {
  throw new Error("Production script still contains runtime module syntax.");
}
if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error("Release contains unresolved template tokens.");
if (html.includes("__COSMIC_TEST__")) throw new Error("Production release exposes the test-only interface.");
if ((html.match(/<script(?:\s|>)/g) || []).length !== 1) throw new Error("Release must contain exactly one classic script.");
if ((html.match(/<style(?:\s|>)/g) || []).length !== 1) throw new Error("Release must contain exactly one style block.");
if (/<script[^>]+(?:type="module"|src=)/.test(html)) throw new Error("Release script must be inline and classic.");
if (ids.length !== idSet.size) throw new Error("Release contains duplicate DOM IDs.");
for (const id of manifest.domIds) {
  if (!idSet.has(id)) throw new Error(`Release lost baseline DOM ID: ${id}`);
}
if (!idSet.has("mobile-pause-button")) throw new Error("Release is missing the responsive pause control.");
if (!html.includes(".mobile-pause-button{display:none") || !html.includes("width:44px;height:44px")) {
  throw new Error("Release lost the mobile pause control's hidden default or 44px target size.");
}
const responsivePauseRule = ".shell[data-state=playing] .mobile-pause-button,.shell[data-state=paused] .mobile-pause-button{display:grid}";
if (!html.includes("@media(max-width:1100px)") || !html.includes(responsivePauseRule)) {
  throw new Error("Release lost the mobile pause control's responsive playing/paused visibility rule.");
}
for (const key of manifest.storageKeys) {
  if (!html.includes(key)) throw new Error(`Release lost persistence key: ${key}`);
}
if ((html.match(/THREE\.REVISION|revision:"160"|REVISION="160"/g) || []).length > 1) {
  throw new Error("Release appears to include multiple Three.js copies.");
}
for (const asset of manifest.assets) {
  const assetPath = path.join(root, "dist", asset.name);
  const contents = await readFile(assetPath);
  const digest = createHash("sha256").update(contents).digest("hex");
  if (contents.length !== asset.bytes || digest !== asset.sha256) throw new Error(`Release asset changed: ${asset.name}`);
  if (asset.referenceRequired !== false && !html.includes(`"${asset.name}"`)) {
    throw new Error(`Release does not reference asset: ${asset.name}`);
  }
}
console.log(`Verified direct-file release (${file.size} bytes).`);
