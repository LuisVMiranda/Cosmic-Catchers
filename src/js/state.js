import { getFinaleStart, isCampaignComplete, isCampaignSpawnAllowed } from "./campaign.js";
import { GAME, MODE_CONFIG, clamp, normalizeMode } from "./config.js";

function createCatcher(index) {
  return {
    index,
    activeSide: 0,
    fromSide: 0,
    toSide: 0,
    flipProgress: 0,
    flipping: false
  };
}
function createCatchers() {
  return [0, 1, 2].map(createCatcher);
}
function cloneCatchers(catchers) {
  return catchers.map((catcher) => ({ ...catcher }));
}
function modeMap(values = {}, defaults = {}) {
  const easy = Object.hasOwn(defaults, "easy") ? defaults.easy : 0;
  const hard = Object.hasOwn(defaults, "hard") ? defaults.hard : 0;
  return { easy, hard, ...values };
}
function activeBestMap(state, runType = state.runType) {
  return runType === "endless" ? state.endlessBestByMode : state.campaignBestByMode;
}
function updateBest(state, score) {
  const field = state.runType === "endless" ? "endlessBestByMode" : "campaignBestByMode";
  const scores = { ...state[field] };
  const best = Math.max(scores[state.mode] || 0, score);
  scores[state.mode] = best;
  const result = { [field]: scores, best };
  if (field === "campaignBestByMode") result.bestByMode = scores;
  return result;
}
function phaseFor(state, completedBatches) {
  const config = MODE_CONFIG[state.mode];
  const earnedBumps = Math.floor(completedBatches / config.bumpEvery);
  const bumps = state.runType === "endless" ? earnedBumps : Math.min(earnedBumps, config.phaseCap - 1);
  return { phase: bumps + 1, speedBumps: bumps };
}
function validRunType(state, mode, requested) {
  if (requested !== "endless") return "campaign";
  return state.endlessUnlockedByMode[mode] ? "endless" : "campaign";
}
function resetRun(state, mode, seed, requestedRunType) {
  const nextMode = normalizeMode(mode || state.mode);
  const runType = validRunType(state, nextMode, requestedRunType || state.runType);
  const best = activeBestMap(state, runType)[nextMode] || 0;
  return {
    ...state,
    status: "playing",
    mode: nextMode,
    runType,
    score: 0,
    streak: 0,
    longestStreak: 0,
    laneFlipCounts: [0, 0, 0],
    consecutiveHalfSpeedBatches: 0,
    best,
    phase: 1,
    speedBumps: 0,
    completedBatches: 0,
    runElapsedSeconds: 0,
    extractionRemaining: 0,
    entryRemaining: 0,
    pendingRun: null,
    round: 0,
    pattern: "PAIR",
    cooldown: GAME.initialSpawnDelay,
    seed: Number.isFinite(seed) ? seed >>> 0 : Date.now() >>> 0,
    catchers: createCatchers(),
    gameOverReason: "",
    gameOverVariables: {},
    newRecord: false,
    lastCompletedBatchId: 0,
    activeBatchId: 0,
    activeBatchIds: [],
    slowQueueBatchIds: [],
    recentColorPatterns: [],
    collectedDiskKeys: []
  };
}
function finishRun(state, reason, variables) {
  const isNewRecord = state.score > (activeBestMap(state)[state.mode] || 0);
  const result = updateBest(state, state.score);
  return {
    ...state,
    status: "gameover",
    best: result.best,
    ...result,
    newRecord: isNewRecord,
    gameOverReason: reason || "mismatch",
    gameOverVariables: variables || {},
    cooldown: 0
  };
}
function completeRun(state) {
  if (!isCampaignComplete({ state })) return state;
  const result = updateBest(state, state.score);
  const winsByMode = { ...state.winsByMode };
  const fastestClearByMode = { ...state.fastestClearByMode };
  const endlessUnlockedByMode = { ...state.endlessUnlockedByMode };
  const previousFastest = fastestClearByMode[state.mode];
  winsByMode[state.mode] = (winsByMode[state.mode] || 0) + 1;
  fastestClearByMode[state.mode] = previousFastest === null ? state.runElapsedSeconds : Math.min(previousFastest, state.runElapsedSeconds);
  endlessUnlockedByMode[state.mode] = true;
  return {
    ...state,
    ...result,
    status: "victory",
    winsByMode,
    fastestClearByMode,
    endlessUnlockedByMode,
    newRecord: state.score > (state.campaignBestByMode[state.mode] || 0),
    cooldown: 0
  };
}
function flipCatcher(state, lane) {
  if (state.status !== "playing") return state;
  const catcher = state.catchers[lane];
  if (!catcher || catcher.flipping) return state;
  const catchers = cloneCatchers(state.catchers);
  const next = catchers[lane];
  next.fromSide = next.activeSide;
  next.toSide = next.activeSide === 0 ? 1 : 0;
  next.flipProgress = 0;
  next.flipping = true;
  const laneFlipCounts = [...state.laneFlipCounts || [0, 0, 0]];
  laneFlipCounts[lane] += 1;
  const streak = laneFlipCounts[lane] > 1 ? 0 : state.streak || 0;
  return { ...state, catchers, laneFlipCounts, streak };
}
function finishFlip(state, lane) {
  const catcher = state.catchers[lane];
  if (!catcher || !catcher.flipping) return state;
  const catchers = cloneCatchers(state.catchers);
  const next = catchers[lane];
  next.activeSide = next.toSide;
  next.flipProgress = 1;
  next.flipping = false;
  return { ...state, catchers };
}
function advanceFlip(state, lane, delta) {
  const catcher = state.catchers[lane];
  if (!catcher || !catcher.flipping) return state;
  const catchers = cloneCatchers(state.catchers);
  const next = catchers[lane];
  next.flipProgress = clamp(next.flipProgress + delta / GAME.flipDuration, 0, 1);
  if (next.flipProgress >= 1) {
    next.activeSide = next.toSide;
    next.flipping = false;
  }
  return { ...state, catchers };
}
function collectionKey(command) {
  const identityLane = Number.isInteger(command.sourceLane) ? command.sourceLane : command.lane;
  return command.batchId ? `${command.batchId}:${identityLane}` : "";
}
function isDuplicateCollection({ state, key }) {
  return Boolean(key && (state.collectedDiskKeys || []).includes(key));
}
function isStaleCollection({ state, command }) {
  if (!command.batchId) return false;
  const active = state.activeBatchIds || [state.activeBatchId];
  return !active.includes(command.batchId);
}
function getCatcherFailureReason(state, command) {
  const catcher = state.catchers[command.lane];
  if (!catcher) return "invalid-lane";
  if (catcher.flipping) return "catcher-flipping";
  return catcher.activeSide === command.expectedSide ? "" : "wrong-side";
}
function collectDisk(state, command) {
  if (state.status !== "playing") return state;
  const collectedDiskKeys = state.collectedDiskKeys || [];
  const key = collectionKey(command);
  if (isDuplicateCollection({ state, key })) return state;
  if (isStaleCollection({ state, command })) return state;
  const failureReason = getCatcherFailureReason(state, command);
  if (failureReason) {
    return finishRun(state, failureReason, {
      color: command.color,
      expectedSide: command.expectedSide,
      lane: command.lane
    });
  }
  const streak = (state.streak || 0) + 1;
  const laneFlipCounts = [...state.laneFlipCounts || [0, 0, 0]];
  laneFlipCounts[command.lane] = 0;
  return {
    ...state,
    score: state.score + 1,
    streak,
    longestStreak: Math.max(state.longestStreak || 0, streak),
    laneFlipCounts,
    collectedDiskKeys: key ? [...collectedDiskKeys, key] : collectedDiskKeys
  };
}
function completeBatch(state, batchId) {
  if (state.status !== "playing") return state;
  const activeBatchIds = state.activeBatchIds || [];
  if (!batchId || !activeBatchIds.includes(batchId)) return state;
  const completedBatches = state.completedBatches + 1;
  const progression = phaseFor(state, completedBatches);
  const beginsExtraction = state.runType === "campaign" && state.completedBatches < getFinaleStart({ mode: state.mode }) && completedBatches >= getFinaleStart({ mode: state.mode });
  return {
    ...state,
    status: beginsExtraction ? "extraction" : state.status,
    completedBatches,
    phase: progression.phase,
    speedBumps: progression.speedBumps,
    lastCompletedBatchId: batchId,
    extractionRemaining: beginsExtraction ? GAME.extractionIntroDuration : state.extractionRemaining,
    activeBatchIds: activeBatchIds.filter((activeBatchId) => activeBatchId !== batchId),
    slowQueueBatchIds: (state.slowQueueBatchIds || []).filter((activeBatchId) => activeBatchId !== batchId)
  };
}
function selectMode(state, command) {
  if (["playing", "paused", "extraction", "entering"].includes(state.status)) return state;
  const mode = normalizeMode(command.mode);
  const runType = validRunType(state, mode, state.runType);
  return { ...state, mode, runType, best: activeBestMap(state, runType)[mode] || 0 };
}
function selectRunType(state, command) {
  if (["playing", "paused", "extraction", "entering"].includes(state.status)) return state;
  const runType = validRunType(state, state.mode, command.runType);
  return { ...state, runType, best: activeBestMap(state, runType)[state.mode] || 0 };
}
function setLanguage(state, command) {
  return { ...state, language: command.language };
}
function resetProgress(state) {
  return createInitialState({ mode: state.mode, language: state.language, seed: state.seed });
}
function returnToMenu(state) {
  if (!["gameover", "victory"].includes(state.status)) return state;
  return {
    ...state,
    status: "ready",
    score: 0,
    streak: 0,
    longestStreak: 0,
    laneFlipCounts: [0, 0, 0],
    consecutiveHalfSpeedBatches: 0,
    phase: 1,
    speedBumps: 0,
    completedBatches: 0,
    runElapsedSeconds: 0,
    extractionRemaining: 0,
    entryRemaining: 0,
    pendingRun: null,
    round: 0,
    pattern: "PAIR",
    cooldown: GAME.initialSpawnDelay,
    catchers: createCatchers(),
    gameOverReason: "",
    gameOverVariables: {},
    newRecord: false,
    activeBatchId: 0,
    activeBatchIds: [],
    slowQueueBatchIds: [],
    recentColorPatterns: [],
    collectedDiskKeys: []
  };
}
function startRun(state, command) {
  return resetRun(state, command.mode, command.seed, command.runType);
}
function beginRunTransition(state, command) {
  if (state.status !== "ready") return state;
  const mode = normalizeMode(command.mode || state.mode);
  const runType = validRunType(state, mode, command.runType || state.runType);
  return {
    ...state,
    status: "entering",
    mode,
    runType,
    entryRemaining: GAME.entryTransitionDuration,
    pendingRun: { mode, runType, seed: command.seed }
  };
}
function advanceRunTransition(state, command) {
  if (state.status !== "entering") return state;
  const delta = Math.max(0, Number(command.deltaSeconds) || 0);
  const entryRemaining = Math.max(0, state.entryRemaining - delta);
  if (entryRemaining > 0) return { ...state, entryRemaining };
  const pending = state.pendingRun || { mode: state.mode, runType: state.runType };
  return resetRun({ ...state, entryRemaining: 0, pendingRun: null }, pending.mode, pending.seed, pending.runType);
}
function advanceRunTime(state, command) {
  const delta = Number(command.deltaSeconds);
  if (state.status !== "playing" || !Number.isFinite(delta) || delta <= 0) return state;
  return { ...state, runElapsedSeconds: state.runElapsedSeconds + delta };
}
function advanceExtraction(state, command) {
  if (state.status !== "extraction") return state;
  const delta = Math.max(0, Number(command.deltaSeconds) || 0);
  const extractionRemaining = Math.max(0, state.extractionRemaining - delta);
  if (extractionRemaining > 0) return { ...state, extractionRemaining };
  return {
    ...state,
    status: "playing",
    extractionRemaining: 0,
    cooldown: Math.max(state.cooldown, GAME.initialSpawnDelay)
  };
}
function pauseRun(state) {
  return state.status === "playing" ? { ...state, status: "paused" } : state;
}
function resumeRun(state) {
  return state.status === "paused" ? { ...state, status: "playing" } : state;
}
function appendUnique(items, value) {
  return items.includes(value) ? items : [...items, value];
}
function updateSlowQueue({ items, batchId, enabled }) {
  if (!enabled) return items;
  return appendUnique(items, batchId);
}
function updateSlowSequence(state, hasHalfSpeed) {
  return hasHalfSpeed ? (state.consecutiveHalfSpeedBatches || 0) + 1 : 0;
}
function updateRecentColorPatterns(patterns, signature) {
  if (!signature) return patterns || [];
  return [...patterns || [], signature].slice(-2);
}
function spawnBatch(state, command) {
  if (state.status !== "playing" || !isCampaignSpawnAllowed({ state })) return state;
  const activeBatchId = command.batchId || command.round;
  const activeBatchIds = state.activeBatchIds || [];
  const slowQueueBatchIds = state.slowQueueBatchIds || [];
  return {
    ...state,
    round: command.round,
    pattern: command.patternId || state.pattern,
    cooldown: 0,
    activeBatchId,
    consecutiveHalfSpeedBatches: updateSlowSequence(state, command.hasHalfSpeed),
    recentColorPatterns: updateRecentColorPatterns(state.recentColorPatterns, command.colorSignature),
    activeBatchIds: appendUnique(activeBatchIds, activeBatchId),
    slowQueueBatchIds: updateSlowQueue({ items: slowQueueBatchIds, batchId: activeBatchId, enabled: command.slowQueue })
  };
}
function setCooldown(state, command) {
  return { ...state, cooldown: Math.max(0, command.cooldown) };
}
function failRun(state, command) {
  return finishRun(state, command.reason, command.variables);
}
var COMMAND_HANDLERS = Object.freeze({
  SELECT_MODE: selectMode,
  SELECT_RUN_TYPE: selectRunType,
  SET_LANGUAGE: setLanguage,
  RESET_PROGRESS: resetProgress,
  RETURN_TO_MENU: returnToMenu,
  START_RUN: startRun,
  BEGIN_RUN_TRANSITION: beginRunTransition,
  ADVANCE_RUN_TRANSITION: advanceRunTransition,
  ADVANCE_RUN_TIME: advanceRunTime,
  ADVANCE_EXTRACTION: advanceExtraction,
  COMPLETE_RUN: completeRun,
  PAUSE: pauseRun,
  RESUME: resumeRun,
  FLIP_CATCHER: (state, command) => flipCatcher(state, command.lane),
  FINISH_FLIP: (state, command) => finishFlip(state, command.lane),
  ADVANCE_FLIP: (state, command) => advanceFlip(state, command.lane, command.delta),
  SPAWN_BATCH: spawnBatch,
  SET_COOLDOWN: setCooldown,
  COLLECT_DISK: collectDisk,
  COMPLETE_BATCH: (state, command) => completeBatch(state, command.batchId),
  FAIL_RUN: failRun
});
function createInitialState({
  mode,
  language,
  bestByMode,
  campaignBestByMode,
  endlessBestByMode,
  winsByMode,
  fastestClearByMode,
  endlessUnlockedByMode,
  seed
} = {}) {
  const nextMode = normalizeMode(mode);
  const campaignScores = modeMap(campaignBestByMode, modeMap(bestByMode));
  const endlessScores = modeMap(endlessBestByMode);
  const wins = modeMap(winsByMode);
  const fastest = modeMap(fastestClearByMode, { easy: null, hard: null });
  const unlocked = modeMap(endlessUnlockedByMode, { easy: false, hard: false });
  return {
    status: "ready",
    mode: nextMode,
    runType: "campaign",
    language: language || GAME.defaultLanguage,
    score: 0,
    streak: 0,
    longestStreak: 0,
    laneFlipCounts: [0, 0, 0],
    consecutiveHalfSpeedBatches: 0,
    best: campaignScores[nextMode] || 0,
    bestByMode: campaignScores,
    campaignBestByMode: campaignScores,
    endlessBestByMode: endlessScores,
    winsByMode: wins,
    fastestClearByMode: fastest,
    endlessUnlockedByMode: unlocked,
    phase: 1,
    speedBumps: 0,
    completedBatches: 0,
    runElapsedSeconds: 0,
    extractionRemaining: 0,
    entryRemaining: 0,
    pendingRun: null,
    round: 0,
    pattern: "PAIR",
    cooldown: GAME.initialSpawnDelay,
    seed: Number.isFinite(seed) ? seed >>> 0 : 1,
    catchers: createCatchers(),
    gameOverReason: "",
    gameOverVariables: {},
    newRecord: false,
    lastCompletedBatchId: 0,
    activeBatchId: 0,
    activeBatchIds: [],
    slowQueueBatchIds: [],
    recentColorPatterns: [],
    collectedDiskKeys: []
  };
}
function transitionState({ state, command }) {
  const handler = COMMAND_HANDLERS[command.type];
  return handler ? handler(state, command) : state;
}
function createStateStore(initialState2, onChange) {
  let current = initialState2;
  return {
    getState: () => current,
    dispatch(command) {
      const previous = current;
      const next = transitionState({ state: current, command });
      if (next === current) return current;
      current = next;
      if (onChange) onChange(current, command, previous);
      return current;
    },
    replace(nextState) {
      const previous = current;
      current = nextState;
      if (onChange) onChange(current, { type: "REPLACE_STATE" }, previous);
      return current;
    }
  };
}
export { COMMAND_HANDLERS, activeBestMap, advanceExtraction, advanceFlip, advanceRunTime, advanceRunTransition, appendUnique, beginRunTransition, cloneCatchers, collectDisk, collectionKey, completeBatch, completeRun, createCatcher, createCatchers, createInitialState, createStateStore, failRun, finishFlip, finishRun, flipCatcher, getCatcherFailureReason, isDuplicateCollection, isStaleCollection, modeMap, pauseRun, phaseFor, resetProgress, resetRun, resumeRun, returnToMenu, selectMode, selectRunType, setCooldown, setLanguage, spawnBatch, startRun, transitionState, updateBest, updateRecentColorPatterns, updateSlowQueue, updateSlowSequence, validRunType };
