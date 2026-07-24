import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { nextPlan } from "../../src/js/game-loop.js";
import { validateBatchPlan } from "../../src/js/patterns.js";

describe("generated batch plans", () => {
  it("preserves plan invariants across modes, phases, rounds, and seeds", () => {
    fc.assert(fc.property(
      fc.constantFrom("easy", "hard"),
      fc.integer({ min: 1, max: 100 }),
      fc.integer({ min: 0, max: 500 }),
      fc.integer({ min: 0, max: 0xffffffff }),
      (mode, phase, round, seed) => {
        const plan = nextPlan({
          mode,
          phase,
          round,
          seed,
          consecutiveHalfSpeedBatches: 0,
          recentColorPatterns: []
        });
        const validation = validateBatchPlan({ plan, mode, phase });
        expect(validation.valid, validation.reasons.join(", ")).toBe(true);
        expect(plan.colors).toHaveLength(mode === "hard" ? 3 : 2);
        expect(plan.effectiveSpeedScales.every((speed) => Number.isFinite(speed) && speed > 0)).toBe(true);
      }
    ), { numRuns: 1000, seed: 20260722 });
  });
});

