import { describe, expect, it, vi } from "vitest";
import { getCampaignTarget } from "../../src/js/campaign.js";
import { GAME, MODE_CONFIG } from "../../src/js/config.js";
import {
  COMMAND_HANDLERS,
  activeBestMap,
  advanceExtraction,
  advanceFlip,
  advanceRunTime,
  advanceRunTransition,
  appendUnique,
  beginRunTransition,
  cloneCatchers,
  collectDisk,
  collectionKey,
  completeBatch,
  completeRun,
  createCatcher,
  createCatchers,
  createInitialState,
  createStateStore,
  failRun,
  finishFlip,
  finishRun,
  flipCatcher,
  getCatcherFailureReason,
  isDuplicateCollection,
  isStaleCollection,
  modeMap,
  pauseRun,
  phaseFor,
  resetRun,
  resumeRun,
  returnToMenu,
  selectMode,
  selectRunType,
  setCooldown,
  setLanguage,
  spawnBatch,
  transitionState,
  updateBest,
  updateRecentColorPatterns,
  updateSlowQueue,
  updateSlowSequence,
  validRunType
} from "../../src/js/state.js";

function playing(values = {}) {
  return { ...resetRun(createInitialState(values), values.mode, 7, values.runType), ...values };
}

describe("state helper contracts", () => {
  it("creates and clones independent catchers and mode maps", () => {
    expect(createCatcher(2)).toMatchObject({ index: 2, activeSide: 0, flipping: false });
    const catchers = createCatchers();
    const clones = cloneCatchers(catchers);
    clones[0].activeSide = 1;
    expect(catchers[0].activeSide).toBe(0);
    expect(modeMap({ easy: 3 }, { hard: null })).toEqual({ easy: 3, hard: null });
  });

  it("selects and updates campaign and endless records", () => {
    const campaign = createInitialState({ campaignBestByMode: { easy: 2 }, endlessBestByMode: { easy: 8 } });
    expect(activeBestMap(campaign).easy).toBe(2);
    expect(activeBestMap(campaign, "endless").easy).toBe(8);
    expect(updateBest(campaign, 5)).toMatchObject({ best: 5, bestByMode: { easy: 5, hard: 0 } });
    const endless = { ...campaign, runType: "endless" };
    expect(updateBest(endless, 10)).toMatchObject({ best: 10, endlessBestByMode: { easy: 10, hard: 0 } });
  });

  it("caps campaign phases but lets Endless continue", () => {
    const campaign = playing({ mode: "easy", runType: "campaign" });
    const endless = playing({ mode: "easy", runType: "endless", endlessUnlockedByMode: { easy: true, hard: false } });
    expect(phaseFor(campaign, 999).phase).toBe(MODE_CONFIG.easy.phaseCap);
    expect(phaseFor(endless, 999).phase).toBeGreaterThan(MODE_CONFIG.easy.phaseCap);
    expect(validRunType(campaign, "easy", "campaign")).toBe("campaign");
    expect(validRunType(campaign, "easy", "endless")).toBe("campaign");
    expect(validRunType(endless, "easy", "endless")).toBe("endless");
  });

  it("resets all transient fields and falls back to a timestamp seed", () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);
    const dirty = { ...createInitialState(), score: 99, activeBatchIds: [1], collectedDiskKeys: ["1:0"] };
    const state = resetRun(dirty, "bad", undefined, "campaign");
    expect(state).toMatchObject({ mode: "easy", score: 0, seed: 1234, status: "playing", activeBatchIds: [], collectedDiskKeys: [] });
    vi.restoreAllMocks();
  });

  it("finishes failures with defaults and record metadata", () => {
    const state = { ...playing(), score: 4, campaignBestByMode: { easy: 2, hard: 0 } };
    expect(finishRun(state)).toMatchObject({ status: "gameover", best: 4, newRecord: true, gameOverReason: "mismatch", gameOverVariables: {} });
    expect(failRun(state, { reason: "invalid-lane", variables: { lane: 9 } })).toMatchObject({ gameOverReason: "invalid-lane", newRecord: true });
  });
});

