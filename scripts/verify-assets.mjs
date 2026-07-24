import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(path.join(root, "baseline-manifest.json"), "utf8"));

async function existingAsset(name) {
  for (const directory of [path.join(root, "assets"), root]) {
    const candidate = path.join(directory, name);
    try {
      await stat(candidate);
      return candidate;
    } catch {
      // Continue to the baseline-root fallback while the refactor is staged.
    }
  }
  throw new Error(`Missing asset: ${name}`);
}

for (const asset of manifest.assets) {
  const filename = await existingAsset(asset.name);
  const contents = await readFile(filename);
  const digest = createHash("sha256").update(contents).digest("hex");
  if (contents.length !== asset.bytes || digest !== asset.sha256) {
    throw new Error(`Asset changed unexpectedly: ${asset.name}`);
  }
}
console.log(`Verified ${manifest.assets.length} original assets.`);
