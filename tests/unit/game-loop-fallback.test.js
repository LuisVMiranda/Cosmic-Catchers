import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/js/patterns.js", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    createBatchPlan: vi.fn(() => ({ invalid: true })),
    createNormalBatchPlan: vi.fn((values) => ({ ...values, fallback: true })),
    validateBatchPlan: vi.fn(() => ({ valid: false }))
  };
});

import { nextPlan } from "../../src/js/game-loop.js";
import { createInitialState } from "../../src/js/state.js";

describe("plan generation fallback", () => {
  it("uses a normal plan after every generated candidate fails validation", () => {
    const state = { ...createInitialState(), phase: 3, round: 4, seed: 9 };
    expect(nextPlan(state)).toMatchObject({ fallback: true, round: 5, seed: 9 });
  });
});
