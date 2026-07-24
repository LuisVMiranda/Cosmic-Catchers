import { describe, expect, it } from "vitest";
import { MODE_CONFIG } from "../../src/js/config.js";
import {
  buildMultipliers,
  choosePattern,
  colorSignature,
  createBatchPlan,
  createMysteryDisk,
  createNormalBatchPlan,
  createRng,
  createSpecialDisk,
  getArrivalTimes,
  getMysteryChance,
  hasSlowOutlier,
  hashSeed,
  isValidLane,
  isValidTeleportLanePair,
  normalizePlanArrays,
  patternFromIndex,
  randomColors,
  targetSide,
  validateBatchPlan,
  validateColorSides,
  validateReactionTimes,
  validateRecoveryMetadata,
  validateShape,
  validateSpecialDisk
} from "../../src/js/patterns.js";

describe("pattern generation branches", () => {
  it("is deterministic and maps colors and indexes", () => {
    expect(hashSeed(1, "easy", 2, 3)).toBe(hashSeed(1, "easy", 2, 3));
    const first = createRng(42);
    const second = createRng(42);
    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
    expect(colorSignature(["green", "red"])).toBe("green-red");
    expect(patternFromIndex(2, 2)).toEqual(["green", "red"]);
    expect(randomColors({ laneCount: 2, rng: () => 0 })).toEqual(["green", "green"]);
    expect(targetSide("green")).toBe(0);
    expect(targetSide("red")).toBe(1);
  });

  it("avoids the two recent signatures and exercises deterministic fallback", () => {
    let calls = 0;
    const alternating = () => (calls++ % 2 ? 0.99 : 0);
    const chosen = choosePattern({ laneCount: 2, rng: alternating, recentColorPatterns: ["green-red", "red-green"] });
    expect(["green-green", "red-red"]).toContain(colorSignature(chosen));
    const all = ["green-green", "red-green", "green-red", "red-red"];
    expect(choosePattern({ laneCount: 2, rng: () => 0, recentColorPatterns: all })).toEqual(["green", "green"]);
    expect(choosePattern({ laneCount: 1, rng: () => 0, recentColorPatterns: ["green", "red"] })).toEqual(["green"]);
  });

  it("creates teleport disks only on unlocked scheduled multi-lane rounds", () => {
    expect(createSpecialDisk({ mode: "easy", phase: 1, round: 3, seed: 0, laneCount: 2 })).toBeNull();
    expect(createSpecialDisk({ mode: "hard", phase: 10, round: 1, seed: 0, laneCount: 3 })).toBeNull();
    expect(createSpecialDisk({ mode: "hard", phase: 10, round: 2, seed: -4, laneCount: 1 })).toBeNull();
    const special = createSpecialDisk({ mode: "hard", phase: 10, round: 2, seed: -4, laneCount: 3 });
    expect(special.lane).not.toBe(special.targetLane);
  });

  it("unlocks mystery disks per mode and increases their deterministic frequency", () => {
    expect(getMysteryChance({ mode: "hard", phase: 5 })).toBe(0);
    expect(getMysteryChance({ mode: "hard", phase: 6 })).toBe(0.06);
    expect(getMysteryChance({ mode: "hard", phase: 12 })).toBeGreaterThan(getMysteryChance({ mode: "hard", phase: 6 }));
    expect(getMysteryChance({ mode: "easy", phase: 8 })).toBe(0);
    expect(getMysteryChance({ mode: "easy", phase: 9 })).toBe(0.06);
    expect(getMysteryChance({ mode: "easy", phase: 99 })).toBe(0.18);
    expect(createMysteryDisk({ mode: "hard", phase: 5, round: 1, seed: 6, laneCount: 3 })).toBeNull();
    expect(createMysteryDisk({ mode: "hard", phase: 6, round: 1, seed: 6, laneCount: 3 })).toMatchObject({
      type: "mystery",
      lane: 1,
      triggerFraction: 0.5
    });
  });

  it("covers regular, slow, fast recovery, and multiple-outlier bands", () => {
    const args = { round: 1, seed: 0, rng: () => 0.9 };
    expect(buildMultipliers({ ...args, mode: "easy", phase: 1, laneCount: 2 })).toEqual([1, 1]);
    expect(hasSlowOutlier(buildMultipliers({ ...args, mode: "easy", phase: 13, laneCount: 2 }))).toBe(true);
    expect(hasSlowOutlier(buildMultipliers({ ...args, mode: "hard", phase: 24, laneCount: 3 }))).toBe(true);
    const recovery = buildMultipliers({ ...args, mode: "hard", phase: 24, laneCount: 3, forceHalfSpeedRecovery: true });
    expect(recovery.some((value) => value > 1)).toBe(true);
    expect(recovery.some((value) => value < 1)).toBe(false);
  });

  it("creates valid regular, teleport, recovery, and fallback plans", () => {
    const base = { mode: "hard", phase: 24, round: 2, seed: 7, laneCount: 3 };
    const plan = createBatchPlan(base);
    expect(plan.patternId).toBe("TELEPORT");
    expect(validateBatchPlan({ plan, mode: "hard", phase: 24 }).valid).toBe(true);
    const recovery = createBatchPlan({ ...base, round: 3, forceHalfSpeedRecovery: true });
    expect(recovery.recoveryBatch).toBe(true);
    const fallback = createNormalBatchPlan({ ...base, phase: 99, overlapSpeedReduction: 0.45 });
    expect(fallback).toMatchObject({ fallback: true, phase: 99, hasHalfSpeed: false, specialDisk: null });
  });
});

