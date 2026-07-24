// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFinaleStart } from "../../src/js/campaign.js";
import { createInitialState, transitionState } from "../../src/js/state.js";
import {
  byId,
  createUi,
  formatDuration,
  getFailureLaneKey,
  getFailureReasonKey,
  getGameOverMessage,
  getGameOverPhase,
  getHudProgress,
  restartAnimation,
  setHidden
} from "../../src/js/ui.js";

const root = path.resolve(import.meta.dirname, "../..");
const screenNames = ["ready", "reset", "entry", "gameover", "pause", "extraction", "victory"];

function assembledMarkup() {
  let html = readFileSync(path.join(root, "src", "index.template.html"), "utf8")
    .replace("{{STYLES}}", "")
    .replace("{{SCRIPT}}", "");
  for (const name of screenNames) {
    html = html.replace(`{{SCREEN_${name.toUpperCase()}}}`, readFileSync(path.join(root, "src", "screens", `${name}.html`), "utf8"));
  }
  return html;
}

function installMarkup() {
  document.open();
  document.write(assembledMarkup());
  document.close();
}

function harness(initial = createInitialState()) {
  let current = initial;
  const dispatch = vi.fn((command) => {
    current = transitionState({ state: current, command });
    return current;
  });
  const store = { dispatch, getState: () => current, replace: (next) => { current = next; } };
  const audio = {
    getLevels: vi.fn(() => ({ music: 25, sfx: 25 })),
    handleGesture: vi.fn(),
    setMusicPercent: vi.fn(),
    setSfxPercent: vi.fn()
  };
  const renderer = { getPlayfieldCenterX: vi.fn(() => 123) };
  const ui = createUi({ store, audio, renderer });
  return { audio, dispatch, renderer, store, ui };
}

describe("UI pure presentation helpers", () => {
  beforeEach(installMarkup);

  it("gets elements and toggles hidden state", () => {
    const element = byId("ready-screen");
    expect(element).not.toBeNull();
    setHidden(element, true);
    expect(element.classList.contains("hidden")).toBe(true);
    setHidden(element, false);
    expect(element.classList.contains("hidden")).toBe(false);
  });

  it("formats durations and failure keys", () => {
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(-2)).toBe("00:00");
    expect(formatDuration(65.4)).toBe("01:05");
    expect(getFailureReasonKey("wrong-side")).toBe("failureWrongSide");
    expect(getFailureReasonKey("unknown")).toBe("failureMismatch");
    expect(getFailureLaneKey({ mode: "easy", lane: -1 })).toBe("laneUnknown");
    expect(getFailureLaneKey({ mode: "easy", lane: 0 })).toBe("left");
    expect(getFailureLaneKey({ mode: "hard", lane: 1 })).toBe("middle");
    expect(getFailureLaneKey({ mode: "easy", lane: 1 })).toBe("right");
    expect(getFailureLaneKey({ mode: "hard", lane: 2 })).toBe("right");
    expect(getFailureLaneKey({ mode: "hard", lane: 9 })).toBe("laneUnknown");
  });

  it("formats game-over messages and campaign/endless HUD progress", () => {
    const base = createInitialState();
    expect(getGameOverMessage({ ...base, gameOverVariables: {} })).toContain("wrong monster");
    expect(getGameOverMessage({ ...base, gameOverVariables: { color: "green", expectedSide: 0 } })).toContain("GREEN");
    expect(getGameOverMessage({ ...base, gameOverVariables: { color: "red", expectedSide: 1 } })).toContain("bottom");
    expect(getHudProgress(base).labelKey).toBe("phaseLabel");
    const finale = { ...base, completedBatches: getFinaleStart({ mode: "easy" }) };
    expect(getHudProgress(finale).labelKey).toBe("finalExtraction");
    expect(getGameOverPhase(finale)).toContain("·");
    expect(getGameOverPhase({ ...base, runType: "endless" })).toBe("1");
    const endless = { ...base, runType: "endless", phase: 25 };
    expect(getHudProgress(endless)).toMatchObject({ labelKey: "endlessPhase" });
  });

  it("restarts streak animation classes", () => {
    const element = document.createElement("div");
    element.className = "streak-reset";
    restartAnimation(element, "streak-increase");
    expect(element.classList.contains("streak-reset")).toBe(false);
    expect(element.classList.contains("streak-increase")).toBe(true);
  });
});

