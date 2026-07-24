const fileSystem = require("node:fs/promises");
const path = require("node:path");

const PROFILE_SCHEMA = "fresh-v1";
const MARKER_NAME = ".cosmic-catchers-profile";
const STORAGE_TYPES = ["localstorage", "indexdb", "serviceworkers", "cachestorage"];

function safeSegment(value) {
  return String(value).replace(/[^a-z0-9.-]+/gi, "-").toLowerCase();
}

function createReleaseProfileRoot({ appData, version }) {
  return path.join(appData, "Cosmic Catchers", `${safeSegment(version)}-${PROFILE_SCHEMA}`);
}

async function markerExists({ markerPath, fs = fileSystem }) {
  try {
    await fs.access(markerPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function writeMarker({ markerPath, version, fs = fileSystem }) {
  await fs.mkdir(path.dirname(markerPath), { recursive: true });
  try {
    await fs.writeFile(markerPath, JSON.stringify({ schema: PROFILE_SCHEMA, version }), { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
}

async function prepareReleaseProfile({ storageSession, profileRoot, version, fs = fileSystem }) {
  const markerPath = path.join(profileRoot, MARKER_NAME);
  if (await markerExists({ markerPath, fs })) return false;
  await storageSession.clearStorageData({ storages: STORAGE_TYPES });
  await writeMarker({ markerPath, version, fs });
  return true;
}

module.exports = {
  MARKER_NAME,
  PROFILE_SCHEMA,
  STORAGE_TYPES,
  createReleaseProfileRoot,
  markerExists,
  prepareReleaseProfile,
  safeSegment,
  writeMarker
};
