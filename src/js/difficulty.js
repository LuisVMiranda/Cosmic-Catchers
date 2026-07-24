import { GAME, SIDE_Y, clamp, getModeConfig, lerp } from "./config.js";

var OVERLAP_SPEED_REDUCTIONS = Object.freeze([0.45, 0.55, 0.65]);
var SLOW_SPEED_MULTIPLIER = 0.66125;
var SPEED_BANDS = Object.freeze({
  easy: Object.freeze([
    Object.freeze({ minPhase: 1, multipliers: [1], maxOutliers: 0 }),
    Object.freeze({ minPhase: 13, multipliers: [SLOW_SPEED_MULTIPLIER, 1.1], maxOutliers: 1 }),
    Object.freeze({ minPhase: 20, multipliers: [SLOW_SPEED_MULTIPLIER, 1.2], maxOutliers: 1 })
  ]),
  hard: Object.freeze([
    Object.freeze({ minPhase: 1, multipliers: [1], maxOutliers: 0 }),
    Object.freeze({ minPhase: 7, multipliers: [SLOW_SPEED_MULTIPLIER, 1.15], maxOutliers: 1 }),
    Object.freeze({ minPhase: 15, multipliers: [SLOW_SPEED_MULTIPLIER, 1.2], maxOutliers: 2 }),
    Object.freeze({ minPhase: 24, multipliers: [SLOW_SPEED_MULTIPLIER, 1.25], maxOutliers: 2 })
  ])
});
function findBand(bands, phase) {
  return bands.reduce((selected, band) => phase >= band.minPhase ? band : selected, bands[0]);
}
function getSpeedBand({ mode, phase }) {
  return findBand(SPEED_BANDS[mode] || SPEED_BANDS.easy, phase);
}
function getEndlessMilestoneCount({ mode, phase }) {
  const config = getModeConfig(mode);
  if (phase <= config.endlessHoldUntilPhase) return 0;
  return Math.floor((phase - config.endlessHoldUntilPhase - 1) / config.endlessMilestoneEvery) + 1;
}
function getCampaignSpeedScale({ mode, phase }) {
  const config = getModeConfig(mode);
  const bumps = Math.min(Math.max(phase - 1, 0), config.phaseCap - 1);
  return Math.min(config.speedCap, config.startSpeedScale + bumps * GAME.speedStep);
}
function getSpeedCeiling({ mode, phase }) {
  const config = getModeConfig(mode);
  const milestones = getEndlessMilestoneCount({ mode, phase });
  return Math.min(config.endlessSpeedCap, config.speedCap + milestones * GAME.speedStep);
}
function getBaseSpeedScale({ mode, phase }) {
  const config = getModeConfig(mode);
  if (phase <= config.phaseCap) return getCampaignSpeedScale({ mode, phase });
  return getSpeedCeiling({ mode, phase });
}
function getEffectiveSpeedScale({ mode, phase, multiplier }) {
  const requested = getBaseSpeedScale({ mode, phase }) * multiplier;
  return Math.min(getSpeedCeiling({ mode, phase }), requested);
}
function getSpawnDelay({ mode, phase }) {
  const config = getModeConfig(mode);
  const campaignPhase = Math.min(phase, config.phaseCap);
  const completedStages = Math.max(0, campaignPhase - 1);
  const reductions = Math.floor(completedStages / config.spawnDelayPhases);
  const campaignDelay = Math.max(
    GAME.minSpawnDelay,
    GAME.baseSpawnDelay - reductions * GAME.spawnDelayStep
  );
  const milestones = getEndlessMilestoneCount({ mode, phase });
  return Math.max(config.endlessMinSpawnDelay, campaignDelay - milestones * GAME.spawnDelayStep);
}
function getOverlapSpawnDelay({ mode, phase }) {
  const delay = getSpawnDelay({ mode, phase }) * getOverlapWaitMultiplier({ mode, phase });
  return Math.max(GAME.minSpawnDelay, delay);
}
function getMaxActiveBatches({ mode, phase }) {
  const config = getModeConfig(mode);
  if (phase < config.batchOverlapUnlockPhase) return 1;
  return phase >= config.lateOverlapPhase ? config.lateMaxActiveBatches : GAME.maxActiveBatches;
}
function getOverlapWaitMultiplier({ mode, phase }) {
  const config = getModeConfig(mode);
  const span = Math.max(1, config.phaseCap - config.batchOverlapUnlockPhase);
  const progress2 = clamp((phase - config.batchOverlapUnlockPhase) / span, 0, 1);
  const reduction = phase >= config.eventfulCadencePhase ? config.lateOverlapReduction : 0;
  return lerp(GAME.overlapSpawnGapMultiplier, config.minimumOverlapMultiplier, progress2) - reduction;
}
function getMinimumDiskGap() {
  return GAME.diskDiameter * GAME.minimumDiskGapDiameters;
}
function projectedGap({ existing, candidate }) {
  const existingSpeed = GAME.baseSpeed * existing.effectiveSpeedScale;
  const candidateSpeed = GAME.baseSpeed * candidate.effectiveSpeedScale;
  const candidateY = candidate.y ?? GAME.spawnY;
  const initialGap = candidateY - existing.y;
  const wait = Math.max(0, existing.teleportWait || 0);
  const candidateTravel = Math.max(0, candidateY - candidate.targetY) / candidateSpeed;
  const waitHorizon = Math.min(wait, candidateTravel);
  const gapAfterWait = initialGap - candidateSpeed * waitHorizon;
  const existingTravel = Math.max(0, existing.y - existing.targetY) / existingSpeed;
  const sharedTravel = Math.min(existingTravel, Math.max(0, candidateTravel - waitHorizon));
  return Math.min(initialGap, gapAfterWait, gapAfterWait + (existingSpeed - candidateSpeed) * sharedTravel);
}
function isSafeSpawnGap({ existing, candidate }) {
  return projectedGap({ existing, candidate }) >= getMinimumDiskGap();
}
function getOverlapSpeedReduction({ mode, phase, round, seed }) {
  const source = Math.trunc(Number(seed) || 0) + round * 3 + phase + (mode === "hard" ? 1 : 0);
  const index = Math.abs(source) % OVERLAP_SPEED_REDUCTIONS.length;
  return OVERLAP_SPEED_REDUCTIONS[index];
}
function getPatternBand({ phase, mixed }) {
  if (phase === 1) return "PAIR";
  if (phase === 2) return "SPLIT";
  if (phase === 3) return "SWAP";
  return mixed ? "MIXED" : "RAPID";
}
function getDifficultyProfile({ mode, phase }) {
  const config = getModeConfig(mode);
  const band = getSpeedBand({ mode, phase });
  return {
    mode,
    phase,
    lanes: config.lanes,
    baseSpeedScale: getBaseSpeedScale({ mode, phase }),
    speedCap: getSpeedCeiling({ mode, phase }),
    speedBand: band,
    minReactionWindow: config.minReactionWindow,
    patternBand: getPatternBand({ phase, mixed: band.maxOutliers > 0 })
  };
}
function getTargetY(side) {
  return SIDE_Y[side] ?? SIDE_Y[0];
}
function getArrivalTime({ mode, phase, multiplier, side }) {
  const speedScale = getEffectiveSpeedScale({ mode, phase, multiplier });
  const distance = GAME.spawnY - getTargetY(side);
  return distance / (GAME.baseSpeed * speedScale);
}
function getTeleportTriggerY({ side }) {
  const targetY = getTargetY(side);
  const distance = GAME.spawnY - targetY;
  return GAME.spawnY - distance * GAME.teleportTriggerFraction;
}
function getMysteryTriggerY({ side }) {
  const targetY = getTargetY(side);
  const distance = GAME.spawnY - targetY;
  return GAME.spawnY - distance * GAME.mysteryTriggerFraction;
}
export { OVERLAP_SPEED_REDUCTIONS, SLOW_SPEED_MULTIPLIER, SPEED_BANDS, findBand, getArrivalTime, getBaseSpeedScale, getCampaignSpeedScale, getDifficultyProfile, getEffectiveSpeedScale, getEndlessMilestoneCount, getMaxActiveBatches, getMinimumDiskGap, getMysteryTriggerY, getOverlapSpawnDelay, getOverlapSpeedReduction, getOverlapWaitMultiplier, getPatternBand, getSpawnDelay, getSpeedBand, getSpeedCeiling, getTargetY, getTeleportTriggerY, isSafeSpawnGap, projectedGap };
