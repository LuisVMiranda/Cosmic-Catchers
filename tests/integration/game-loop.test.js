import { describe, expect, it, vi } from "vitest";
import { createGameLoop } from "../../src/js/game-loop.js";
import { createInitialState, createStateStore } from "../../src/js/state.js";

function createLoop(status = "ready") {
  const initial = { ...createInitialState(), status, cooldown: 10 };
  const store = createStateStore(initial);
  const renderer = {
    createDisk: vi.fn(),
    removeDisk: vi.fn(),
    update: vi.fn(),
    render: vi.fn()
  };
  const effects = { update: vi.fn() };
  const audio = { playCollect: vi.fn() };
  const ui = { render: vi.fn() };
  const scheduled = [];
  const scheduler = {
    now: vi.fn(() => 1000),
    requestFrame: vi.fn((callback) => {
      scheduled.push(callback);
      return scheduled.length;
    }),
    cancelFrame: vi.fn()
  };
  const loop = createGameLoop({ store, renderer, effects, audio, ui, scheduler });
  return { audio, effects, loop, renderer, scheduled, scheduler, store, ui };
}

describe("deterministic game loop", () => {
  it.each(["ready", "paused", "gameover", "victory"])("renders but does not advance gameplay while %s", (status) => {
    const harness = createLoop(status);
    const before = harness.store.getState();
    harness.loop.step(0.04);
    expect(harness.store.getState()).toBe(before);
    expect(harness.renderer.update).toHaveBeenCalledOnce();
    expect(harness.effects.update).toHaveBeenCalledWith(0.04);
    expect(harness.ui.render).toHaveBeenCalledOnce();
  });

  it("advances entry, extraction, and playing time through their dedicated branches", () => {
    const entering = createLoop("entering");
    entering.store.replace({ ...entering.store.getState(), entryRemaining: 0.02, pendingRun: { mode: "easy", runType: "campaign", seed: 7 } });
    entering.loop.step(0.04);
    expect(entering.store.getState().status).toBe("playing");

    const extraction = createLoop("extraction");
    extraction.store.replace({ ...extraction.store.getState(), extractionRemaining: 0.02 });
    extraction.loop.step(0.04);
    expect(extraction.store.getState().status).toBe("playing");

    const playing = createLoop("playing");
    playing.loop.step(0.04);
    expect(playing.store.getState().runElapsedSeconds).toBe(0.04);
    expect(playing.store.getState().cooldown).toBeCloseTo(9.96);
  });

  it("starts once, clamps frame delta, renders, schedules the next frame, and stops cleanly", () => {
    const harness = createLoop("ready");
    harness.loop.start();
    harness.loop.start();
    expect(harness.scheduler.requestFrame).toHaveBeenCalledTimes(1);
    harness.scheduled[0](2000);
    expect(harness.renderer.update.mock.calls[0][0].delta).toBe(0.04);
    expect(harness.renderer.render).toHaveBeenCalledOnce();
    expect(harness.scheduler.requestFrame).toHaveBeenCalledTimes(2);
    harness.loop.stop();
    expect(harness.scheduler.cancelFrame).toHaveBeenCalledWith(2);
  });
});
