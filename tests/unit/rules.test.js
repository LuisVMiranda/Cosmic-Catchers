import { describe, expect, it } from "vitest";
import {
  getCampaignTarget,
  getFinaleProgress,
  getFinaleStart,
  isCampaignComplete,
  isCampaignSpawnAllowed,
  isFinalPhase
} from "../../src/js/campaign.js";
import { GAME, MODE_CONFIG, clamp, getModeConfig, lerp, normalizeMode } from "../../src/js/config.js";
import {
  findBand,
  getArrivalTime,
  getBaseSpeedScale,
  getCampaignSpeedScale,
  getDifficultyProfile,
  getEffectiveSpeedScale,
  getEndlessMilestoneCount,
  getMaxActiveBatches,
  getMinimumDiskGap,
  getOverlapSpawnDelay,
  getOverlapSpeedReduction,
  getOverlapWaitMultiplier,
  getPatternBand,
  getSpawnDelay,
  getSpeedBand,
  getSpeedCeiling,
  getTargetY,
  getTeleportTriggerY,
  isSafeSpawnGap,
  projectedGap
} from "../../src/js/difficulty.js";
import { getLaneCount, getLaneX, getViewBounds } from "../../src/js/world.js";

describe("configuration and world contracts", () => {
  it("normalizes modes and numeric helpers", () => {
    expect(getModeConfig("hard")).toBe(MODE_CONFIG.hard);
    expect(getModeConfig("unknown")).toBe(MODE_CONFIG.easy);
    expect(normalizeMode("hard")).toBe("hard");
    expect(normalizeMode("unknown")).toBe("easy");
    expect(clamp(-2, 0, 5)).toBe(0);
    expect(clamp(9, 0, 5)).toBe(5);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });

  it("maps view bounds and lanes at narrow and wide aspects", () => {
    expect(getLaneCount("easy")).toBe(2);
    expect(getLaneCount("hard")).toBe(3);
    const portrait = getViewBounds({ width: 0, height: 0 });
    const landscape = getViewBounds({ width: 1600, height: 800 });
    expect(portrait.halfWidth).toBeGreaterThanOrEqual(GAME.minimumViewHalfWidth);
    expect(landscape.halfWidth).toBe(16);
    expect(getLaneX({ index: 0, mode: "easy", halfWidth: 8 })).toBeLessThan(0);
    expect(getLaneX({ index: 1, mode: "easy", halfWidth: 8 })).toBeGreaterThan(0);
    expect(getLaneX({ index: 0, mode: "hard", halfWidth: 3 })).toBeLessThan(0);
    expect(getLaneX({ index: 1, mode: "hard", halfWidth: 3 })).toBe(0);
    expect(getLaneX({ index: 2, mode: "hard", halfWidth: 3 })).toBeGreaterThan(0);
  });
});

describe("campaign boundaries", () => {
  it.each(["easy", "hard"])("computes %s finale and target boundaries", (mode) => {
    const start = getFinaleStart({ mode });
    const target = getCampaignTarget({ mode });
    expect(getFinaleProgress({ mode, completedBatches: start - 1 })).toMatchObject({ active: false, current: 0, completed: 0 });
    expect(getFinaleProgress({ mode, completedBatches: start })).toMatchObject({ active: true, current: 1, completed: 0 });
    expect(getFinaleProgress({ mode, completedBatches: target + 50 }).completed).toBe(MODE_CONFIG[mode].finaleBatches);
    expect(isFinalPhase({ mode, phase: MODE_CONFIG[mode].phaseCap })).toBe(true);
  });

  it("allows endless, caps campaign spawns, and completes only an empty playing campaign", () => {
    const target = getCampaignTarget({ mode: "easy" });
    expect(isCampaignSpawnAllowed({ state: { runType: "endless" } })).toBe(true);
    expect(isCampaignSpawnAllowed({ state: { runType: "campaign", mode: "easy", completedBatches: target - 1, activeBatchIds: [] } })).toBe(true);
    expect(isCampaignSpawnAllowed({ state: { runType: "campaign", mode: "easy", completedBatches: target } })).toBe(false);
    expect(isCampaignSpawnAllowed({ state: { runType: "campaign", mode: "easy", completedBatches: target - 1, activeBatchIds: [1] } })).toBe(false);
    expect(isCampaignComplete({ state: { runType: "campaign", status: "playing", mode: "easy", completedBatches: target, activeBatchIds: [] } })).toBe(true);
    expect(isCampaignComplete({ state: { runType: "endless", status: "playing" } })).toBe(false);
    expect(isCampaignComplete({ state: { runType: "campaign", status: "paused", mode: "easy", completedBatches: target, activeBatchIds: [] } })).toBe(false);
  });
});

