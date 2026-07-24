import { GAME, getModeConfig } from "./config.js";
import { OVERLAP_SPEED_REDUCTIONS, getArrivalTime, getDifficultyProfile, getEffectiveSpeedScale, getSpeedCeiling } from "./difficulty.js";

var COLORS2 = Object.freeze(["green", "red"]);
function hashSeed(seed, mode, phase, round) {
  const input = `${seed}:${mode}:${phase}:${round}`;
  let hash = 2166136261;
  for (const character of input) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function createRng(seed) {
  let value = seed >>> 0;
  return () => {
    value += 1831565813;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}
function colorSignature(colors) {
  return colors.join("-");
}
function randomColors({ laneCount, rng }) {
  return Array.from({ length: laneCount }, () => COLORS2[Math.floor(rng() * COLORS2.length)]);
}
function patternFromIndex(index, laneCount) {
  return Array.from({ length: laneCount }, (_, lane) => COLORS2[index >> lane & 1]);
}
function choosePattern({ laneCount, rng, recentColorPatterns = [] }) {
  const forbidden = new Set(recentColorPatterns.slice(-2));
  const combinations = 2 ** laneCount;
  for (let attempt = 0; attempt < combinations * 2; attempt += 1) {
    const candidate = randomColors({ laneCount, rng });
    if (!forbidden.has(colorSignature(candidate))) return candidate;
  }
  const start = Math.floor(rng() * combinations);
  for (let offset = 0; offset < combinations; offset += 1) {
    const candidate = patternFromIndex((start + offset) % combinations, laneCount);
    if (!forbidden.has(colorSignature(candidate))) return candidate;
  }
  return patternFromIndex(start, laneCount);
}
function getMysteryChance({ mode, phase }) {
  const unlockPhase = getModeConfig(mode).mysteryUnlockPhase;
  if (phase < unlockPhase) return 0;
  return Math.min(GAME.mysteryChanceCap, GAME.mysteryBaseChance + (phase - unlockPhase) * GAME.mysteryChanceStep);
}
function createTeleportDisk({ mode, phase, round, seed, laneCount }) {
  const config = getModeConfig(mode);
  const unlocked = phase >= config.teleportUnlockPhase;
  const scheduled = round > 0 && round % config.teleportEvery === 0;
  if (!unlocked || !scheduled || laneCount < 2) return null;
  const lane = (Math.abs(seed) + round) % laneCount;
  const targetLane = (lane + 1 + Math.abs(seed) % (laneCount - 1)) % laneCount;
  return {
    type: "teleport",
    lane,
    targetLane: targetLane === lane ? (lane + 1) % laneCount : targetLane,
    triggerFraction: GAME.teleportTriggerFraction,
    stopDuration: GAME.teleportStopDuration
  };
}
function createMysteryDisk({ mode, phase, round, seed, laneCount }) {
  const config = getModeConfig(mode);
  if (laneCount < 2 || round <= 0 || phase < config.mysteryUnlockPhase) return null;
  const chance = getMysteryChance({ mode, phase });
  const roll = hashSeed(seed, mode, phase, round) / 0x100000000;
  if (roll >= chance) return null;
  return {
    type: "mystery",
    lane: Math.abs(seed + round) % laneCount,
    triggerFraction: GAME.mysteryTriggerFraction,
    morphDuration: GAME.mysteryMorphDuration,
    flickerRate: GAME.mysteryFlickerRate
  };
}
function createSpecialDisk({ mode, phase, round, seed, laneCount }) {
  return createTeleportDisk({ mode, phase, round, seed, laneCount }) || createMysteryDisk({ mode, phase, round, seed, laneCount });
}
function buildMultipliers({ mode, phase, round, laneCount, rng, seed, forceHalfSpeedRecovery }) {
  const profile = getDifficultyProfile({ mode, phase });
  const multipliers = Array(laneCount).fill(1);
  const band = profile.speedBand;
  if (!band.maxOutliers) return multipliers;
  const fastLane = (round + seed) % laneCount;
  const fast = band.multipliers[band.multipliers.length - 1];
  const slow = band.multipliers[0];
  multipliers[fastLane] = fast;
  if (forceHalfSpeedRecovery) return multipliers;
  if (band.maxOutliers > 1 && laneCount > 2) {
    multipliers[(fastLane + 1) % laneCount] = slow;
  } else if (mode === "easy" || band.maxOutliers === 1 || rng() < 0.5) {
    multipliers[fastLane] = slow;
  }
  return multipliers;
}
function targetSide(color) {
  return color === "green" ? 0 : 1;
}
function hasSlowOutlier(multipliers) {
  return multipliers.some((value) => value < 1);
}
function createBatchPlan({ mode, phase, round, seed, laneCount, overlapSpeedReduction = 0, forceHalfSpeedRecovery = false, recentColorPatterns = [] }) {
  const planSeed = hashSeed(seed, mode, phase, round);
  const rng = createRng(planSeed);
  const colorRng = createRng(planSeed ^ 2654435769);
  const colors = choosePattern({ laneCount, rng: colorRng, recentColorPatterns });
  const speedMultipliers = buildMultipliers({ mode, phase, round, laneCount, rng, seed, forceHalfSpeedRecovery });
  const effectiveSpeedScales = speedMultipliers.map((multiplier) => getEffectiveSpeedScale({ mode, phase, multiplier }) * (1 - overlapSpeedReduction));
  const profile = getDifficultyProfile({ mode, phase });
  const specialDisk = createSpecialDisk({ mode, phase, round, seed, laneCount });
  const hasHalfSpeed = hasSlowOutlier(speedMultipliers);
  const recoveryBatch = Boolean(forceHalfSpeedRecovery && profile.speedBand.maxOutliers);
  return {
    batchId: round,
    mode,
    phase,
    patternId: specialDisk?.type === "mystery" ? "MYSTERY" : specialDisk ? "TELEPORT" : profile.patternBand,
    colors,
    targetSides: colors.map(targetSide),
    speedMultipliers,
    effectiveSpeedScales,
    overlapSpeedReduction,
    hasHalfSpeed,
    recoveryBatch,
    specialDisk,
    seed: planSeed,
    fallback: false
  };
}
function createNormalBatchPlan({ mode, phase, round, laneCount, seed, overlapSpeedReduction = 0, recentColorPatterns = [] }) {
  const plan = createBatchPlan({ mode, phase: Math.min(phase, 12), round, laneCount, seed, overlapSpeedReduction, recentColorPatterns });
  return {
    ...plan,
    phase,
    patternId: getDifficultyProfile({ mode, phase }).patternBand,
    fallback: true,
    speedMultipliers: Array(laneCount).fill(1),
    effectiveSpeedScales: Array(laneCount).fill(getEffectiveSpeedScale({ mode, phase, multiplier: 1 }) * (1 - overlapSpeedReduction)),
    overlapSpeedReduction,
    hasHalfSpeed: false,
    recoveryBatch: false,
    specialDisk: null
  };
}
function normalizePlanArrays(plan) {
  return {
    colors: Array.isArray(plan.colors) ? plan.colors : [],
    targetSides: Array.isArray(plan.targetSides) ? plan.targetSides : [],
    speedMultipliers: Array.isArray(plan.speedMultipliers) ? plan.speedMultipliers : [],
    effectiveScales: Array.isArray(plan.effectiveSpeedScales) ? plan.effectiveSpeedScales : []
  };
}
function validateShape({ arrays, config, reasons }) {
  const { colors, targetSides, speedMultipliers, effectiveScales } = arrays;
  const length = colors.length;
  if (length !== config.lanes) reasons.push("lane-count");
  if (targetSides.length !== length) reasons.push("target-count");
  if (speedMultipliers.length !== length) reasons.push("speed-count");
  if (effectiveScales.length !== length) reasons.push("effective-speed-count");
}
function validateSpeedValues({ arrays, profile, mode, phase, plan, reasons }) {
  const { speedMultipliers, effectiveScales } = arrays;
  const band = profile.speedBand;
  const overlapSpeedReduction = plan.overlapSpeedReduction || 0;
  const allowedMultipliers = /* @__PURE__ */ new Set([1, ...band.multipliers]);
  const outliers = speedMultipliers.filter((value) => value !== 1);
  const maximumFast = Math.max(...band.multipliers);
  if (outliers.length > band.maxOutliers) reasons.push("outlier-count");
  if (!plan.fallback && band.maxOutliers > 0 && outliers.length === 0) reasons.push("missing-outlier");
  speedMultipliers.forEach((value) => {
    if (!allowedMultipliers.has(value)) reasons.push("speed-band");
  });
  if (band.maxOutliers > 0 && speedMultipliers.filter((value) => value === maximumFast).length > 1) reasons.push("maximum-fast-count");
  if (overlapSpeedReduction !== 0 && !OVERLAP_SPEED_REDUCTIONS.includes(overlapSpeedReduction)) reasons.push("overlap-speed-reduction");
  const speedCeiling = getSpeedCeiling({ mode, phase });
  effectiveScales.forEach((scale, index) => {
    if (scale > speedCeiling || scale <= 0) reasons.push("speed-cap");
    const expected = getEffectiveSpeedScale({ mode, phase, multiplier: speedMultipliers[index] }) * (1 - overlapSpeedReduction);
    if (Math.abs(scale - expected) > 1e-6) reasons.push("speed-cap-mismatch");
  });
}
function getArrivalTimes({ arrays, mode, phase, overlapSpeedReduction = 0 }) {
  const speedFactor = Math.max(1e-6, 1 - overlapSpeedReduction);
  return arrays.speedMultipliers.map((multiplier, lane) => getArrivalTime({ mode, phase, multiplier, side: arrays.targetSides[lane] }) / speedFactor);
}
function validateReactionTimes({ arrivalTimes, minimum, reasons }) {
  arrivalTimes.forEach((time) => {
    if (time < minimum) reasons.push("reaction-window");
  });
}
function validateColorSides({ colors, targetSides, reasons }) {
  colors.forEach((color, index) => {
    if (targetSides[index] !== targetSide(color)) reasons.push("color-side");
  });
}
function isValidLane(value, laneCount) {
  if (!Number.isInteger(value)) return false;
  if (value < 0) return false;
  return value < laneCount;
}
function isValidTeleportLanePair(specialDisk, laneCount) {
  if (!isValidLane(specialDisk.lane, laneCount)) return false;
  if (!isValidLane(specialDisk.targetLane, laneCount)) return false;
  return specialDisk.lane !== specialDisk.targetLane;
}
function isValidMysteryLane(specialDisk, laneCount) {
  return isValidLane(specialDisk.lane, laneCount);
}
function validateMysteryDisk({ specialDisk, config, phase, plan, reasons }) {
  if (!isValidMysteryLane(specialDisk, config.lanes)) reasons.push("mystery-lane");
  if (specialDisk.triggerFraction !== GAME.mysteryTriggerFraction) reasons.push("mystery-trigger");
  if (specialDisk.morphDuration !== GAME.mysteryMorphDuration) reasons.push("mystery-duration");
  if (specialDisk.flickerRate !== GAME.mysteryFlickerRate) reasons.push("mystery-flicker-rate");
  if (phase < config.mysteryUnlockPhase) reasons.push("mystery-early");
  if (plan.fallback) reasons.push("mystery-fallback");
}
function validateTeleportDisk({ specialDisk, config, phase, plan, reasons }) {
  if (!isValidTeleportLanePair(specialDisk, config.lanes)) reasons.push("teleport-lane");
  if (specialDisk.triggerFraction !== GAME.teleportTriggerFraction) reasons.push("teleport-trigger");
  if (specialDisk.stopDuration !== GAME.teleportStopDuration) reasons.push("teleport-duration");
  if (phase < config.teleportUnlockPhase) reasons.push("teleport-early");
  if (plan.fallback) reasons.push("teleport-fallback");
}
function validateSpecialDisk({ specialDisk, config, phase, plan, reasons }) {
  if (!specialDisk) return;
  if (specialDisk.type === "mystery") {
    validateMysteryDisk({ specialDisk, config, phase, plan, reasons });
    return;
  }
  validateTeleportDisk({ specialDisk, config, phase, plan, reasons });
}
function validateRecoveryMetadata({ plan, arrays, reasons }) {
  const hasHalfSpeed = hasSlowOutlier(arrays.speedMultipliers);
  if (plan.hasHalfSpeed !== hasHalfSpeed) reasons.push("half-speed-metadata");
  if (plan.recoveryBatch && hasHalfSpeed) reasons.push("recovery-half-speed");
  if (plan.recoveryBatch && !arrays.speedMultipliers.some((value) => value > 1)) reasons.push("recovery-not-mixed");
}
function validateBatchPlan({ plan, mode, phase }) {
  const config = getModeConfig(mode);
  const profile = getDifficultyProfile({ mode, phase });
  const reasons = [];
  const arrays = normalizePlanArrays(plan);
  validateShape({ arrays, config, reasons });
  validateSpeedValues({ arrays, profile, mode, phase, plan, reasons });
  const arrivalTimes = getArrivalTimes({ arrays, mode, phase, overlapSpeedReduction: plan.overlapSpeedReduction || 0 });
  validateReactionTimes({ arrivalTimes, minimum: profile.minReactionWindow, reasons });
  validateColorSides({ colors: arrays.colors, targetSides: arrays.targetSides, reasons });
  validateSpecialDisk({ specialDisk: plan.specialDisk, config, phase, plan, reasons });
  validateRecoveryMetadata({ plan, arrays, reasons });
  return { valid: reasons.length === 0, reasons: [...new Set(reasons)], arrivalTimes };
}
export { COLORS2, buildMultipliers, choosePattern, colorSignature, createBatchPlan, createMysteryDisk, createNormalBatchPlan, createRng, createSpecialDisk, createTeleportDisk, getArrivalTimes, getMysteryChance, hasSlowOutlier, hashSeed, isValidLane, isValidMysteryLane, isValidTeleportLanePair, normalizePlanArrays, patternFromIndex, randomColors, targetSide, validateBatchPlan, validateColorSides, validateReactionTimes, validateRecoveryMetadata, validateShape, validateSpecialDisk, validateSpeedValues };
