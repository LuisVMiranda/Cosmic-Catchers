import { describe, expect, it, vi } from "vitest";
import { getCampaignTarget } from "../../src/js/campaign.js";
import { GAME, SIDE_Y } from "../../src/js/config.js";
import {
  advanceDisk,
  clearCaptured,
  createBrowserScheduler,
  createDiskObjects,
  createGameLoop,
  createPendingPlan,
  deliveryConflicts,
  diskDelivery,
  getBatchQueueCounts,
  getCatchEffectPosition,
  hasBatchQueueCapacity,
  isSafeDeliverySchedule,
  lanePairIsSafe,
  mysteryDelay,
  nextPlan,
  planCanSpawn,
  planDeliveries,
  planSpacingIsSafe,
  removeReached,
  spacingState,
  spawnIfReady,
  spawnIsBlocked,
  teleportDelay,
  teleportLaneIsSafe,
  updateDisks,
  updateFlips,
  updateMysteryWait,
  updateTeleportWait
} from "../../src/js/game-loop.js";
import { createInitialState, createStateStore, resetRun } from "../../src/js/state.js";

function state(values = {}) {
  return { ...resetRun(createInitialState(values), values.mode, 7, values.runType), cooldown: 0, ...values };
}

function group(y = GAME.spawnY) {
  return { position: { x: 0, y }, visible: true };
}

function disk(values = {}) {
  return {
    age: 0,
    batchId: 1,
    captureTimer: 0,
    captured: false,
    color: "green",
    effectiveSpeedScale: 1,
    expectedSide: 0,
    group: group(),
    lane: 0,
    overlapSpeedReduction: 0,
    sourceLane: 0,
    targetY: SIDE_Y[0],
    teleport: null,
    ...values
  };
}

function adapters() {
  return {
    audio: { playCollect: vi.fn() },
    effects: { addFloatText: vi.fn(), burst: vi.fn(), update: vi.fn() },
    renderer: {
      createDisk: vi.fn(() => group()),
      moveDiskToLane: vi.fn(),
      removeDisk: vi.fn(),
      render: vi.fn(),
      update: vi.fn()
    },
    ui: { render: vi.fn() }
  };
}