describe("difficulty bands and safety", () => {
  it("selects speed and pattern bands at boundaries", () => {
    expect(findBand([{ minPhase: 1, id: 1 }, { minPhase: 3, id: 3 }], 2).id).toBe(1);
    expect(getSpeedBand({ mode: "bad", phase: 1 }).maxOutliers).toBe(0);
    expect(getPatternBand({ phase: 1, mixed: false })).toBe("PAIR");
    expect(getPatternBand({ phase: 2, mixed: false })).toBe("SPLIT");
    expect(getPatternBand({ phase: 3, mixed: false })).toBe("SWAP");
    expect(getPatternBand({ phase: 4, mixed: true })).toBe("MIXED");
    expect(getPatternBand({ phase: 4, mixed: false })).toBe("RAPID");
  });

  it.each(["easy", "hard"])("caps %s campaign/endless speed and spawn cadence", (mode) => {
    const config = MODE_CONFIG[mode];
    expect(getEndlessMilestoneCount({ mode, phase: config.endlessHoldUntilPhase })).toBe(0);
    expect(getEndlessMilestoneCount({ mode, phase: config.endlessHoldUntilPhase + 1 })).toBe(1);
    expect(getCampaignSpeedScale({ mode, phase: -2 })).toBe(config.startSpeedScale);
    expect(getCampaignSpeedScale({ mode, phase: 999 })).toBe(config.speedCap);
    expect(getBaseSpeedScale({ mode, phase: config.phaseCap })).toBe(config.speedCap);
    expect(getSpeedCeiling({ mode, phase: 9999 })).toBe(config.endlessSpeedCap);
    expect(getEffectiveSpeedScale({ mode, phase: 9999, multiplier: 99 })).toBe(config.endlessSpeedCap);
    expect(getSpawnDelay({ mode, phase: 1 })).toBeGreaterThanOrEqual(GAME.minSpawnDelay);
    expect(getSpawnDelay({ mode, phase: 9999 })).toBe(config.endlessMinSpawnDelay);
    expect(getOverlapSpawnDelay({ mode, phase: 9999 })).toBeGreaterThanOrEqual(GAME.minSpawnDelay);
    expect(getMaxActiveBatches({ mode, phase: config.batchOverlapUnlockPhase - 1 })).toBe(1);
    expect(getMaxActiveBatches({ mode, phase: config.batchOverlapUnlockPhase })).toBe(GAME.maxActiveBatches);
    expect(getMaxActiveBatches({ mode, phase: config.lateOverlapPhase })).toBe(config.lateMaxActiveBatches);
    expect(getOverlapWaitMultiplier({ mode, phase: config.eventfulCadencePhase })).toBeLessThan(GAME.overlapSpawnGapMultiplier);
    expect(getDifficultyProfile({ mode, phase: 1 })).toMatchObject({ mode, phase: 1, lanes: config.lanes, patternBand: "PAIR" });
  });

  it("projects disk gaps including teleport waits", () => {
    const existing = { y: 2, targetY: -4, effectiveSpeedScale: 1, teleportWait: 1 };
    const safe = { y: 8.45, targetY: -4, effectiveSpeedScale: 1 };
    const unsafe = { y: 3, targetY: -4, effectiveSpeedScale: 2 };
    expect(getMinimumDiskGap()).toBe(GAME.diskDiameter * GAME.minimumDiskGapDiameters);
    expect(projectedGap({ existing, candidate: safe })).toBeLessThanOrEqual(safe.y - existing.y);
    expect(isSafeSpawnGap({ existing, candidate: safe })).toBe(false);
    expect(isSafeSpawnGap({ existing: { ...existing, y: -10, teleportWait: 0 }, candidate: safe })).toBe(true);
    expect(projectedGap({ existing, candidate: unsafe })).toBeLessThan(getMinimumDiskGap());
    expect(projectedGap({ existing: { ...existing, teleportWait: undefined }, candidate: { ...safe, y: undefined } })).toBeTypeOf("number");
  });

  it("keeps overlap, target, arrival, and teleport calculations deterministic", () => {
    const values = [0, 1, 2].map((seed) => getOverlapSpeedReduction({ mode: "easy", phase: 10, round: 5, seed }));
    expect(new Set(values).size).toBe(3);
    expect(getOverlapSpeedReduction({ mode: "hard", phase: 10, round: 5, seed: "bad" })).toBeGreaterThan(0);
    expect(getTargetY(99)).toBe(getTargetY(0));
    expect(getTargetY(1)).toBe(getTargetY(0));
    expect(getArrivalTime({ mode: "easy", phase: 1, multiplier: 1, side: 0 })).toBeGreaterThan(0);
    expect(getArrivalTime({ mode: "easy", phase: 1, multiplier: 1, side: 1 })).toBe(
      getArrivalTime({ mode: "easy", phase: 1, multiplier: 1, side: 0 })
    );
    expect(getTeleportTriggerY({ side: 1 })).toBe(getTeleportTriggerY({ side: 0 }));
    expect(getTeleportTriggerY({ side: 1 })).toBeGreaterThan(getTargetY(1));
  });
});
