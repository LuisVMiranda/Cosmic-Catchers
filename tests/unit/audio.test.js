import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAudioController } from "../../src/js/audio.js";
import { createFakeAudioElements } from "../helpers/fake-media.js";

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  };
}

describe.each(["easy", "hard"])("exclusive game-over audio in %s mode", (mode) => {
  let elements;
  let state;
  let audio;

  beforeEach(() => {
    vi.useFakeTimers();
    elements = createFakeAudioElements();
    state = { status: "gameover", mode };
    vi.stubGlobal("window", {
      AudioContext: undefined,
      clearInterval,
      clearTimeout,
      localStorage: createStorage(),
      setInterval,
      setTimeout
    });
    audio = createAudioController({
      elements,
      storage: window.localStorage,
      getState: () => state
    });
  });

  afterEach(() => {
    audio.stopAll();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("never starts menu music while game-over audio is still playing", async () => {
    audio.handleStateChange(state, { type: "FAIL_RUN" });
    await vi.runAllTicks();
    expect(elements.gameOver.paused).toBe(false);
    expect(elements.menu.paused).toBe(true);

    audio.syncMusicToState({ state: { ...state, status: "ready" } });
    await vi.advanceTimersByTimeAsync(1000);

    expect(elements.gameOver.paused).toBe(false);
    expect(elements.menu.paused).toBe(true);
  });

  it("waits for game-over completion and the configured gap before starting menu music", async () => {
    audio.handleStateChange(state, { type: "FAIL_RUN" });
    await vi.runAllTicks();
    elements.gameOver.finish();

    await vi.advanceTimersByTimeAsync(999);
    expect(elements.menu.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(elements.gameOver.paused).toBe(true);
    expect(elements.menu.paused).toBe(false);
  });
});
