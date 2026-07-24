import { isCampaignComplete, isCampaignSpawnAllowed } from "./campaign.js";
import { GAME, getModeConfig } from "./config.js";
import { getMaxActiveBatches, getMysteryTriggerY, getOverlapSpawnDelay, getOverlapSpeedReduction, getSpawnDelay, getTargetY, getTeleportTriggerY, isSafeSpawnGap } from "./difficulty.js";
import { createBatchPlan, createNormalBatchPlan, validateBatchPlan } from "./patterns.js";
import { getLaneCount } from "./world.js";

function nextPlan(state, overlapSpeedReduction = 0, forceSlowRecovery = false) {
  const round = state.round + 1;
  const forceHalfSpeedRecovery = state.consecutiveHalfSpeedBatches >= 2 || forceSlowRecovery;
  const base = {
    mode: state.mode,
    phase: state.phase,
    round,
    seed: state.seed,
    laneCount: getLaneCount(state.mode),
    forceHalfSpeedRecovery,
    recentColorPatterns: state.recentColorPatterns || []
  };
  for (let attempt = 0; attempt < GAME.maxPlanRetries; attempt += 1) {
    const plan = createBatchPlan({ ...base, seed: state.seed + attempt, overlapSpeedReduction });
    if (validateBatchPlan({ plan, mode: state.mode, phase: state.phase }).valid) return plan;
  }
  return createNormalBatchPlan({ ...base, seed: state.seed, overlapSpeedReduction });
}
function createDiskObjects({ plan, renderer: renderer2 }) {
  return plan.colors.map((color, lane) => {
    const special = plan.specialDisk?.lane === lane ? plan.specialDisk : null;
    const teleport = special?.type === "teleport" ? {
      state: "traveling",
      targetLane: special.targetLane,
      triggerY: getTeleportTriggerY({ side: plan.targetSides[lane] }),
      remaining: 0,
      elapsed: 0
    } : null;
    const mystery = special?.type === "mystery" ? {
      state: "traveling",
      triggerY: getMysteryTriggerY({ side: plan.targetSides[lane] }),
      elapsed: 0,
      remaining: 0,
      morphDuration: special.morphDuration,
      flickerRate: special.flickerRate
    } : null;
    return {
      group: renderer2.createDisk({
        color,
        lane,
        effectiveSpeedScale: plan.effectiveSpeedScales[lane],
        speedMultiplier: plan.speedMultipliers[lane],
        overlapSpeedReduction: plan.overlapSpeedReduction,
        special: Boolean(teleport || mystery),
        mystery: Boolean(mystery)
      }),
      batchId: plan.batchId,
      lane,
      sourceLane: lane,
      color,
      expectedSide: plan.targetSides[lane],
      effectiveSpeedScale: plan.effectiveSpeedScales[lane],
      overlapSpeedReduction: plan.overlapSpeedReduction,
      age: 0,
      captured: false,
      captureTimer: 0,
      targetY: getTargetY(plan.targetSides[lane]),
      teleport,
      mystery
    };
  });
}
function spacingState(object) {
  const mysteryWait = object.mystery?.state === "morphing"
    ? object.mystery.remaining ?? Math.max(0, object.mystery.morphDuration - object.mystery.elapsed)
    : 0;
  return {
    y: object.group.position.y,
    targetY: object.targetY,
    effectiveSpeedScale: object.effectiveSpeedScale,
    teleportWait: Math.max(object.teleport?.state === "waiting" ? object.teleport.remaining : 0, mysteryWait)
  };
}
function lanePairIsSafe({ first, second }) {
  const firstState = spacingState(first);
  const secondState = spacingState(second);
  const [existing, candidate] = firstState.y <= secondState.y ? [firstState, secondState] : [secondState, firstState];
  return isSafeSpawnGap({ existing, candidate });
}
function planSpacingIsSafe({ plan, disks }) {
  return [...plan.colors.keys()].every((lane) => {
    const candidate = {
      y: GAME.spawnY,
      targetY: getTargetY(plan.targetSides[lane]),
      effectiveSpeedScale: plan.effectiveSpeedScales[lane]
    };
    return disks.filter((disk) => !disk.captured && disk.lane === lane).every((disk) => isSafeSpawnGap({ existing: spacingState(disk), candidate }));
  });
}
function teleportDelay(teleport) {
  if (!teleport || teleport.state === "complete") return 0;
  return teleport.state === "waiting" ? teleport.remaining : GAME.teleportStopDuration;
}
function mysteryDelay(mystery) {
  if (!mystery || mystery.state === "revealed") return 0;
  if (mystery.state === "morphing") return mystery.remaining ?? Math.max(0, mystery.morphDuration - mystery.elapsed);
  return mystery.morphDuration;
}
function diskDelivery(object) {
  const speed = GAME.baseSpeed * object.effectiveSpeedScale;
  const remainingDistance = Math.max(0, object.group.position.y - object.targetY);
  const lane = object.teleport && object.teleport.state !== "complete" ? object.teleport.targetLane : object.lane;
  return { lane, color: object.color, time: remainingDistance / speed + teleportDelay(object.teleport) + mysteryDelay(object.mystery) };
}
function planDeliveries(plan) {
  return plan.colors.map((color, sourceLane) => {
    const special = plan.specialDisk?.lane === sourceLane ? plan.specialDisk : null;
    const teleport = special?.type === "teleport" ? special : null;
    const distance = GAME.spawnY - getTargetY(plan.targetSides[sourceLane]);
    const speed = GAME.baseSpeed * plan.effectiveSpeedScales[sourceLane];
    return {
      lane: teleport ? teleport.targetLane : sourceLane,
      color,
      time: distance / speed + (teleport?.stopDuration || 0) + (special?.type === "mystery" ? special.morphDuration : 0)
    };
  });
}
function deliveryConflicts({ delivery, others, minimum }) {
  return others.some((other) => other.lane === delivery.lane && other.color !== delivery.color && Math.abs(other.time - delivery.time) < minimum);
}
function isSafeDeliverySchedule({ plan, disks, mode }) {
  const minimum = getModeConfig(mode).minColorSwitchWindow;
  const existing = disks.filter((disk) => !disk.captured).map(diskDelivery);
  const candidates = planDeliveries(plan);
  return candidates.every((delivery, index) => !deliveryConflicts({
    delivery,
    others: [...existing, ...candidates.slice(0, index)],
    minimum
  }));
}
function getBatchQueueCounts(state) {
  const active = state.activeBatchIds || [];
  const slow = new Set(state.slowQueueBatchIds || []);
  return {
    normal: active.filter((batchId) => !slow.has(batchId)).length,
    slow: active.filter((batchId) => slow.has(batchId)).length
  };
}
function hasBatchQueueCapacity({ state, plan, maxNormal }) {
  const counts = getBatchQueueCounts(state);
  return plan.hasHalfSpeed ? counts.slow < GAME.maxSlowQueueBatches : counts.normal < maxNormal;
}
function spawnIsBlocked({ state, queueCounts, maxNormal }) {
  const queuesFull = queueCounts.normal >= maxNormal && queueCounts.slow >= GAME.maxSlowQueueBatches;
  return state.cooldown > 0 || state.status !== "playing" || queuesFull;
}
function createPendingPlan({ state, activeBatchCount, queueCounts }) {
  const overlapSpeedReduction = activeBatchCount > 0 ? getOverlapSpeedReduction({ mode: state.mode, phase: state.phase, round: state.round + 1, seed: state.seed }) : 0;
  const forceSlowRecovery = queueCounts.slow >= GAME.maxSlowQueueBatches;
  return nextPlan(state, overlapSpeedReduction, forceSlowRecovery);
}
function planCanSpawn({ state, plan, disks, maxNormal }) {
  if (!hasBatchQueueCapacity({ state, plan, maxNormal })) return false;
  if (!planSpacingIsSafe({ plan, disks })) return false;
  return isSafeDeliverySchedule({ plan, disks, mode: state.mode });
}
function teleportLaneIsSafe({ object, disks }) {
  return disks.filter((disk) => disk !== object && !disk.captured && disk.lane === object.teleport.targetLane).every((disk) => lanePairIsSafe({ first: object, second: disk }));
}
function updateFlips({ state, store: store2, delta }) {
  state.catchers.forEach((catcher) => {
    if (catcher.flipping) store2.dispatch({ type: "ADVANCE_FLIP", lane: catcher.index, delta });
  });
}
function removeReached({ reached, store: store2, effects: effects2, audio: audio2 }) {
  reached.forEach((object) => {
    const before = store2.getState();
    const after = store2.dispatch({
      type: "COLLECT_DISK",
      batchId: object.batchId,
      lane: object.lane,
      sourceLane: object.sourceLane,
      color: object.color,
      expectedSide: object.expectedSide
    });
    if (after.status === "playing" && after.score > before.score) {
      effects2.addFloatText("+1", getCatchEffectPosition(object), object.color === "green" ? "#d9ff8a" : "#ffadc4");
      effects2.burst({ x: object.group.position.x, y: object.targetY }, object.color === "green" ? 13238114 : 16733567, 17);
      audio2.playCollect();
    } else if (after.status === "gameover") {
      effects2.burst({ x: object.group.position.x, y: object.targetY }, 16733567, 22);
    }
    object.captured = true;
    object.captureTimer = GAME.captureDuration;
  });
}
function getCatchEffectPosition(object) {
  return { x: object.group.position.x, y: object.targetY + GAME.catchPopupOffset };
}
function clearCaptured({ disks, renderer: renderer2, store: store2, delta }) {
  disks.forEach((object) => {
    if (object.captured) object.captureTimer = Math.max(0, object.captureTimer - delta);
  });
  const expired = disks.filter((object) => object.captured && object.captureTimer <= 0);
  if (!expired.length) return;
  expired.forEach((object) => renderer2.removeDisk(object.group));
  disks.splice(0, disks.length, ...disks.filter((object) => !expired.includes(object)));
  [...new Set(expired.map((object) => object.batchId))].filter((batchId) => !disks.some((object) => object.batchId === batchId)).forEach((batchId) => store2.dispatch({ type: "COMPLETE_BATCH", batchId }));
  if (isCampaignComplete({ state: store2.getState() })) store2.dispatch({ type: "COMPLETE_RUN" });
}
function updateTeleportWait({ object, disks, delta, renderer: renderer2 }) {
  const teleport = object.teleport;
  teleport.elapsed += delta;
  teleport.remaining = Math.max(0, teleport.remaining - delta);
  if (teleport.remaining > 0 || !teleportLaneIsSafe({ object, disks })) return true;
  teleport.state = "complete";
  object.lane = teleport.targetLane;
  renderer2.moveDiskToLane(object.group, object.lane);
  object.group.visible = true;
  return true;
}
function triggerTeleport({ object, teleport, nextY }) {
  if (teleport?.state !== "traveling" || nextY > teleport.triggerY) return false;
  object.age = (GAME.spawnY - teleport.triggerY) / (GAME.baseSpeed * object.effectiveSpeedScale);
  object.group.position.y = teleport.triggerY;
  teleport.state = "waiting";
  teleport.remaining = GAME.teleportStopDuration;
  teleport.elapsed = 0;
  return true;
}
function triggerMystery({ object, mystery, nextY }) {
  if (mystery?.state !== "traveling" || nextY > mystery.triggerY) return false;
  object.age = (GAME.spawnY - mystery.triggerY) / (GAME.baseSpeed * object.effectiveSpeedScale);
  object.group.position.y = mystery.triggerY;
  mystery.state = "morphing";
  mystery.elapsed = 0;
  mystery.remaining = mystery.morphDuration;
  return true;
}
function updateMysteryWait({ object, delta, renderer: renderer2 }) {
  const mystery = object.mystery;
  if (mystery?.state !== "morphing") return false;
  mystery.elapsed = Math.min(mystery.morphDuration, mystery.elapsed + delta);
  mystery.remaining = Math.max(0, mystery.morphDuration - mystery.elapsed);
  if (mystery.elapsed >= mystery.morphDuration) revealMystery({ object, renderer: renderer2 });
  return true;
}
function advanceDisk({ object, disks, delta, renderer: renderer2 }) {
  const teleport = object.teleport;
  const mystery = object.mystery;
  if (teleport?.state === "waiting") return updateTeleportWait({ object, disks, delta, renderer: renderer2 });
  if (mystery?.state === "morphing") return updateMysteryWait({ object, delta, renderer: renderer2 });
  const nextAge = object.age + delta;
  const nextY = GAME.spawnY - nextAge * GAME.baseSpeed * object.effectiveSpeedScale;
  if (triggerTeleport({ object, teleport, nextY })) return true;
  if (triggerMystery({ object, mystery, nextY })) return true;
  if (nextY <= object.targetY) {
    object.age = (GAME.spawnY - object.targetY) / (GAME.baseSpeed * object.effectiveSpeedScale);
    object.group.position.y = object.targetY;
    revealMystery({ object, renderer: renderer2 });
    return false;
  }
  object.age = nextAge;
  object.group.position.y = nextY;
  return false;
}
function revealMystery({ object, renderer: renderer2 }) {
  if (!object.mystery || object.mystery.state === "revealed") return;
  object.mystery.state = "revealed";
  object.mystery.elapsed = object.mystery.morphDuration;
  object.mystery.remaining = 0;
  renderer2.revealMysteryDisk?.(object.group);
}
function updateDisks({ disks, delta, renderer: renderer2, store: store2, effects: effects2, audio: audio2 }) {
  clearCaptured({ disks, renderer: renderer2, store: store2, delta });
  const status = store2.getState().status;
  if (status !== "playing") {
    if (status !== "extraction") disks.splice(0).forEach((object) => renderer2.removeDisk(object.group));
    return;
  }
  const reached = [];
  disks.forEach((object) => {
    if (object.captured) return;
    const pausedForSpecial = advanceDisk({ object, disks, delta, renderer: renderer2 });
    if (!pausedForSpecial && object.group.position.y <= object.targetY) reached.push(object);
  });
  if (reached.length) removeReached({ reached, store: store2, effects: effects2, audio: audio2 });
  if (["gameover", "victory"].includes(store2.getState().status)) {
    disks.splice(0).forEach((object) => renderer2.removeDisk(object.group));
  }
}
function spawnIfReady({ state, disks, renderer: renderer2, store: store2 }) {
  const maxActiveBatches = getMaxActiveBatches({ mode: state.mode, phase: state.phase });
  const queueCounts = getBatchQueueCounts(state);
  if (spawnIsBlocked({ state, queueCounts, maxNormal: maxActiveBatches })) return;
  if (!isCampaignSpawnAllowed({ state })) return;
  const activeBatchCount = (state.activeBatchIds || []).length;
  const plan = createPendingPlan({ state, activeBatchCount, queueCounts });
  if (!planCanSpawn({ state, plan, disks, maxNormal: maxActiveBatches })) return;
  store2.dispatch({
    type: "SPAWN_BATCH",
    batchId: plan.batchId,
    round: plan.batchId,
    patternId: plan.patternId,
    colorSignature: plan.colors.join("-"),
    hasHalfSpeed: plan.hasHalfSpeed,
    slowQueue: plan.hasHalfSpeed
  });
  disks.push(...createDiskObjects({ plan, renderer: renderer2 }));
  const current = store2.getState();
  const overlapUnlocked = getMaxActiveBatches({ mode: current.mode, phase: current.phase }) > 1;
  const cooldown = overlapUnlocked ? getOverlapSpawnDelay({ mode: current.mode, phase: current.phase }) : getSpawnDelay({ mode: current.mode, phase: current.phase });
  store2.dispatch({ type: "SET_COOLDOWN", cooldown });
}
function createBrowserScheduler() {
  return {
    now: () => performance.now(),
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (frameId) => window.cancelAnimationFrame(frameId)
  };
}
function createGameLoop({ store: store2, renderer: renderer2, effects: effects2, audio: audio2, ui: ui2, scheduler = createBrowserScheduler() }) {
  const disks = [];
  let frameId = 0;
  let lastTime = scheduler.now();
  let running = false;
  function update(delta) {
    const state = store2.getState();
    if (state.status === "playing") {
      store2.dispatch({ type: "ADVANCE_RUN_TIME", deltaSeconds: delta });
      updateFlips({ state, store: store2, delta });
      const current = store2.getState();
      if (current.cooldown > 0) store2.dispatch({ type: "SET_COOLDOWN", cooldown: current.cooldown - delta });
      spawnIfReady({ state: store2.getState(), disks, renderer: renderer2, store: store2 });
      updateDisks({ disks, delta, renderer: renderer2, store: store2, effects: effects2, audio: audio2 });
    } else if (state.status === "extraction") {
      store2.dispatch({ type: "ADVANCE_EXTRACTION", deltaSeconds: delta });
    } else if (state.status === "entering") {
      store2.dispatch({ type: "ADVANCE_RUN_TRANSITION", deltaSeconds: delta });
    }
    renderer2.update({ gameState: store2.getState(), disks, delta });
    effects2.update(delta);
    ui2.render(store2.getState());
  }
  function frame(now) {
    if (!running) return;
    const delta = Math.min((now - lastTime) / 1e3, GAME.maxFrameDelta);
    lastTime = now;
    update(delta);
    renderer2.render();
    frameId = scheduler.requestFrame(frame);
  }
  return {
    start() {
      if (running) return;
      running = true;
      lastTime = scheduler.now();
      frameId = scheduler.requestFrame(frame);
    },
    stop() {
      running = false;
      scheduler.cancelFrame(frameId);
      disks.splice(0).forEach((object) => renderer2.removeDisk(object.group));
    },
    step: update,
    getDisks: () => disks
  };
}
export { advanceDisk, clearCaptured, createBrowserScheduler, createDiskObjects, createGameLoop, createPendingPlan, deliveryConflicts, diskDelivery, getBatchQueueCounts, getCatchEffectPosition, hasBatchQueueCapacity, isSafeDeliverySchedule, lanePairIsSafe, mysteryDelay, nextPlan, planCanSpawn, planDeliveries, planSpacingIsSafe, removeReached, revealMystery, spacingState, spawnIfReady, spawnIsBlocked, teleportDelay, teleportLaneIsSafe, updateDisks, updateFlips, updateMysteryWait, updateTeleportWait };