describe("plan, spacing, queue, and delivery gates", () => {
  it("creates valid normal, overlap, and forced-recovery plans", () => {
    const base = state({ mode: "hard", phase: 24, round: 1, consecutiveHalfSpeedBatches: 2 });
    expect(nextPlan(base).recoveryBatch).toBe(true);
    const overlap = createPendingPlan({ state: base, activeBatchCount: 1, queueCounts: { normal: 0, slow: 2 } });
    expect(overlap.overlapSpeedReduction).toBeGreaterThan(0);
    expect(overlap.recoveryBatch).toBe(true);
    expect(createPendingPlan({ state: { ...base, consecutiveHalfSpeedBatches: 0 }, activeBatchCount: 0, queueCounts: { normal: 0, slow: 0 } }).overlapSpeedReduction).toBe(0);
  });

  it("creates disk objects with and without teleport metadata", () => {
    const renderer = adapters().renderer;
    const plan = nextPlan(state({ mode: "hard", phase: 10, round: 1, seed: 4 }));
    const disks = createDiskObjects({ plan, renderer });
    expect(disks).toHaveLength(3);
    expect(new Set(disks.map((object) => object.targetY))).toEqual(new Set([SIDE_Y[0]]));
    expect(disks.some((object) => object.teleport?.state === "traveling")).toBe(true);
    expect(renderer.createDisk).toHaveBeenCalledTimes(3);
    const normal = createDiskObjects({ plan: nextPlan(state()), renderer });
    expect(normal.every((object) => object.teleport === null)).toBe(true);
  });

  it("maps spacing and chooses ordering safely", () => {
    const waiting = disk({ group: group(-10), teleport: { state: "waiting", remaining: 2, targetLane: 1 } });
    expect(spacingState(waiting).teleportWait).toBe(2);
    const morphing = disk({ mystery: { state: "morphing", remaining: 0.2, morphDuration: 0.34, elapsed: 0.14 } });
    expect(spacingState(morphing).teleportWait).toBe(0.2);
    expect(spacingState(disk()).teleportWait).toBe(0);
    expect(lanePairIsSafe({ first: waiting, second: disk({ group: group(8) }) })).toBe(true);
    expect(lanePairIsSafe({ first: disk({ group: group(8) }), second: waiting })).toBe(true);
    const plan = nextPlan(state());
    expect(planSpacingIsSafe({ plan, disks: [] })).toBe(true);
    expect(planSpacingIsSafe({ plan, disks: [disk({ group: group(8.4) })] })).toBe(false);
    expect(planSpacingIsSafe({ plan, disks: [disk({ captured: true, group: group(8.4) })] })).toBe(true);
  });

  it("calculates deliveries, teleport delays, and color-switch conflicts", () => {
    expect(teleportDelay(null)).toBe(0);
    expect(teleportDelay({ state: "complete" })).toBe(0);
    expect(teleportDelay({ state: "waiting", remaining: 0.4 })).toBe(0.4);
    expect(teleportDelay({ state: "traveling" })).toBe(GAME.teleportStopDuration);
    expect(mysteryDelay(null)).toBe(0);
    expect(mysteryDelay({ state: "revealed" })).toBe(0);
    expect(mysteryDelay({ state: "traveling", morphDuration: 0.34 })).toBe(0.34);
    expect(mysteryDelay({ state: "morphing", remaining: 0.2, morphDuration: 0.34, elapsed: 0.14 })).toBe(0.2);
    const object = disk({ teleport: { state: "traveling", targetLane: 1 } });
    expect(diskDelivery(object)).toMatchObject({ lane: 1, color: "green" });
    object.teleport.state = "complete";
    expect(diskDelivery(object).lane).toBe(0);
    const plan = nextPlan(state({ mode: "hard", phase: 10, round: 1 }));
    expect(planDeliveries(plan)).toHaveLength(3);
    const mysteryPlan = {
      colors: ["green"],
      targetSides: [0],
      effectiveSpeedScales: [1],
      specialDisk: { type: "mystery", lane: 0, morphDuration: 0.34 }
    };
    expect(planDeliveries(mysteryPlan)[0].time).toBeCloseTo((GAME.spawnY - SIDE_Y[0]) / GAME.baseSpeed + 0.34);
    expect(deliveryConflicts({ delivery: { lane: 0, color: "red", time: 1 }, others: [{ lane: 0, color: "green", time: 1.1 }], minimum: 0.2 })).toBe(true);
    expect(deliveryConflicts({ delivery: { lane: 0, color: "red", time: 1 }, others: [{ lane: 1, color: "green", time: 1.1 }], minimum: 0.2 })).toBe(false);
    expect(isSafeDeliverySchedule({ plan, disks: [], mode: "hard" })).toBe(true);
  });

  it("counts and enforces normal and slow queues", () => {
    const queued = { activeBatchIds: [1, 2, 3], slowQueueBatchIds: [2] };
    expect(getBatchQueueCounts(queued)).toEqual({ normal: 2, slow: 1 });
    expect(getBatchQueueCounts({})).toEqual({ normal: 0, slow: 0 });
    expect(hasBatchQueueCapacity({ state: queued, plan: { hasHalfSpeed: true }, maxNormal: 2 })).toBe(true);
    expect(hasBatchQueueCapacity({ state: { activeBatchIds: [1, 2], slowQueueBatchIds: [1, 2] }, plan: { hasHalfSpeed: true }, maxNormal: 2 })).toBe(false);
    expect(hasBatchQueueCapacity({ state: queued, plan: { hasHalfSpeed: false }, maxNormal: 2 })).toBe(false);
    expect(spawnIsBlocked({ state: { cooldown: 1, status: "playing" }, queueCounts: { normal: 0, slow: 0 }, maxNormal: 2 })).toBe(true);
    expect(spawnIsBlocked({ state: { cooldown: 0, status: "paused" }, queueCounts: { normal: 0, slow: 0 }, maxNormal: 2 })).toBe(true);
    expect(spawnIsBlocked({ state: { cooldown: 0, status: "playing" }, queueCounts: { normal: 2, slow: 2 }, maxNormal: 2 })).toBe(true);
    expect(spawnIsBlocked({ state: { cooldown: 0, status: "playing" }, queueCounts: { normal: 0, slow: 0 }, maxNormal: 2 })).toBe(false);
  });

  it("checks capacity before spacing and delivery", () => {
    const current = state();
    const plan = nextPlan(current);
    expect(planCanSpawn({ state: current, plan, disks: [], maxNormal: 1 })).toBe(true);
    expect(planCanSpawn({ state: { ...current, activeBatchIds: [1] }, plan, disks: [], maxNormal: 1 })).toBe(false);
    expect(planCanSpawn({ state: current, plan, disks: [disk({ group: group(8.4) })], maxNormal: 1 })).toBe(false);
  });
});

