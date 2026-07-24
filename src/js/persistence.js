import { PROGRESS_STORAGE_KEYS, STORAGE_KEYS } from "./config.js";

function readValue(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}
function readNumber(storage, key, fallback = 0) {
  const stored = readValue(storage, key);
  if (stored === null || stored === "") return fallback;
  const value = Number(stored);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
function readOptionalNumber(storage, key) {
  const stored = readValue(storage, key);
  if (stored === null || stored === "") return null;
  const value = Number(stored);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
function readBoolean(storage, key) {
  return readValue(storage, key) === "true";
}
function modeKey(prefix, mode) {
  const suffix = mode === "hard" ? "Hard" : "Easy";
  return STORAGE_KEYS[`${prefix}${suffix}`];
}
function campaignBest(storage, mode) {
  const legacyKey = mode === "hard" ? STORAGE_KEYS.bestHard : STORAGE_KEYS.bestEasy;
  const legacy = readNumber(storage, legacyKey, 0);
  return readNumber(storage, modeKey("campaignBest", mode), legacy);
}
function loadProgress(storage) {
  return {
    campaignBestByMode: {
      easy: campaignBest(storage, "easy"),
      hard: campaignBest(storage, "hard")
    },
    endlessBestByMode: {
      easy: readNumber(storage, modeKey("endlessBest", "easy")),
      hard: readNumber(storage, modeKey("endlessBest", "hard"))
    },
    winsByMode: {
      easy: readNumber(storage, modeKey("wins", "easy")),
      hard: readNumber(storage, modeKey("wins", "hard"))
    },
    fastestClearByMode: {
      easy: readOptionalNumber(storage, modeKey("fastest", "easy")),
      hard: readOptionalNumber(storage, modeKey("fastest", "hard"))
    },
    endlessUnlockedByMode: {
      easy: readBoolean(storage, modeKey("endlessUnlocked", "easy")),
      hard: readBoolean(storage, modeKey("endlessUnlocked", "hard"))
    }
  };
}
function write(storage, key, value) {
  try {
    storage.setItem(key, String(value));
  } catch {
    // Gameplay must continue when storage is unavailable or read-only.
  }
}
function clearProgress(storage) {
  PROGRESS_STORAGE_KEYS.forEach((key) => {
    try {
      storage.removeItem(key);
    } catch {
      // Gameplay must continue when storage is unavailable or read-only.
    }
  });
}
function changed(current, previous, field, mode) {
  return current[field]?.[mode] !== previous?.[field]?.[mode];
}
function saveMode({ storage, state, previous, mode }) {
  if (changed(state, previous, "campaignBestByMode", mode)) {
    const score = state.campaignBestByMode[mode];
    write(storage, modeKey("campaignBest", mode), score);
    write(storage, mode === "hard" ? STORAGE_KEYS.bestHard : STORAGE_KEYS.bestEasy, score);
  }
  if (changed(state, previous, "endlessBestByMode", mode)) write(storage, modeKey("endlessBest", mode), state.endlessBestByMode[mode]);
  if (changed(state, previous, "winsByMode", mode)) write(storage, modeKey("wins", mode), state.winsByMode[mode]);
  if (changed(state, previous, "fastestClearByMode", mode)) write(storage, modeKey("fastest", mode), state.fastestClearByMode[mode] ?? "");
  if (changed(state, previous, "endlessUnlockedByMode", mode)) write(storage, modeKey("endlessUnlocked", mode), state.endlessUnlockedByMode[mode]);
}
function saveProgress({ storage, state, previous }) {
  ["easy", "hard"].forEach((mode) => saveMode({ storage, state, previous, mode }));
}
export { campaignBest, changed, clearProgress, loadProgress, modeKey, readBoolean, readNumber, readOptionalNumber, readValue, saveMode, saveProgress, write };