describe("pattern validation negative paths", () => {
  it("normalizes missing arrays and reports every shape mismatch", () => {
    const arrays = normalizePlanArrays({});
    expect(arrays).toEqual({ colors: [], targetSides: [], speedMultipliers: [], effectiveScales: [] });
    const reasons = [];
    validateShape({ arrays: { colors: ["green"], targetSides: [], speedMultipliers: [], effectiveScales: [] }, config: MODE_CONFIG.easy, reasons });
    expect(reasons).toEqual(["lane-count", "target-count", "speed-count", "effective-speed-count"]);
  });

  it("reports invalid speed, caps, sides, reaction time, and metadata once", () => {
    const valid = createBatchPlan({ mode: "easy", phase: 13, round: 1, seed: 1, laneCount: 2 });
    const broken = {
      ...valid,
      colors: ["green", "red"],
      targetSides: [1, 0],
      speedMultipliers: [9, 9],
      effectiveSpeedScales: [999, -1],
      overlapSpeedReduction: 0.2,
      hasHalfSpeed: true,
      recoveryBatch: true
    };
    const result = validateBatchPlan({ plan: broken, mode: "easy", phase: 13 });
    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      "outlier-count", "speed-band", "overlap-speed-reduction",
      "speed-cap", "speed-cap-mismatch", "color-side", "half-speed-metadata"
    ]));
    const reactionReasons = [];
    validateReactionTimes({ arrivalTimes: [0.1], minimum: 1, reasons: reactionReasons });
    expect(reactionReasons).toEqual(["reaction-window"]);
    const duplicateFast = {
      ...valid,
      speedMultipliers: [1.1, 1.1],
      effectiveSpeedScales: [2.86, 2.86]
    };
    expect(validateBatchPlan({ plan: duplicateFast, mode: "easy", phase: 13 }).reasons).toContain("maximum-fast-count");
  });

  it("reports missing outliers and invalid teleport metadata", () => {
    const plan = createBatchPlan({ mode: "hard", phase: 24, round: 2, seed: 2, laneCount: 3 });
    const effective = getArrivalTimes({
      arrays: { speedMultipliers: [1], targetSides: [0] },
      mode: "hard",
      phase: 24,
      overlapSpeedReduction: 1
    });
    expect(effective[0]).toBeGreaterThan(0);
    const broken = {
      ...plan,
      speedMultipliers: [1, 1, 1],
      effectiveSpeedScales: [4, 4, 4],
      hasHalfSpeed: false,
      fallback: true,
      specialDisk: { lane: -1, targetLane: 3, triggerFraction: 0, stopDuration: 0 }
    };
    const result = validateBatchPlan({ plan: broken, mode: "hard", phase: 1 });
    expect(result.reasons).toEqual(expect.arrayContaining([
      "teleport-lane", "teleport-trigger", "teleport-duration", "teleport-early", "teleport-fallback"
    ]));
  });

  it("validates mystery metadata and phase boundaries", () => {
    const plan = createBatchPlan({ mode: "hard", phase: 6, round: 1, seed: 6, laneCount: 3 });
    expect(plan.patternId).toBe("MYSTERY");
    expect(plan.specialDisk).toMatchObject({ type: "mystery", lane: 1 });
    expect(validateBatchPlan({ plan, mode: "hard", phase: 6 }).valid).toBe(true);
    const reasons = [];
    validateSpecialDisk({
      specialDisk: { type: "mystery", lane: -1, triggerFraction: 0, morphDuration: 0, flickerRate: 0 },
      config: MODE_CONFIG.easy,
      phase: 1,
      plan: { fallback: true },
      reasons
    });
    expect(reasons).toEqual(expect.arrayContaining(["mystery-lane", "mystery-trigger", "mystery-duration", "mystery-flicker-rate", "mystery-early", "mystery-fallback"]));
  });

  it("validates lane pairs and isolated helper branches", () => {
    expect(isValidLane(0, 2)).toBe(true);
    expect(isValidLane(0.5, 2)).toBe(false);
    expect(isValidLane(-1, 2)).toBe(false);
    expect(isValidLane(2, 2)).toBe(false);
    expect(isValidTeleportLanePair({ lane: 0, targetLane: 1 }, 2)).toBe(true);
    expect(isValidTeleportLanePair({ lane: 0, targetLane: 0 }, 2)).toBe(false);
    expect(isValidTeleportLanePair({ lane: 0, targetLane: 2 }, 2)).toBe(false);
    const colorReasons = [];
    validateColorSides({ colors: ["green"], targetSides: [1], reasons: colorReasons });
    expect(colorReasons).toEqual(["color-side"]);
    const recoveryReasons = [];
    validateRecoveryMetadata({ plan: { hasHalfSpeed: false, recoveryBatch: true }, arrays: { speedMultipliers: [0.5] }, reasons: recoveryReasons });
    expect(recoveryReasons).toEqual(["half-speed-metadata", "recovery-half-speed", "recovery-not-mixed"]);
    const specialReasons = [];
    validateSpecialDisk({ specialDisk: null, config: MODE_CONFIG.easy, phase: 1, plan: {}, reasons: specialReasons });
    expect(specialReasons).toEqual([]);
  });
});