describe("catcher and collection outcomes", () => {
  it("guards flips and completes partial and full animations", () => {
    const ready = createInitialState();
    expect(flipCatcher(ready, 0)).toBe(ready);
    const state = playing();
    expect(flipCatcher(state, 9)).toBe(state);
    const first = flipCatcher(state, 0);
    expect(flipCatcher(first, 0)).toBe(first);
    const partial = advanceFlip(first, 0, GAME.flipDuration / 2);
    expect(partial.catchers[0]).toMatchObject({ flipping: true, flipProgress: 0.5 });
    const done = advanceFlip(partial, 0, GAME.flipDuration);
    expect(done.catchers[0]).toMatchObject({ flipping: false, activeSide: 1, flipProgress: 1 });
    expect(advanceFlip(done, 0, 1)).toBe(done);
    expect(finishFlip(done, 0)).toBe(done);
    const finished = finishFlip(first, 0);
    expect(finished.catchers[0]).toMatchObject({ activeSide: 1, flipping: false });
  });

  it("resets streak after repeatedly flipping one lane", () => {
    const state = { ...playing(), streak: 4 };
    const first = finishFlip(flipCatcher(state, 0), 0);
    const second = flipCatcher(first, 0);
    expect(second.streak).toBe(0);
  });

  it("identifies collection identity, duplication, staleness, and every failure", () => {
    const state = { ...playing(), activeBatchId: 2, activeBatchIds: [2], collectedDiskKeys: ["2:1"] };
    expect(collectionKey({ batchId: 2, sourceLane: 1, lane: 0 })).toBe("2:1");
    expect(collectionKey({ lane: 0 })).toBe("");
    expect(isDuplicateCollection({ state, key: "2:1" })).toBe(true);
    expect(isDuplicateCollection({ state, key: "" })).toBe(false);
    expect(isStaleCollection({ state, command: { lane: 0 } })).toBe(false);
    expect(isStaleCollection({ state: { ...state, activeBatchIds: undefined }, command: { batchId: 2 } })).toBe(false);
    expect(isStaleCollection({ state, command: { batchId: 3 } })).toBe(true);
    expect(getCatcherFailureReason(state, { lane: 9, expectedSide: 0 })).toBe("invalid-lane");
    expect(getCatcherFailureReason({ ...state, catchers: flipCatcher(state, 0).catchers }, { lane: 0, expectedSide: 0 })).toBe("catcher-flipping");
    expect(getCatcherFailureReason(state, { lane: 0, expectedSide: 1 })).toBe("wrong-side");
    expect(getCatcherFailureReason(state, { lane: 0, expectedSide: 0 })).toBe("");
  });

  it("guards non-playing collections and supports collection without a batch identity", () => {
    const ready = createInitialState();
    expect(collectDisk(ready, {})).toBe(ready);
    const state = playing();
    const collected = collectDisk(state, { lane: 0, color: "green", expectedSide: 0 });
    expect(collected).toMatchObject({ score: 1, collectedDiskKeys: [] });
  });
});

describe("progression, menus, and timing", () => {
  it("guards batch completion and removes normal and slow queue entries", () => {
    const ready = createInitialState();
    expect(completeBatch(ready, 1)).toBe(ready);
    const state = { ...playing(), activeBatchIds: [1, 2], slowQueueBatchIds: [1] };
    expect(completeBatch(state, 9)).toBe(state);
    const complete = completeBatch(state, 1);
    expect(complete).toMatchObject({ completedBatches: 1, activeBatchIds: [2], slowQueueBatchIds: [] });
  });

  it("selects mode/run type only outside active states and sets language", () => {
    const ready = createInitialState({ campaignBestByMode: { hard: 3 }, endlessBestByMode: { hard: 8 }, endlessUnlockedByMode: { hard: true } });
    expect(selectMode(ready, { mode: "hard" })).toMatchObject({ mode: "hard", best: 3 });
    const hard = selectMode(ready, { mode: "hard" });
    expect(selectRunType(hard, { runType: "endless" })).toMatchObject({ runType: "endless", best: 8 });
    const active = { ...hard, status: "entering" };
    expect(selectMode(active, { mode: "easy" })).toBe(active);
    expect(selectRunType(active, { runType: "campaign" })).toBe(active);
    expect(setLanguage(ready, { language: "pt-BR" }).language).toBe("pt-BR");
  });

  it("returns only completed runs to a clean menu", () => {
    const ready = createInitialState();
    expect(returnToMenu(ready)).toBe(ready);
    for (const status of ["gameover", "victory"]) {
      const menu = returnToMenu({ ...playing(), status, score: 9, activeBatchIds: [1] });
      expect(menu).toMatchObject({ status: "ready", score: 0, activeBatchIds: [] });
    }
  });

  it("guards and advances entry, play time, extraction, pause, and resume", () => {
    const ready = createInitialState();
    expect(beginRunTransition({ ...ready, status: "paused" }, {} ).status).toBe("paused");
    const entering = beginRunTransition(ready, { mode: "hard", runType: "campaign", seed: 5 });
    expect(advanceRunTransition(ready, { deltaSeconds: 1 })).toBe(ready);
    expect(advanceRunTransition(entering, { deltaSeconds: -1 }).entryRemaining).toBe(GAME.entryTransitionDuration);
    const noPending = { ...entering, entryRemaining: 0, pendingRun: null };
    expect(advanceRunTransition(noPending, { deltaSeconds: 0 }).status).toBe("playing");
    const state = playing();
    expect(advanceRunTime(state, { deltaSeconds: "bad" })).toBe(state);
    expect(advanceRunTime(state, { deltaSeconds: -1 })).toBe(state);
    expect(advanceRunTime(state, { deltaSeconds: 2 }).runElapsedSeconds).toBe(2);
    const extraction = { ...state, status: "extraction", extractionRemaining: 1, cooldown: 0 };
    expect(advanceExtraction(state, { deltaSeconds: 1 })).toBe(state);
    expect(advanceExtraction(extraction, { deltaSeconds: 0.5 }).extractionRemaining).toBe(0.5);
    expect(advanceExtraction(extraction, { deltaSeconds: 2 })).toMatchObject({ status: "playing", extractionRemaining: 0, cooldown: GAME.initialSpawnDelay });
    expect(pauseRun(ready)).toBe(ready);
    expect(resumeRun(ready)).toBe(ready);
  });

  it("completes campaigns with fastest-time and win accounting", () => {
    const target = getCampaignTarget({ mode: "easy" });
    const incomplete = playing();
    expect(completeRun(incomplete)).toBe(incomplete);
    const complete = {
      ...incomplete,
      completedBatches: target,
      activeBatchIds: [],
      score: target,
      runElapsedSeconds: 20,
      fastestClearByMode: { easy: 30, hard: null },
      winsByMode: { easy: 1, hard: 0 }
    };
    expect(completeRun(complete)).toMatchObject({ status: "victory", winsByMode: { easy: 2, hard: 0 }, fastestClearByMode: { easy: 20, hard: null } });
  });
});