describe("teleport and disk lifecycle", () => {
  it("updates only flipping catchers", () => {
    const store = { dispatch: vi.fn() };
    const current = state();
    current.catchers[1] = { ...current.catchers[1], flipping: true };
    updateFlips({ state: current, store, delta: 0.1 });
    expect(store.dispatch).toHaveBeenCalledOnce();
    expect(store.dispatch).toHaveBeenCalledWith({ type: "ADVANCE_FLIP", lane: 1, delta: 0.1 });
  });

  it("tests teleport target-lane safety and waiting branches", () => {
    const moving = disk({ group: group(-10), teleport: { state: "waiting", targetLane: 1, remaining: 1, elapsed: 0 } });
    expect(teleportLaneIsSafe({ object: moving, disks: [moving] })).toBe(true);
    const blocker = disk({ lane: 1, group: group(-9) });
    expect(teleportLaneIsSafe({ object: moving, disks: [moving, blocker] })).toBe(false);
    blocker.captured = true;
    expect(teleportLaneIsSafe({ object: moving, disks: [moving, blocker] })).toBe(true);
    const renderer = adapters().renderer;
    expect(updateTeleportWait({ object: moving, disks: [moving], delta: 0.5, renderer })).toBe(true);
    expect(moving.teleport.remaining).toBe(0.5);
    updateTeleportWait({ object: moving, disks: [moving], delta: 0.5, renderer });
    expect(moving.teleport.state).toBe("complete");
    expect(renderer.moveDiskToLane).toHaveBeenCalledWith(moving.group, 1);
  });

  it("advances travel, teleport trigger, wait, target arrival, and normal motion", () => {
    const renderer = adapters().renderer;
    const normal = disk();
    expect(advanceDisk({ object: normal, disks: [normal], delta: 0.1, renderer })).toBe(false);
    expect(normal.group.position.y).toBeLessThan(GAME.spawnY);
    const arriving = disk({ age: 4, group: group(-1.7) });
    expect(advanceDisk({ object: arriving, disks: [arriving], delta: 1, renderer })).toBe(false);
    expect(arriving.group.position.y).toBe(arriving.targetY);
    const traveling = disk({ teleport: { state: "traveling", triggerY: 8, targetLane: 1, remaining: 0, elapsed: 0 } });
    expect(advanceDisk({ object: traveling, disks: [traveling], delta: 1, renderer })).toBe(true);
    expect(traveling.teleport).toMatchObject({ state: "waiting", remaining: GAME.teleportStopDuration, elapsed: 0 });
    expect(advanceDisk({ object: traveling, disks: [traveling], delta: 0.1, renderer })).toBe(true);
  });

  it("clamps mystery disks at halfway, pauses through flicker, then resumes revealed", () => {
    const renderer = adapters().renderer;
    renderer.revealMysteryDisk = vi.fn();
    const mystery = disk({
      mystery: { state: "traveling", triggerY: 2.7, elapsed: 0, morphDuration: GAME.mysteryMorphDuration, flickerRate: GAME.mysteryFlickerRate }
    });
    expect(advanceDisk({ object: mystery, disks: [mystery], delta: 10, renderer })).toBe(true);
    expect(mystery.mystery.state).toBe("morphing");
    expect(mystery.group.position.y).toBe(mystery.mystery.triggerY);
    const triggerAge = (GAME.spawnY - mystery.mystery.triggerY) / GAME.baseSpeed;
    expect(mystery.age).toBeCloseTo(triggerAge);
    expect(advanceDisk({ object: mystery, disks: [mystery], delta: GAME.mysteryMorphDuration / 2, renderer })).toBe(true);
    expect(mystery.group.position.y).toBe(mystery.mystery.triggerY);
    expect(mystery.mystery.state).toBe("morphing");
    expect(advanceDisk({ object: mystery, disks: [mystery], delta: GAME.mysteryMorphDuration / 2, renderer })).toBe(true);
    expect(mystery.mystery.state).toBe("revealed");
    expect(renderer.revealMysteryDisk).toHaveBeenCalledWith(mystery.group);
    expect(mystery.group.position.y).toBe(mystery.mystery.triggerY);
    expect(advanceDisk({ object: mystery, disks: [mystery], delta: 0.1, renderer })).toBe(false);
    expect(mystery.group.position.y).toBeLessThan(mystery.mystery.triggerY);
    expect(updateMysteryWait({ object: mystery, delta: 1, renderer })).toBe(false);
  });

  it("keeps the mystery disk's final color and catcher side in the collection contract", () => {
    const renderer = adapters().renderer;
    const plan = {
      batchId: 4,
      colors: ["green", "red"],
      targetSides: [0, 1],
      effectiveSpeedScales: [1, 1],
      speedMultipliers: [1, 1],
      overlapSpeedReduction: 0,
      specialDisk: { type: "mystery", lane: 1, morphDuration: GAME.mysteryMorphDuration, flickerRate: GAME.mysteryFlickerRate }
    };
    const disks = createDiskObjects({ plan, renderer });
    expect(disks[0].mystery).toBeNull();
    expect(disks[1]).toMatchObject({ color: "red", expectedSide: 1, lane: 1 });
    expect(disks[1].mystery).toMatchObject({ state: "traveling", triggerY: expect.any(Number) });
    expect(renderer.createDisk).toHaveBeenLastCalledWith(expect.objectContaining({ color: "red", lane: 1, special: true, mystery: true }));
  });

  it("applies success and failure effects to reached disks", () => {
    const successStore = createStateStore({ ...state(), activeBatchIds: [1] });
    const successAdapters = adapters();
    const success = disk();
    removeReached({ reached: [success], store: successStore, effects: successAdapters.effects, audio: successAdapters.audio });
    expect(success).toMatchObject({ captured: true, captureTimer: GAME.captureDuration });
    expect(successAdapters.effects.addFloatText).toHaveBeenCalledOnce();
    expect(successAdapters.audio.playCollect).toHaveBeenCalledOnce();
    expect(getCatchEffectPosition(success).y).toBe(success.targetY + GAME.catchPopupOffset);

    const failureStore = createStateStore({ ...state(), activeBatchIds: [1] });
    const failureAdapters = adapters();
    const failure = disk({ color: "red", expectedSide: 1 });
    removeReached({ reached: [failure], store: failureStore, effects: failureAdapters.effects, audio: failureAdapters.audio });
    expect(failureStore.getState().status).toBe("gameover");
    expect(failureAdapters.effects.burst).toHaveBeenCalledWith(expect.anything(), 16733567, 22);
  });

  it("expires captured disks, completes batches, and dispatches campaign victory", () => {
    const target = getCampaignTarget({ mode: "easy" });
    const store = createStateStore({ ...state(), completedBatches: target - 1, activeBatchIds: [1] });
    const renderer = adapters().renderer;
    const expired = disk({ captured: true, captureTimer: 0.01 });
    const disks = [expired];
    clearCaptured({ disks, renderer, store, delta: 0.02 });
    expect(disks).toEqual([]);
    expect(renderer.removeDisk).toHaveBeenCalledWith(expired.group);
    expect(store.getState().status).toBe("victory");
    const untouched = [disk({ captured: true, captureTimer: 1 })];
    clearCaptured({ disks: untouched, renderer, store, delta: 0.1 });
    expect(untouched).toHaveLength(1);
  });

  it("cleans disks by status and collects reached arrivals", () => {
    const render = adapters();
    for (const status of ["ready", "gameover", "victory"]) {
      const store = createStateStore({ ...state(), status });
      const disks = [disk()];
      updateDisks({ disks, delta: 0.1, renderer: render.renderer, store, effects: render.effects, audio: render.audio });
      expect(disks).toEqual([]);
    }
    const extractionStore = createStateStore({ ...state(), status: "extraction" });
    const extracting = [disk()];
    updateDisks({ disks: extracting, delta: 0.1, renderer: render.renderer, store: extractionStore, effects: render.effects, audio: render.audio });
    expect(extracting).toHaveLength(1);
    const playingStore = createStateStore({ ...state(), activeBatchIds: [1] });
    const arrived = [disk({ age: 4, group: group(-1.7) }), disk({ captured: true })];
    updateDisks({ disks: arrived, delta: 1, renderer: render.renderer, store: playingStore, effects: render.effects, audio: render.audio });
    expect(arrived[0].captured).toBe(true);
    const failureStore = createStateStore({ ...state(), activeBatchIds: [1] });
    const failing = [disk({ age: 4, color: "red", expectedSide: 1, group: group(-1.7) })];
    updateDisks({ disks: failing, delta: 1, renderer: render.renderer, store: failureStore, effects: render.effects, audio: render.audio });
    expect(failureStore.getState().status).toBe("gameover");
    expect(failing).toEqual([]);
  });
});