describe("full UI rendering and controls", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installMarkup();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders every status, mode, progress, record, and localized mobile state", () => {
    const test = harness();
    const base = {
      ...createInitialState({
        campaignBestByMode: { easy: 10, hard: 20 },
        endlessBestByMode: { easy: 30, hard: 40 },
        endlessUnlockedByMode: { easy: true, hard: false },
        fastestClearByMode: { easy: 65, hard: null },
        winsByMode: { easy: 2, hard: 0 }
      }),
      best: 10,
      gameOverReason: "catcher-flipping",
      gameOverVariables: { color: "red", expectedSide: 1, lane: 1 },
      longestStreak: 4,
      newRecord: true,
      pattern: "MIXED",
      runElapsedSeconds: 70,
      score: 9,
      streak: 3
    };
    for (const status of ["ready", "entering", "playing", "paused", "extraction", "gameover", "victory"]) {
      const current = { ...base, status };
      test.store.replace(current);
      test.ui.render(current);
      expect(byId("shell").dataset.state).toBe(status);
      expect(byId("score").textContent).toBe("9");
    }
    expect(byId("mobile-pause-button").getAttribute("aria-label")).toBe("Pause");
    test.ui.render({ ...base, status: "paused", language: "pt-BR", mode: "hard" });
    expect(document.documentElement.lang).toBe("pt-BR");
    expect(byId("mobile-pause-button").getAttribute("aria-label")).toBe("Continuar");
    expect(byId("mobile-pause-button").getAttribute("aria-pressed")).toBe("true");
    expect(byId("lane-label-middle").classList.contains("hidden")).toBe(false);
    expect(byId("new-record").classList.contains("hidden")).toBe(false);
    expect(byId("shell").style.getPropertyValue("--playfield-center-x")).toBe("123px");
    expect(byId("music-level-value").textContent).toBe("25%");
  });

  it("animates streak increase and reset and renders locked/unlocked run types", () => {
    const test = harness();
    const base = createInitialState();
    test.ui.render(base);
    test.ui.render({ ...base, streak: 2 });
    expect(byId("streak-card").classList.contains("streak-increase")).toBe(true);
    test.ui.render({ ...base, streak: 0 });
    expect(byId("streak-card").classList.contains("streak-reset")).toBe(true);
    expect(document.querySelector('[data-run-type="endless"]').disabled).toBe(true);
    test.ui.render({ ...base, endlessUnlockedByMode: { easy: true, hard: false }, runType: "endless" });
    expect(document.querySelector('[data-run-type="endless"]').disabled).toBe(false);
    expect(document.querySelector('[data-run-type="endless"]').classList.contains("selected")).toBe(true);
  });

  it("binds audio panels, sliders, language, mode, and run type", () => {
    const test = harness();
    byId("music-toggle").click();
    expect(byId("music-control").classList.contains("expanded")).toBe(true);
    expect(byId("music-toggle").getAttribute("aria-expanded")).toBe("true");
    byId("music-toggle").click();
    expect(byId("music-scale").getAttribute("aria-hidden")).toBe("true");
    byId("sfx-toggle").click();
    byId("music-level").value = "25";
    byId("music-level").dispatchEvent(new Event("input"));
    byId("sfx-level").value = "75";
    byId("sfx-level").dispatchEvent(new Event("input"));
    expect(test.audio.setMusicPercent).toHaveBeenCalledWith("25");
    expect(test.audio.setSfxPercent).toHaveBeenCalledWith("75");
    byId("language-button").click();
    document.querySelector('[data-mode-option="hard"]').click();
    document.querySelector('[data-run-type="campaign"]').click();
    expect(test.dispatch).toHaveBeenCalledWith({ type: "SET_LANGUAGE", language: "pt-BR" });
    expect(test.dispatch).toHaveBeenCalledWith({ type: "SELECT_MODE", mode: "hard" });
    expect(test.dispatch).toHaveBeenCalledWith({ type: "SELECT_RUN_TYPE", runType: "campaign" });
  });

  it("requires two confirmations before dispatching a stats reset", () => {
    const test = harness();
    byId("reset-stats-button").click();
    expect(byId("reset-screen").classList.contains("hidden")).toBe(false);
    expect(byId("reset-step-one").classList.contains("hidden")).toBe(false);
    byId("reset-continue-button").click();
    expect(byId("reset-step-one").classList.contains("hidden")).toBe(true);
    expect(byId("reset-step-two").classList.contains("hidden")).toBe(false);
    byId("reset-back-button").click();
    expect(byId("reset-step-one").classList.contains("hidden")).toBe(false);
    byId("reset-continue-button").click();
    byId("reset-confirm-button").click();
    expect(test.dispatch).toHaveBeenCalledWith({ type: "RESET_PROGRESS" });
    expect(byId("reset-screen").classList.contains("hidden")).toBe(true);
  });

  it("dispatches every navigation action and isolates mobile pause bubbling", () => {
    vi.spyOn(Date, "now").mockReturnValue(777);
    const test = harness({ ...createInitialState({ endlessUnlockedByMode: { easy: true, hard: true } }), status: "playing" });
    const bubbled = vi.fn();
    byId("shell").addEventListener("click", bubbled);
    for (const id of [
      "start-button", "restart-button", "main-menu-button", "resume-button",
      "replay-campaign-button", "start-endless-button", "switch-difficulty-button"
    ]) byId(id).click();
    byId("mobile-pause-button").click();
    expect(test.dispatch.mock.calls.map(([command]) => command.type)).toEqual(expect.arrayContaining([
      "BEGIN_RUN_TRANSITION", "START_RUN", "RETURN_TO_MENU", "RESUME", "PAUSE"
    ]));
    expect(bubbled).toHaveBeenCalledTimes(7);
    expect(test.audio.handleGesture).toHaveBeenCalledTimes(8);
  });

  it("shows translated toast and removes it on schedule", () => {
    const test = harness();
    test.ui.showToast("waveToast", { phase: 3 }, 0.5);
    expect(byId("toast").textContent).toContain("3");
    expect(byId("toast").classList.contains("show")).toBe(true);
    vi.advanceTimersByTime(500);
    expect(byId("toast").classList.contains("show")).toBe(false);
  });
});
