import { describe, expect, it } from "vitest";
import { TRANSLATIONS, localizeDocument, translate } from "../../src/js/localization.js";
import {
  campaignBest,
  changed,
  loadProgress,
  modeKey,
  readBoolean,
  readNumber,
  readOptionalNumber,
  readValue,
  saveProgress,
  write
} from "../../src/js/persistence.js";
import { STORAGE_KEYS } from "../../src/js/config.js";

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  };
}

describe("localization", () => {
  it("keeps English and Portuguese key and placeholder parity", () => {
    const englishKeys = Object.keys(TRANSLATIONS.en).sort();
    expect(Object.keys(TRANSLATIONS["pt-BR"]).sort()).toEqual(englishKeys);
    for (const key of englishKeys) {
      const placeholders = (text) => [...text.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
      expect(placeholders(TRANSLATIONS["pt-BR"][key])).toEqual(placeholders(TRANSLATIONS.en[key]));
    }
  });

  it("falls back and replaces every placeholder occurrence", () => {
    expect(translate("unknown", "easy")).toBe("EASY");
    expect(translate("en", "missing-key")).toBe("missing-key");
    expect(translate("en", "mismatch", { color: "GREEN", side: "top" })).toContain("GREEN");
    expect(translate("pt-BR", "extractionRemaining", { count: 4 })).toBe("Restam 4 lotes");
  });

  it("localizes document metadata and data attributes", () => {
    const elements = [{ dataset: { i18n: "scoreLabel" }, textContent: "" }];
    const root = {
      documentElement: { lang: "" },
      title: "",
      querySelectorAll: () => elements
    };
    localizeDocument("pt-BR", root);
    expect(root.documentElement.lang).toBe("pt-BR");
    expect(root.title).toBe("Cosmic Catchers");
    expect(elements[0].textContent).toBe("Pontuação");
  });
});

describe("persistence compatibility", () => {
  it("reads valid, empty, malformed, legacy, and unavailable values", () => {
    const storage = memoryStorage({
      number: "12",
      negative: "-1",
      malformed: "nope",
      bool: "true",
      [STORAGE_KEYS.bestEasy]: "7"
    });
    expect(readValue(storage, "missing")).toBeNull();
    expect(readNumber(storage, "number")).toBe(12);
    expect(readNumber(storage, "negative", 3)).toBe(3);
    expect(readNumber(storage, "malformed", 4)).toBe(4);
    expect(readNumber(storage, "missing", 5)).toBe(5);
    expect(readOptionalNumber(storage, "number")).toBe(12);
    expect(readOptionalNumber(storage, "missing")).toBeNull();
    expect(readOptionalNumber(storage, "malformed")).toBeNull();
    expect(readBoolean(storage, "bool")).toBe(true);
    expect(campaignBest(storage, "easy")).toBe(7);
    expect(readValue({ getItem: () => { throw new Error("blocked"); } }, "x")).toBeNull();
  });

  it("loads every mode map with campaign legacy fallback", () => {
    const storage = memoryStorage({
      [STORAGE_KEYS.bestEasy]: "3",
      [STORAGE_KEYS.campaignBestHard]: "9",
      [STORAGE_KEYS.endlessBestEasy]: "4",
      [STORAGE_KEYS.winsHard]: "2",
      [STORAGE_KEYS.fastestEasy]: "12.5",
      [STORAGE_KEYS.endlessUnlockedHard]: "true"
    });
    expect(loadProgress(storage)).toEqual({
      campaignBestByMode: { easy: 3, hard: 9 },
      endlessBestByMode: { easy: 4, hard: 0 },
      winsByMode: { easy: 0, hard: 2 },
      fastestClearByMode: { easy: 12.5, hard: null },
      endlessUnlockedByMode: { easy: false, hard: true }
    });
    expect(modeKey("wins", "hard")).toBe(STORAGE_KEYS.winsHard);
    expect(modeKey("wins", "easy")).toBe(STORAGE_KEYS.winsEasy);
  });

  it("writes only changed fields and remains safe when storage rejects writes", () => {
    const previous = loadProgress(memoryStorage());
    const state = structuredClone(previous);
    state.campaignBestByMode.easy = 10;
    state.endlessBestByMode.hard = 8;
    state.winsByMode.easy = 1;
    state.fastestClearByMode.hard = 22;
    state.endlessUnlockedByMode.easy = true;
    const storage = memoryStorage();
    saveProgress({ storage, state, previous });
    expect(storage.values.get(STORAGE_KEYS.campaignBestEasy)).toBe("10");
    expect(storage.values.get(STORAGE_KEYS.bestEasy)).toBe("10");
    expect(storage.values.get(STORAGE_KEYS.endlessBestHard)).toBe("8");
    expect(storage.values.get(STORAGE_KEYS.winsEasy)).toBe("1");
    expect(storage.values.get(STORAGE_KEYS.fastestHard)).toBe("22");
    expect(storage.values.get(STORAGE_KEYS.endlessUnlockedEasy)).toBe("true");
    expect(changed(state, previous, "winsByMode", "hard")).toBe(false);
    expect(() => write({ setItem: () => { throw new Error("readonly"); } }, "x", 1)).not.toThrow();
  });
});
