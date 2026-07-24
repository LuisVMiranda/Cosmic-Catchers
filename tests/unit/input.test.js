import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindInput, getFlipLane, handleFlipKey, handleKeydown, startOrFlip, togglePause } from "../../src/js/input.js";

let windowHandlers;
let documentHandlers;

function createHarness({ status = "playing", mode = "easy" } = {}) {
  const handlers = new Map();
  const state = { status, mode, runType: "campaign" };
  const store = {
    getState: () => state,
    dispatch: vi.fn((command) => {
      if (command.type === "PAUSE") state.status = "paused";
      if (command.type === "RESUME") state.status = "playing";
      return state;
    })
  };
  const canvas = { addEventListener: (type, handler) => handlers.set(type, handler) };
  const renderer = { pointerLane: vi.fn(() => 1), pointerCatcher: vi.fn(() => 0) };
  const audio = { handleGesture: vi.fn() };
  bindInput({ canvas, store, renderer, audio });
  return { audio, handlers, renderer, state, store };
}

function pointer(overrides = {}) {
  return {
    button: 0,
    clientX: 100,
    clientY: 500,
    isPrimary: true,
    pointerType: "touch",
    preventDefault: vi.fn(),
    ...overrides
  };
}

describe("input routing", () => {
  beforeEach(() => {
    windowHandlers = new Map();
    documentHandlers = new Map();
    vi.stubGlobal("window", { addEventListener: (type, handler) => windowHandlers.set(type, handler) });
    vi.stubGlobal("document", { addEventListener: (type, handler) => documentHandlers.set(type, handler), hidden: false });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("routes primary touch and pen input through catcher hit-testing", () => {
    for (const pointerType of ["touch", "pen"]) {
      const harness = createHarness();
      const event = pointer({ pointerType });
      harness.handlers.get("pointerdown")(event);
      expect(harness.renderer.pointerCatcher).toHaveBeenCalledWith(100, 500, "easy");
      expect(harness.store.dispatch).toHaveBeenCalledWith({ type: "FLIP_CATCHER", lane: 0 });
      expect(event.preventDefault).toHaveBeenCalled();
    }
  });

  it("ignores touch input outside catcher hit areas", () => {
    const harness = createHarness();
    harness.renderer.pointerCatcher.mockReturnValue(-1);
    harness.handlers.get("pointerdown")(pointer());
    expect(harness.store.dispatch).not.toHaveBeenCalled();
  });

  it("preserves lane-wide primary mouse input", () => {
    const harness = createHarness({ mode: "hard" });
    harness.handlers.get("pointerdown")(pointer({ pointerType: "mouse" }));
    expect(harness.renderer.pointerLane).toHaveBeenCalledWith(100, "hard");
    expect(harness.store.dispatch).toHaveBeenCalledWith({ type: "FLIP_CATCHER", lane: 1 });
  });

  it("ignores secondary mouse buttons and non-primary pointers", () => {
    const harness = createHarness();
    harness.handlers.get("pointerdown")(pointer({ pointerType: "mouse", button: 2 }));
    harness.handlers.get("pointerdown")(pointer({ isPrimary: false }));
    expect(harness.store.dispatch).not.toHaveBeenCalled();
  });

  it("maps keyboard lanes and toggles pause through the state store", () => {
    expect(getFlipLane("KeyA", "easy")).toBe(0);
    expect(getFlipLane("KeyS", "easy")).toBe(-1);
    expect(getFlipLane("KeyS", "hard")).toBe(1);
    expect(getFlipLane("ArrowRight", "hard")).toBe(2);
    const harness = createHarness();
    togglePause(harness.store);
    togglePause(harness.store);
    expect(harness.store.dispatch.mock.calls.map(([command]) => command.type)).toEqual(["PAUSE", "RESUME"]);
  });

  it("routes start, restart, victory replay, and playing flip actions", () => {
    vi.spyOn(Date, "now").mockReturnValue(50);
    for (const [status, type, runType] of [
      ["ready", "BEGIN_RUN_TRANSITION", "campaign"],
      ["gameover", "START_RUN", "endless"],
      ["victory", "START_RUN", "campaign"],
      ["playing", "FLIP_CATCHER", undefined]
    ]) {
      const state = { status, mode: "hard", runType: status === "gameover" ? "endless" : "campaign" };
      const store = { getState: () => state, dispatch: vi.fn() };
      startOrFlip(store, 2);
      expect(store.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type, ...(runType ? { runType } : {}) }));
    }
    const paused = { getState: () => ({ status: "paused" }), dispatch: vi.fn() };
    startOrFlip(paused, 0);
    togglePause({ getState: () => ({ status: "ready" }), dispatch: vi.fn() });
    expect(paused.dispatch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("guards and dispatches flip keys", () => {
    const store = { dispatch: vi.fn() };
    const invalid = { code: "KeyS", preventDefault: vi.fn() };
    handleFlipKey({ event: invalid, state: { status: "playing", mode: "easy" }, store });
    expect(store.dispatch).not.toHaveBeenCalled();
    const inactive = { code: "KeyA", preventDefault: vi.fn() };
    handleFlipKey({ event: inactive, state: { status: "paused", mode: "easy" }, store });
    expect(inactive.preventDefault).not.toHaveBeenCalled();
    const valid = { code: "ArrowDown", preventDefault: vi.fn() };
    handleFlipKey({ event: valid, state: { status: "playing", mode: "hard" }, store });
    expect(valid.preventDefault).toHaveBeenCalledOnce();
    expect(store.dispatch).toHaveBeenCalledWith({ type: "FLIP_CATCHER", lane: 1 });
  });

  it("handles repeat, pause, resume/start, and lane keydown branches", () => {
    const harness = createHarness({ status: "playing", mode: "hard" });
    const event = (code, values = {}) => ({ code, preventDefault: vi.fn(), repeat: false, ...values });
    handleKeydown({ event: event("KeyA", { repeat: true }), store: harness.store, audio: harness.audio });
    expect(harness.audio.handleGesture).not.toHaveBeenCalled();
    const pause = event("KeyP");
    handleKeydown({ event: pause, store: harness.store, audio: harness.audio });
    expect(pause.preventDefault).toHaveBeenCalled();
    const resume = event("Space");
    handleKeydown({ event: resume, store: harness.store, audio: harness.audio });
    expect(harness.store.dispatch).toHaveBeenCalledWith({ type: "RESUME" });
    harness.state.status = "ready";
    handleKeydown({ event: event("Enter"), store: harness.store, audio: harness.audio });
    expect(harness.store.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "BEGIN_RUN_TRANSITION" }));
    harness.state.status = "playing";
    handleKeydown({ event: event("KeyD"), store: harness.store, audio: harness.audio });
    expect(harness.store.dispatch).toHaveBeenCalledWith({ type: "FLIP_CATCHER", lane: 2 });
  });

  it("uses pointer start behavior and lifecycle pause/gesture listeners", () => {
    const ready = createHarness({ status: "ready" });
    ready.handlers.get("pointerdown")(pointer({ pointerType: "" }));
    expect(ready.store.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "BEGIN_RUN_TRANSITION" }));
    const playing = createHarness();
    windowHandlers.get("keydown")({ code: "KeyA", preventDefault: vi.fn(), repeat: false });
    expect(playing.store.dispatch).toHaveBeenCalledWith({ type: "FLIP_CATCHER", lane: 0 });
    windowHandlers.get("blur")();
    expect(playing.store.dispatch).toHaveBeenCalledWith({ type: "PAUSE" });
    playing.state.status = "playing";
    document.hidden = true;
    documentHandlers.get("visibilitychange")();
    expect(playing.store.dispatch).toHaveBeenCalledWith({ type: "PAUSE" });
    document.hidden = false;
    documentHandlers.get("visibilitychange")();
    windowHandlers.get("focus")();
    expect(playing.audio.handleGesture).toHaveBeenCalledTimes(3);
    playing.state.status = "paused";
    windowHandlers.get("blur")();
  });
});
