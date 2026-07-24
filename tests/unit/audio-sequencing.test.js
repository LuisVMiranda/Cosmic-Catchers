import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAudioController,
  makeTone,
  normalizePercent,
  readStored,
  readVolume,
  requestPlay,
  safePlay,
  safeStop,
  saveVolumes
} from "../../src/js/audio.js";
import { GAME } from "../../src/js/config.js";
import { createFakeAudioElements, FakeMediaTrack } from "../helpers/fake-media.js";

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  };
}

function fakeDocument() {
  const target = new EventTarget();
  return {
    addEventListener: target.addEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    removeEventListener: target.removeEventListener.bind(target)
  };
}

class DeferredPlayTrack extends FakeMediaTrack {
  constructor(options) {
    super(options);
    this.pendingPlays = [];
  }

  play() {
    this.ended = false;
    this.playCount += 1;
    return new Promise((resolve) => {
      this.pendingPlays.push(() => {
        this.paused = false;
        resolve();
      });
    });
  }

  resolveNextPlay() {
    this.pendingPlays.shift()?.();
  }
}

describe("audio utilities", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { clearInterval, clearTimeout, setInterval, setTimeout });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("normalizes modern, legacy, malformed, and inaccessible volume storage", () => {
    expect(normalizePercent(101)).toBe(100);
    expect(normalizePercent(-2)).toBe(0);
    expect(normalizePercent("40.6")).toBe(41);
    expect(normalizePercent("bad", 7)).toBe(7);
    expect(readVolume(memoryStorage({ "cosmic-catchers-volume": '{"music":2}' }), "music", 9)).toBe(40);
    expect(readVolume(memoryStorage({ "cosmic-catchers-volume": '{"volumeVersion":2,"music":67}' }), "music", 9)).toBe(67);
    expect(readVolume(memoryStorage({ "cosmic-catchers-volume": "{" }), "music", 9)).toBe(9);
    const blocked = { getItem: () => { throw new Error("blocked"); } };
    expect(readStored(blocked, "x", "fallback")).toBe("fallback");
  });

  it("stops, plays, and saves defensively", () => {
    const track = new FakeMediaTrack();
    safeStop(track);
    expect(track.currentTime).toBe(0);
    expect(safePlay(track)).toBeInstanceOf(Promise);
    expect(() => safeStop(null)).not.toThrow();
    expect(safePlay(null)).toBeNull();
    expect(safePlay({ play: () => { throw new Error("blocked"); } })).toBeNull();
    expect(() => safeStop({ pause() {}, set currentTime(_value) { throw new Error("metadata"); } })).not.toThrow();
    const storage = memoryStorage();
    saveVolumes(storage, 20, 30);
    expect(JSON.parse(storage.values.get("cosmic-catchers-volume"))).toMatchObject({ music: 20, sfx: 30, volumeVersion: 2 });
    expect(() => saveVolumes({ setItem: () => { throw new Error("readonly"); } }, 1, 1)).not.toThrow();
  });

  it("retries requested playback and observes guards and callbacks", async () => {
    const track = new FakeMediaTrack();
    track.paused = true;
    const played = vi.fn();
    requestPlay(track, () => true, vi.fn(), played);
    await vi.runAllTicks();
    expect(played).toHaveBeenCalledOnce();
    const guarded = new FakeMediaTrack();
    requestPlay(guarded, () => false, vi.fn(), played);
    expect(guarded.playCount).toBe(0);
    const rejected = new FakeMediaTrack();
    rejected.play = () => Promise.reject(new Error("policy"));
    const onRejected = vi.fn();
    requestPlay(rejected, () => true, onRejected);
    await vi.runAllTicks();
    expect(onRejected).toHaveBeenCalledOnce();
    const synchronous = {
      addEventListener: vi.fn(),
      paused: true,
      play: () => { throw new Error("synchronous policy"); }
    };
    const syncRejected = vi.fn();
    requestPlay(synchronous, undefined, syncRejected);
    expect(syncRejected).toHaveBeenCalledOnce();
    const legacy = {
      addEventListener: vi.fn(),
      paused: true,
      play() { this.paused = false; }
    };
    const legacyPlayed = vi.fn();
    requestPlay(legacy, undefined, undefined, legacyPlayed);
    expect(legacyPlayed).toHaveBeenCalledOnce();
    rejected.dispatchEvent(new Event("canplay"));
    await vi.advanceTimersByTimeAsync(GAME.audioStartupRetryDelay);
    expect(onRejected).toHaveBeenCalledOnce();
  });

  it("builds and skips Web Audio tones", () => {
    const oscillator = { connect: vi.fn(), frequency: {}, start: vi.fn(), stop: vi.fn(), type: "" };
    const gain = {
      connect: vi.fn(),
      gain: { exponentialRampToValueAtTime: vi.fn(), setValueAtTime: vi.fn() }
    };
    const context = {
      createGain: () => gain,
      createOscillator: () => oscillator,
      currentTime: 2,
      destination: {}
    };
    makeTone(context, 440, 0.2, undefined, 0.5);
    expect(oscillator.type).toBe("sine");
    expect(oscillator.start).toHaveBeenCalledOnce();
    expect(oscillator.stop).toHaveBeenCalledWith(2.2);
    expect(() => makeTone(null, 1, 1, "sine", 1)).not.toThrow();
    expect(() => makeTone(context, 1, 1, "sine", 0)).not.toThrow();
  });
});

