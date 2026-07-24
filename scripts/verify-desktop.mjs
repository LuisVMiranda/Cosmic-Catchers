import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const artifactName = `Cosmic-Catchers-${packageJson.version}-Windows-Portable.exe`;
const artifactPath = path.join(root, "release", artifactName);
const artifact = await readFile(artifactPath);
const artifactStats = await stat(artifactPath);
const manifest = JSON.parse(await readFile(path.join(root, "baseline-manifest.json"), "utf8"));

if (artifactStats.size < 10_000_000) throw new Error(`Desktop artifact is unexpectedly small: ${artifactStats.size} bytes.`);
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "cosmic-catchers-desktop-"));
const smokeOutput = path.join(temporaryRoot, "smoke.json");
const profileRoot = path.join(temporaryRoot, "profile");
let launchError = null;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForSmokeResult() {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (launchError) throw launchError;
    try {
      return JSON.parse(await readFile(smokeOutput, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await delay(500);
    }
  }
  throw new Error("Desktop smoke test did not return within 90 seconds.");
}

const child = spawn(artifactPath, [], {
  env: {
    ...process.env,
    COSMIC_CATCHERS_SMOKE_OUTPUT: smokeOutput,
    COSMIC_CATCHERS_USER_DATA: profileRoot
  },
  stdio: "ignore",
  windowsHide: true
});
child.on("error", (error) => {
  launchError = error;
});

try {
  const result = await waitForSmokeResult();
  if (result.error) throw new Error(result.error);
  const persistedKeys = manifest.storageKeys.filter((key) => Object.hasOwn(result.storage, key));
  if (persistedKeys.length) throw new Error(`Fresh desktop profile contained saved data: ${persistedKeys.join(", ")}`);
  if (result.score !== "0" || result.best !== "0" || !result.ready) {
    throw new Error(`Desktop did not open as a fresh game: ${JSON.stringify(result)}`);
  }
  await delay(1000);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

const digest = createHash("sha256").update(artifact).digest("hex");
const checksumPath = `${artifactPath}.sha256`;
await writeFile(checksumPath, `${digest}  ${artifactName}\n`, "utf8");
console.log(`Verified fresh Windows executable (${artifactStats.size} bytes, SHA-256 ${digest}).`);
