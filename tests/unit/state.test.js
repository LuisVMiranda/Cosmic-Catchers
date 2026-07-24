import { describe, expect, it } from "vitest";
import { GAME } from "../../src/js/config.js";
import { getCampaignTarget, getFinaleStart } from "../../src/js/campaign.js";
import { createInitialState, transitionState } from "../../src/js/state.js";

function dispatch(state, type, values = {}) {
  return transitionState({ state, command: { type, ...values } });
}

describe("game state transitions", () => {
  it("moves from ready through entry into a deterministic run", () => {
    const ready = createInitialState({ mode: "easy", language: "en" });
    const entering = dispatch(ready, "BEGIN_RUN_TRANSITION", { seed: 42, runType: "campaign" });
    expect(entering.status).toBe("entering");
    expect(dispatch(entering, "ADVANCE_RUN_TRANSITION", { deltaSeconds: 1 }).status).toBe("entering");
    const playing = dispatch(entering, "ADVANCE_RUN_TRANSITION", { deltaSeconds: GAME.entryTransitionDuration });
    expect(playing).toMatchObject({ status: "playing", seed: 42, score: 0, phase: 1 });
  });

  it("handles flips, successful collections, duplicates, and wrong-side failures", () => {
    let state = dispatch(createInitialState(), "START_RUN", { seed: 1, mode: "easy", runType: "campaign" });
    state = { ...state, activeBatchIds: [1] };
    const success = dispatch(state, "COLLECT_DISK", { batchId: 1, sourceLane: 0, lane: 0, color: "green", expectedSide: 0 });
    expect(success).toMatchObject({ score: 1, streak: 1, longestStreak: 1 });
    expect(dispatch(success, "COLLECT_DISK", { batchId: 1, sourceLane: 0, lane: 0, color: "green", expectedSide: 0 })).toBe(success);
    const failed = dispatch(state, "COLLECT_DISK", { batchId: 1, sourceLane: 1, lane: 1, color: "red", expectedSide: 1 });
    expect(failed).toMatchObject({ status: "gameover", gameOverReason: "wrong-side" });
  });

  it("rejects stale collections and fails a catcher that is still flipping", () => {
    const playing = dispatch(createInitialState(), "START_RUN", { seed: 2 });
    expect(dispatch(playing, "COLLECT_DISK", { batchId: 99, lane: 0, expectedSide: 0 })).toBe(playing);
    const flipping = dispatch({ ...playing, activeBatchIds: [2] }, "FLIP_CATCHER", { lane: 0 });
    const failed = dispatch(flipping, "COLLECT_DISK", { batchId: 2, sourceLane: 0, lane: 0, color: "green", expectedSide: 0 });
    expect(failed.gameOverReason).toBe("catcher-flipping");
  });

  it("pauses only active play and resumes only a paused run", () => {
    const ready = createInitialState();
    expect(dispatch(ready, "PAUSE")).toBe(ready);
    const playing = dispatch(ready, "START_RUN", { seed: 1 });
    const paused = dispatch(playing, "PAUSE");
    expect(paused.status).toBe("paused");
    expect(dispatch(paused, "RESUME").status).toBe("playing");
  });

  it("enters extraction at the finale boundary and completes a campaign", () => {
    const base = dispatch(createInitialState({ mode: "easy" }), "START_RUN", { seed: 1 });
    const finaleStart = getFinaleStart({ mode: "easy" });
    const beforeFinale = { ...base, completedBatches: finaleStart - 1, activeBatchIds: [finaleStart] };
    const extracting = dispatch(beforeFinale, "COMPLETE_BATCH", { batchId: finaleStart });
    expect(extracting.status).toBe("extraction");
    expect(dispatch(extracting, "ADVANCE_EXTRACTION", { deltaSeconds: GAME.extractionIntroDuration }).status).toBe("playing");

    const target = getCampaignTarget({ mode: "easy" });
    const complete = { ...base, completedBatches: target, activeBatchIds: [], score: target, runElapsedSeconds: 30 };
    const victory = dispatch(complete, "COMPLETE_RUN");
    expect(victory.status).toBe("victory");
    expect(victory.endlessUnlockedByMode.easy).toBe(true);
  });

  it("allows Endless only after the selected mode is unlocked", () => {
    const locked = createInitialState({ mode: "hard" });
    expect(dispatch(locked, "SELECT_RUN_TYPE", { runType: "endless" }).runType).toBe("campaign");
    const unlocked = { ...locked, endlessUnlockedByMode: { easy: false, hard: true } };
    expect(dispatch(unlocked, "SELECT_RUN_TYPE", { runType: "endless" }).runType).toBe("endless");
  });
});