describe("audio controller sequencing", () => {
  let state;
  let elements;
  let storage;
  let audio;

  beforeEach(() => {
    vi.useFakeTimers();
    state = { status: "ready", mode: "easy" };
    elements = createFakeAudioElements();
    storage = memoryStorage();
    vi.stubGlobal("document", fakeDocument());
    vi.stubGlobal("window", {
      AudioContext: undefined,
      clearInterval,
      clearTimeout,
      localStorage: storage,
      setInterval,
      setTimeout,
      webkitAudioContext: undefined
    });
    audio = createAudioController({ elements, storage, getState: () => state });
  });

  afterEach(() => {
    audio.stopAll();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts, unmutes, and reuses initial menu playback only in ready", async () => {
    audio.startInitialMenu();
    expect(elements.menu.paused).toBe(false);
    expect(elements.menu.muted).toBe(true);
    audio.startInitialMenu();
    await vi.advanceTimersByTimeAsync(GAME.initialMenuDelay);
    expect(elements.menu.muted).toBe(false);
    state = { status: "playing", mode: "easy" };
    audio.startInitialMenu();
    expect(elements.menu.playCount).toBeGreaterThanOrEqual(2);
  });

  it("starts new players at the calmer 25 percent defaults", () => {
    expect(audio.getLevels()).toEqual({ music: 25, sfx: 25 });
    audio.init();
    expect(elements.menu.volume).toBe(0.25);
    expect(elements.collect[0].volume).toBe(0.25);
  });

  it("persists and applies music and SFX levels", () => {
    audio.setMusicPercent(90);
    audio.setSfxPercent(25);
    expect(audio.getLevels()).toEqual({ music: 90, sfx: 25 });
    expect(audio.musicVolume()).toBe(0.8);
    expect(audio.sfxVolume()).toBe(0.25);
    expect(elements.menu.volume).toBe(0.8);
    expect(elements.collect[0].volume).toBe(0.25);
    expect(JSON.parse(storage.values.get("cosmic-catchers-volume"))).toMatchObject({ music: 90, sfx: 25 });
  });

  it("alternates collection tracks and respects zero SFX", async () => {
    audio.playCollect();
    audio.playCollect();
    await vi.runAllTicks();
    expect(elements.collect.map((track) => track.playCount)).toEqual([1, 1]);
    audio.setSfxPercent(0);
    audio.playCollect();
    expect(elements.collect.map((track) => track.playCount)).toEqual([1, 1]);
  });

  it("sequences start, pause, resume, extraction, and menu commands", async () => {
    state = { status: "entering", mode: "easy" };
    audio.handleStateChange(state, { type: "START_RUN" });
    expect(elements.resume.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(elements.game.paused).toBe(false);
    state = { status: "paused", mode: "easy" };
    audio.handleStateChange(state, { type: "PAUSE" });
    await vi.advanceTimersByTimeAsync(GAME.musicTransitionDelay);
    expect(elements.menu.paused).toBe(false);
    state = { status: "playing", mode: "easy" };
    audio.handleStateChange(state, { type: "RESUME" });
    await vi.advanceTimersByTimeAsync(300);
    expect(elements.game.paused).toBe(false);
    state = { status: "extraction", mode: "easy" };
    audio.syncMusicToState({ state, immediate: true });
    expect(elements.game.paused).toBe(false);
    state = { status: "ready", mode: "easy" };
    audio.handleStateChange(state, { type: "RETURN_TO_MENU" });
    expect(elements.menu.paused).toBe(false);
  });

  it("blocks gesture recovery and all menu requests throughout game over", async () => {
    state = { status: "gameover", mode: "easy" };
    audio.handleStateChange(state, { type: "FAIL_RUN" });
    audio.handleGesture();
    audio.syncMusicToState({ state: { status: "ready", mode: "easy" }, immediate: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(elements.gameOver.paused).toBe(false);
    expect(elements.menu.paused).toBe(true);
  });

  it("cancels a stale menu play that resolves after game over starts", async () => {
    elements.menu = new DeferredPlayTrack({ duration: 191 });
    audio = createAudioController({ elements, storage, getState: () => state });
    audio.startInitialMenu();
    expect(elements.menu.playCount).toBe(1);

    state = { status: "gameover", mode: "easy" };
    audio.handleStateChange(state, { type: "FAIL_RUN" });
    expect(elements.gameOver.paused).toBe(false);
    expect(elements.menu.paused).toBe(true);

    elements.menu.resolveNextPlay();
    await vi.runAllTicks();

    expect(elements.menu.paused).toBe(true);
    expect(elements.gameOver.paused).toBe(false);
  });

  it("cancels stale game-over playback that resolves after returning to menu", async () => {
    elements.gameOver = new DeferredPlayTrack({ duration: 3 });
    audio = createAudioController({ elements, storage, getState: () => state });
    state = { status: "gameover", mode: "easy" };
    audio.handleStateChange(state, { type: "FAIL_RUN" });

    state = { status: "ready", mode: "easy" };
    audio.handleStateChange(state, { type: "RETURN_TO_MENU" });
    expect(elements.menu.paused).toBe(false);
    expect(elements.gameOver.paused).toBe(true);

    elements.gameOver.resolveNextPlay();
    await vi.runAllTicks();

    expect(elements.gameOver.paused).toBe(true);
    expect(elements.menu.paused).toBe(false);
  });

  it("cancels stale gameplay and resume starts after game over takes ownership", async () => {
    elements.game = new DeferredPlayTrack({ duration: 144 });
    elements.resume = new DeferredPlayTrack({ duration: 2 });
    audio = createAudioController({ elements, storage, getState: () => state });
    state = { status: "entering", mode: "easy" };
    audio.handleStateChange(state, { type: "START_RUN" });
    await vi.advanceTimersByTimeAsync(300);

    state = { status: "gameover", mode: "easy" };
    audio.handleStateChange(state, { type: "FAIL_RUN" });
    elements.game.resolveNextPlay();
    elements.resume.resolveNextPlay();
    await vi.runAllTicks();

    expect(elements.gameOver.paused).toBe(false);
    expect(elements.game.paused).toBe(true);
    expect(elements.resume.paused).toBe(true);
  });

  it("keeps menu paused through a fast second death", async () => {
    state = { status: "gameover", mode: "easy" };
    audio.handleStateChange(state, { type: "FAIL_RUN" });
    elements.gameOver.finish();
    await vi.advanceTimersByTimeAsync(GAME.gameOverMusicDelay);
    expect(elements.menu.paused).toBe(false);

    state = { status: "playing", mode: "easy" };
    audio.handleStateChange(state, { type: "START_RUN" });
    await vi.advanceTimersByTimeAsync(50);
    state = { status: "gameover", mode: "easy" };
    audio.handleStateChange(state, { type: "FAIL_RUN" });

    expect(elements.menu.paused).toBe(true);
    expect(elements.game.paused).toBe(true);
    expect(elements.gameOver.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(elements.menu.paused).toBe(true);
  });

  it("preserves the game-over/menu exclusion invariant over 1,000 delayed races", async () => {
    const assertExclusive = (tracks) => {
      expect(tracks.gameOver.paused || tracks.menu.paused).toBe(true);
      if (!tracks.gameOver.paused) {
        expect([tracks.menu, tracks.game, tracks.resume, tracks.winning].every((track) => track.paused)).toBe(true);
      }
    };
    for (let seed = 1; seed <= 1000; seed += 1) {
      elements = createFakeAudioElements();
      state = { status: "ready", mode: seed % 2 ? "easy" : "hard" };
      if (seed % 3 === 0) elements.menu = new DeferredPlayTrack({ duration: 191 });
      if (seed % 3 === 1) elements.gameOver = new DeferredPlayTrack({ duration: 3 });
      audio = createAudioController({ elements, storage, getState: () => state });

      if (seed % 3 === 0) audio.startInitialMenu();
      state = { ...state, status: "gameover" };
      audio.handleStateChange(state, { type: "FAIL_RUN" });
      if (seed % 5 === 0) audio.handleStateChange(state, { type: "FAIL_RUN" });
      if (seed % 7 === 0) audio.handleGesture();

      if (elements.menu instanceof DeferredPlayTrack) elements.menu.resolveNextPlay();
      if (elements.gameOver instanceof DeferredPlayTrack) {
        state = { ...state, status: "ready" };
        audio.handleStateChange(state, { type: "RETURN_TO_MENU" });
        elements.gameOver.resolveNextPlay();
      }
      await vi.runAllTicks();
      assertExclusive(elements);
      audio.stopAll();
    }
  });

  it("uses paused/ended watchdog completion and delays menu by one second", async () => {
    state = { status: "gameover", mode: "easy" };
    audio.handleStateChange(state, { type: "FAIL_RUN" });
    elements.gameOver.pause();
    await vi.advanceTimersByTimeAsync(1249);
    expect(elements.menu.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(elements.gameOver.currentTime).toBe(0);
    expect(elements.menu.paused).toBe(false);
  });

  it("hard-stops a missing ended event at 15 seconds before continuing", async () => {
    state = { status: "gameover", mode: "hard" };
    audio.handleStateChange(state, { type: "FAIL_RUN" });
    await vi.advanceTimersByTimeAsync(14999);
    expect(elements.gameOver.paused).toBe(false);
    expect(elements.menu.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(1001);
    expect(elements.gameOver.paused).toBe(true);
    expect(elements.menu.paused).toBe(false);
  });

  it("handles rejected game-over playback without overlap", async () => {
    elements.gameOver.play = () => Promise.reject(new Error("policy"));
    state = { status: "gameover", mode: "easy" };
    audio.handleStateChange(state, { type: "FAIL_RUN" });
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(1250);
    expect(elements.gameOver.paused).toBe(true);
    expect(elements.menu.paused).toBe(false);
  });

  it("makes repeated failure and simultaneous completion idempotent", async () => {
    state = { status: "gameover", mode: "easy" };
    audio.handleStateChange(state, { type: "FAIL_RUN" });
    audio.handleStateChange(state, { type: "FAIL_RUN" });
    expect(elements.gameOver.playCount).toBe(1);
    elements.gameOver.finish();
    elements.gameOver.dispatchEvent(new Event("ended"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(elements.menu.playCount).toBe(1);
  });

  it("cancels game-over before explicit restart or main menu", async () => {
    state = { status: "gameover", mode: "easy" };
    audio.handleStateChange(state, { type: "FAIL_RUN" });
    state = { status: "entering", mode: "easy" };
    audio.handleStateChange(state, { type: "START_RUN" });
    expect(elements.gameOver.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(elements.game.paused).toBe(false);
    state = { status: "ready", mode: "easy" };
    audio.handleStateChange(state, { type: "RETURN_TO_MENU" });
    expect(elements.gameOver.paused).toBe(true);
    expect(elements.menu.paused).toBe(false);
  });

  it("plays victory until ended or fallback duration, then menu", async () => {
    state = { status: "victory", mode: "easy" };
    audio.handleStateChange(state, { type: "COMPLETE_RUN" });
    expect(elements.winning.paused).toBe(false);
    expect(elements.menu.paused).toBe(true);
    elements.winning.finish();
    elements.winning.finish();
    await vi.advanceTimersByTimeAsync(GAME.victoryMenuDelay - 1);
    expect(elements.menu.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(elements.menu.paused).toBe(false);
    expect(elements.menu.playCount).toBe(1);
    state = { status: "victory", mode: "hard" };
    elements.winning.duration = Number.NaN;
    audio.playVictory();
    await vi.advanceTimersByTimeAsync(GAME.winningFallbackDuration + 100 + GAME.victoryMenuDelay);
    expect(elements.winning.paused).toBe(true);
  });

  it.each([
    ["gameover", "FAIL_RUN", "gameOver", GAME.gameOverMusicDelay],
    ["victory", "COMPLETE_RUN", "winning", GAME.victoryMenuDelay]
  ])("keeps menu playback continuous when returning from %s", async (status, command, oneShot, delay) => {
    state = { status, mode: "easy" };
    audio.handleStateChange(state, { type: command });
    elements[oneShot].finish();
    await vi.advanceTimersByTimeAsync(delay);
    expect(elements.menu.paused).toBe(false);
    elements.menu.currentTime = 42;
    const playCount = elements.menu.playCount;
    state = { status: "ready", mode: "easy" };
    audio.handleStateChange(state, { type: "RETURN_TO_MENU" });
    expect(elements.menu.currentTime).toBe(42);
    expect(elements.menu.playCount).toBe(playCount);
    expect(elements.menu.paused).toBe(false);
  });

  it("creates, resumes, and uses an AudioContext for beep", async () => {
    const resume = vi.fn(() => Promise.resolve());
    const oscillator = { connect() {}, frequency: {}, start: vi.fn(), stop: vi.fn() };
    const gain = { connect() {}, gain: { exponentialRampToValueAtTime() {}, setValueAtTime() {} } };
    class Context {
      constructor() {
        this.currentTime = 0;
        this.destination = {};
        this.state = "suspended";
      }
      createGain() { return gain; }
      createOscillator() { return oscillator; }
      resume() { return resume(); }
    }
    window.AudioContext = Context;
    audio.beep(440, 0.1, "triangle", 0.1);
    await vi.runAllTicks();
    expect(resume).toHaveBeenCalledOnce();
    expect(oscillator.start).toHaveBeenCalledOnce();
  });

  it("recovers rejected menu autoplay through installed gesture listeners", async () => {
    let plays = 0;
    elements.menu.play = () => {
      plays += 1;
      elements.menu.paused = false;
      if (plays === 2) {
        elements.menu.paused = true;
        return Promise.reject(new Error("gesture required"));
      }
      return Promise.resolve();
    };
    audio.startInitialMenu();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(GAME.initialMenuDelay);
    document.dispatchEvent(new Event("pointerdown"));
    await vi.runAllTicks();
    expect(plays).toBeGreaterThanOrEqual(3);
    expect(elements.menu.paused).toBe(false);
    audio.handleGesture();
    await vi.runAllTicks();
    expect(elements.menu.muted).toBe(false);
  });

  it("recovers a rejection from the initial continuous menu request", async () => {
    let plays = 0;
    elements.menu.play = () => {
      plays += 1;
      elements.menu.paused = plays === 1;
      return plays === 1 ? Promise.reject(new Error("autoplay")) : Promise.resolve();
    };
    audio.startInitialMenu();
    await vi.runAllTicks();
    expect(plays).toBeGreaterThanOrEqual(2);
    expect(elements.menu.muted).toBe(true);
    document.dispatchEvent(new Event("keydown"));
    await vi.runAllTicks();
    expect(elements.menu.paused).toBe(false);
  });

  it("covers missing tracks, zero music, rejected collection, and constructor failure", async () => {
    elements.collect[0].play = () => Promise.reject(new Error("sfx blocked"));
    audio.playCollect();
    await vi.runAllTicks();
    audio.setMusicPercent(0);
    state = { status: "entering", mode: "easy" };
    audio.handleStateChange(state, { type: "START_RUN" });
    expect(elements.resume.playCount).toBe(0);

    const sparse = createAudioController({
      elements: { collect: [], game: null, gameOver: null, menu: null, resume: null, winning: null },
      storage,
      getState: () => ({ status: "ready" })
    });
    sparse.startInitialMenu();
    sparse.handleGesture();
    sparse.handleStateChange({ status: "ready" }, { type: "NOOP" });
    sparse.stopAll();

    window.AudioContext = class { constructor() { throw new Error("unsupported"); } };
    const failingContext = createAudioController({ elements: createFakeAudioElements(), storage, getState: () => state });
    expect(() => failingContext.init()).not.toThrow();
    failingContext.stopAll();
  });

  it("replays a paused current track immediately and drains queued menu outside gameover", async () => {
    state = { status: "playing", mode: "easy" };
    audio.syncMusicToState({ state, immediate: true });
    elements.game.pause();
    audio.syncMusicToState({ state, immediate: true });
    await vi.runAllTicks();
    expect(elements.game.paused).toBe(false);

    state = { status: "gameover", mode: "easy" };
    audio.handleStateChange(state, { type: "FAIL_RUN" });
    audio.syncMusicToState({ state: { status: "ready", mode: "easy" }, immediate: true });
    state = { status: "ready", mode: "easy" };
    elements.gameOver.finish();
    await vi.runAllTicks();
    expect(elements.menu.paused).toBe(false);
  });
});