describe("spawn bookkeeping and store", () => {
  it("updates immutable queue helpers", () => {
    expect(appendUnique([1], 1)).toEqual([1]);
    expect(appendUnique([1], 2)).toEqual([1, 2]);
    expect(updateSlowQueue({ items: [1], batchId: 2, enabled: false })).toEqual([1]);
    expect(updateSlowQueue({ items: [1], batchId: 2, enabled: true })).toEqual([1, 2]);
    expect(updateSlowSequence({}, true)).toBe(1);
    expect(updateSlowSequence({ consecutiveHalfSpeedBatches: 2 }, true)).toBe(3);
    expect(updateSlowSequence({}, false)).toBe(0);
    expect(updateRecentColorPatterns(undefined, "")).toEqual([]);
    expect(updateRecentColorPatterns(["a", "b"], "c")).toEqual(["b", "c"]);
  });

  it("guards and records spawned batches and cooldown", () => {
    const ready = createInitialState();
    expect(spawnBatch(ready, {})).toBe(ready);
    const target = getCampaignTarget({ mode: "easy" });
    const full = { ...playing(), completedBatches: target };
    expect(spawnBatch(full, { batchId: 1 })).toBe(full);
    const spawned = spawnBatch(playing(), {
      batchId: 1,
      colorSignature: "green-red",
      hasHalfSpeed: true,
      patternId: "SPLIT",
      round: 1,
      slowQueue: true
    });
    expect(spawned).toMatchObject({ activeBatchIds: [1], slowQueueBatchIds: [1], consecutiveHalfSpeedBatches: 1, pattern: "SPLIT", cooldown: 0 });
    expect(spawnBatch(spawned, { batchId: 1, round: 2 })).toMatchObject({ activeBatchIds: [1] });
    expect(setCooldown(spawned, { cooldown: -2 }).cooldown).toBe(0);
  });

  it("routes every command/status combination without throwing", () => {
    const commands = Object.keys(COMMAND_HANDLERS).map((type) => ({ type }));
    for (const status of ["ready", "entering", "playing", "paused", "extraction", "gameover", "victory"]) {
      const state = { ...createInitialState(), status };
      for (const command of commands) expect(() => transitionState({ state, command })).not.toThrow();
    }
    const state = createInitialState();
    expect(transitionState({ state, command: { type: "UNKNOWN" } })).toBe(state);
  });

  it("notifies state-store changes with the true previous state", () => {
    const onChange = vi.fn();
    const initial = createInitialState();
    const store = createStateStore(initial, onChange);
    expect(store.dispatch({ type: "UNKNOWN" })).toBe(initial);
    expect(onChange).not.toHaveBeenCalled();
    const language = store.dispatch({ type: "SET_LANGUAGE", language: "pt-BR" });
    expect(store.getState()).toBe(language);
    expect(onChange).toHaveBeenLastCalledWith(language, { type: "SET_LANGUAGE", language: "pt-BR" }, initial);
    const replacement = { ...language, status: "victory" };
    store.replace(replacement);
    expect(onChange).toHaveBeenLastCalledWith(replacement, { type: "REPLACE_STATE" }, language);
  });
});