describe("spawning and complete loop order", () => {
  it("blocks cooldown, full campaign, and unsafe plans, then spawns valid disks", () => {
    const render = adapters().renderer;
    const cooldownStore = createStateStore({ ...state(), cooldown: 1 });
    spawnIfReady({ state: cooldownStore.getState(), disks: [], renderer: render, store: cooldownStore });
    expect(render.createDisk).not.toHaveBeenCalled();
    const target = getCampaignTarget({ mode: "easy" });
    const completeStore = createStateStore({ ...state(), completedBatches: target });
    spawnIfReady({ state: completeStore.getState(), disks: [], renderer: render, store: completeStore });
    expect(render.createDisk).not.toHaveBeenCalled();
    const validStore = createStateStore(state());
    const disks = [];
    spawnIfReady({ state: validStore.getState(), disks, renderer: render, store: validStore });
    expect(disks).toHaveLength(2);
    expect(validStore.getState().activeBatchIds).toEqual([1]);
    expect(validStore.getState().cooldown).toBeGreaterThan(0);
    const overlapStore = createStateStore(state({ phase: 20 }));
    spawnIfReady({ state: overlapStore.getState(), disks: [], renderer: render, store: overlapStore });
    expect(overlapStore.getState().cooldown).toBeGreaterThanOrEqual(GAME.minSpawnDelay);
  });

  it("adapts browser scheduling primitives", () => {
    const requestAnimationFrame = vi.fn(() => 4);
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("performance", { now: () => 12 });
    vi.stubGlobal("window", { requestAnimationFrame, cancelAnimationFrame });
    const scheduler = createBrowserScheduler();
    expect(scheduler.now()).toBe(12);
    const callback = () => {};
    expect(scheduler.requestFrame(callback)).toBe(4);
    scheduler.cancelFrame(4);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(4);
    vi.unstubAllGlobals();
  });

  it("preserves per-frame operation order and stop cleanup", () => {
    const order = [];
    const current = state({ cooldown: 1 });
    current.catchers[0] = { ...current.catchers[0], flipping: true };
    const store = {
      getState: () => current,
      dispatch(command) {
        order.push(command.type);
        if (command.type === "SET_COOLDOWN") current.cooldown = command.cooldown;
        return current;
      }
    };
    const renderer = {
      removeDisk: vi.fn(),
      update: () => order.push("renderer.update"),
      render: () => order.push("renderer.render")
    };
    const effects = { update: () => order.push("effects.update") };
    const ui = { render: () => order.push("ui.render") };
    const scheduled = [];
    const scheduler = { now: () => 0, requestFrame: (callback) => { scheduled.push(callback); return scheduled.length; }, cancelFrame: vi.fn() };
    const loop = createGameLoop({ store, renderer, effects, audio: { playCollect() {} }, ui, scheduler });
    loop.step(0.01);
    expect(order).toEqual(["ADVANCE_RUN_TIME", "ADVANCE_FLIP", "SET_COOLDOWN", "renderer.update", "effects.update", "ui.render"]);
    loop.getDisks().push(disk());
    loop.start();
    scheduled[0](1000);
    expect(order).toContain("renderer.render");
    loop.stop();
    scheduled[1](2000);
    expect(renderer.removeDisk).toHaveBeenCalledOnce();
  });
});
