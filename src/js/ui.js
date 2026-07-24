import { getFinaleProgress, isFinalPhase } from "./campaign.js";
import { getBaseSpeedScale } from "./difficulty.js";
import { togglePause } from "./input.js";
import { localizeDocument, translate } from "./localization.js";

function byId(id) {
  return document.getElementById(id);
}
function setHidden(element, hidden) {
  element.classList.toggle("hidden", hidden);
}
function getGameOverMessage(state) {
  if (!Number.isInteger(state.gameOverVariables.expectedSide)) return translate(state.language, "mismatchDefault");
  const side = state.gameOverVariables.expectedSide === 0 ? "top" : "bottom";
  return translate(state.language, "mismatch", {
    color: translate(state.language, state.gameOverVariables.color || "red"),
    side: translate(state.language, side)
  });
}
var FAILURE_REASON_KEYS = Object.freeze({
  "wrong-side": "failureWrongSide",
  "catcher-flipping": "failureCatcherFlipping",
  "invalid-lane": "failureInvalidLane",
  mismatch: "failureMismatch"
});
function getFailureReasonKey(reason) {
  return FAILURE_REASON_KEYS[reason] || "failureMismatch";
}
function getFailureLaneKey({ mode, lane }) {
  if (!Number.isInteger(lane) || lane < 0) return "laneUnknown";
  if (lane === 0) return "left";
  if (mode === "hard" && lane === 1) return "middle";
  const rightLane = mode === "hard" ? 2 : 1;
  return lane === rightLane ? "right" : "laneUnknown";
}
function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "\u2014";
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
function getHudProgress(state) {
  const speed = getBaseSpeedScale({ mode: state.mode, phase: state.phase }).toFixed(1);
  const finale = getFinaleProgress({ mode: state.mode, completedBatches: state.completedBatches });
  if (state.runType === "campaign" && finale.active) {
    return { value: `${finale.current} / ${finale.total}`, labelKey: "finalExtraction" };
  }
  if (state.runType === "endless" && isFinalPhase({ mode: state.mode, phase: state.phase })) {
    return { value: `\u221E ${state.phase} / ${speed}x`, labelKey: "endlessPhase" };
  }
  return { value: `${state.phase} / ${speed}x`, labelKey: "phaseLabel" };
}
function getGameOverPhase(state) {
  const finale = getFinaleProgress({ mode: state.mode, completedBatches: state.completedBatches });
  if (state.runType !== "campaign" || !finale.active) return String(state.phase);
  return `${state.phase} \xB7 ${finale.completed}/${finale.total}`;
}
function restartAnimation(element, className) {
  element.classList.remove("streak-increase", "streak-reset");
  void element.offsetWidth;
  element.classList.add(className);
}
function createUi({ store: store2, audio: audio2, renderer: renderer2 }) {
  const elements = {
    shell: byId("shell"),
    score: byId("score"),
    best: byId("best"),
    phase: byId("phase"),
    phaseLabel: byId("phase-label"),
    pattern: byId("pattern"),
    streak: byId("streak"),
    streakCard: byId("streak-card"),
    bestLabel: byId("best-label"),
    ready: byId("ready-screen"),
    entering: byId("entry-screen"),
    gameover: byId("gameover-screen"),
    pause: byId("pause-screen"),
    extraction: byId("extraction-screen"),
    victory: byId("victory-screen"),
    extractionCountdown: byId("extraction-countdown"),
    readyIntro: byId("ready-intro"),
    readyNote: byId("ready-note"),
    gameoverMessage: byId("gameover-message"),
    finalScore: byId("final-score"),
    finalBest: byId("final-best"),
    finalPhase: byId("final-phase"),
    finalLongestStreak: byId("final-longest-streak"),
    finalFailureLane: byId("final-failure-lane"),
    finalFailureReason: byId("final-failure-reason"),
    newRecord: byId("new-record"),
    toast: byId("toast"),
    language: byId("language-button"),
    leftLabel: byId("lane-label-left"),
    middleLabel: byId("lane-label-middle"),
    rightLabel: byId("lane-label-right"),
    mainMenu: byId("main-menu-button"),
    runTypeNote: byId("run-type-note"),
    victoryIntro: byId("victory-intro"),
    victoryMode: byId("victory-mode"),
    victoryScore: byId("victory-score"),
    victoryBest: byId("victory-best"),
    victoryPhase: byId("victory-phase"),
    victoryTime: byId("victory-time"),
    victoryFastest: byId("victory-fastest"),
    victoryStreak: byId("victory-streak"),
    victoryWins: byId("victory-wins"),
    help: byId("help"),
    musicControl: byId("music-control"),
    sfxControl: byId("sfx-control"),
    musicToggle: byId("music-toggle"),
    sfxToggle: byId("sfx-toggle"),
    musicScale: byId("music-scale"),
    sfxScale: byId("sfx-scale"),
    musicLevel: byId("music-level"),
      sfxLevel: byId("sfx-level"),
      musicValue: byId("music-level-value"),
      sfxValue: byId("sfx-level-value"),
      mobilePause: byId("mobile-pause-button")
  };
  let localizedLanguage = "";
  let toastTimer = 0;
  let renderedStreak = 0;
  function renderLocalization(state) {
    if (localizedLanguage === state.language) return;
    localizedLanguage = state.language;
    localizeDocument(state.language);
    elements.language.textContent = state.language === "en" ? "PT" : "EN";
    elements.language.setAttribute("aria-label", translate(state.language, state.language === "en" ? "switchToPt" : "switchToEn"));
  }
  function renderHud(state) {
    elements.score.textContent = String(state.score);
    elements.best.textContent = String(state.best);
    const modeName = translate(state.language, state.mode === "hard" ? "modeHard" : "modeEasy");
    const bestKey = state.runType === "endless" ? "endlessBestLabel" : "campaignBestLabel";
    elements.bestLabel.textContent = `${translate(state.language, bestKey)} / ${modeName}`;
    renderHudProgress(state);
    elements.pattern.textContent = translate(state.language, `pattern${state.pattern.charAt(0)}${state.pattern.slice(1).toLowerCase()}`);
    elements.pattern.classList.toggle("mixed-speed", state.pattern === "MIXED");
    elements.streak.textContent = `\xD7${state.streak}`;
    if (state.streak > renderedStreak) restartAnimation(elements.streakCard, "streak-increase");
    if (state.streak < renderedStreak) restartAnimation(elements.streakCard, "streak-reset");
    renderedStreak = state.streak;
  }
  function renderHudProgress(state) {
    const progress2 = getHudProgress(state);
    elements.phase.textContent = progress2.value;
    elements.phaseLabel.textContent = translate(state.language, progress2.labelKey);
  }
  function renderOverlayPosition(state) {
    const centerX = renderer2.getPlayfieldCenterX(state.mode);
    elements.shell.style.setProperty("--playfield-center-x", `${centerX}px`);
  }
  function renderScreens(state) {
    setHidden(elements.ready, state.status !== "ready");
    setHidden(elements.entering, state.status !== "entering");
    setHidden(elements.gameover, state.status !== "gameover");
    setHidden(elements.pause, state.status !== "paused");
    setHidden(elements.extraction, state.status !== "extraction");
    setHidden(elements.victory, state.status !== "victory");
    const finale = getFinaleProgress({ mode: state.mode, completedBatches: state.completedBatches });
    elements.extractionCountdown.textContent = translate(state.language, "extractionRemaining", { count: finale.total });
    elements.readyIntro.textContent = translate(state.language, state.mode === "hard" ? "readyIntroHard" : "readyIntroEasy");
    elements.readyNote.textContent = translate(state.language, state.mode === "hard" ? "readyNoteHard" : "readyNoteEasy");
    elements.gameoverMessage.textContent = getGameOverMessage(state);
    elements.finalScore.textContent = String(state.score);
    elements.finalBest.textContent = String(state.best);
    elements.finalPhase.textContent = getGameOverPhase(state);
    elements.finalLongestStreak.textContent = `\xD7${state.longestStreak}`;
    const failureLaneKey = getFailureLaneKey({ mode: state.mode, lane: state.gameOverVariables.lane });
    elements.finalFailureLane.textContent = translate(state.language, failureLaneKey);
    elements.finalFailureReason.textContent = translate(state.language, getFailureReasonKey(state.gameOverReason));
    setHidden(elements.newRecord, !state.newRecord);
    document.querySelectorAll("[data-mode-option]").forEach((button) => {
      button.classList.toggle("selected", button.dataset.modeOption === state.mode);
    });
    const hard = state.mode === "hard";
    elements.shell.dataset.mode = state.mode;
    elements.leftLabel.textContent = translate(state.language, "laneLeft");
    elements.middleLabel.textContent = translate(state.language, "laneMiddle");
    elements.rightLabel.textContent = translate(state.language, hard ? "laneRightHard" : "laneRightEasy");
    setHidden(elements.middleLabel, !hard);
    elements.help.textContent = translate(state.language, hard ? "helpHard" : "helpEasy") || elements.help.textContent;
    renderRunTypes(state);
    renderVictory(state);
  }
  function renderRunTypes(state) {
    const unlocked = Boolean(state.endlessUnlockedByMode[state.mode]);
    document.querySelectorAll("[data-run-type]").forEach((button) => {
      const endless = button.dataset.runType === "endless";
      button.disabled = endless && !unlocked;
      button.classList.toggle("selected", button.dataset.runType === state.runType);
    });
    const mode = translate(state.language, state.mode === "hard" ? "modeHard" : "modeEasy");
    const key = unlocked ? "endlessUnlocked" : "endlessLocked";
    elements.runTypeNote.textContent = translate(state.language, key, { mode });
  }
  function renderVictory(state) {
    const mode = translate(state.language, state.mode === "hard" ? "modeHard" : "modeEasy");
    elements.victoryIntro.textContent = translate(state.language, "victoryIntro", { mode });
    elements.victoryMode.textContent = mode;
    elements.victoryScore.textContent = String(state.score);
    elements.victoryBest.textContent = String(state.campaignBestByMode[state.mode]);
    elements.victoryPhase.textContent = String(state.phase);
    elements.victoryTime.textContent = formatDuration(state.runElapsedSeconds);
    elements.victoryFastest.textContent = formatDuration(state.fastestClearByMode[state.mode]);
    elements.victoryStreak.textContent = `\xD7${state.longestStreak}`;
    elements.victoryWins.textContent = String(state.winsByMode[state.mode]);
  }
    function renderAudio() {
    const levels = audio2.getLevels();
    elements.musicLevel.value = String(levels.music);
    elements.sfxLevel.value = String(levels.sfx);
    elements.musicValue.textContent = `${levels.music}%`;
    elements.sfxValue.textContent = `${levels.sfx}%`;
    elements.musicLevel.setAttribute("aria-valuetext", `${levels.music}%`);
      elements.sfxLevel.setAttribute("aria-valuetext", `${levels.sfx}%`);
    }
    function renderMobilePause(state) {
      const paused = state.status === "paused";
      const label = translate(state.language, paused ? "mobileResume" : "mobilePause");
      elements.mobilePause.querySelector("span").textContent = paused ? "▶" : "Ⅱ";
      elements.mobilePause.setAttribute("aria-label", label);
      elements.mobilePause.setAttribute("aria-pressed", String(paused));
      elements.mobilePause.title = label;
    }
    function render(state) {
    renderLocalization(state);
    renderOverlayPosition(state);
    renderHud(state);
      renderScreens(state);
      renderAudio();
      renderMobilePause(state);
      elements.shell.dataset.state = state.status;
  }
  function showToast(key, variables = {}, duration = 0.8) {
    window.clearTimeout(toastTimer);
    const state = store2.getState();
    elements.toast.textContent = translate(state.language, key, variables);
    elements.toast.classList.add("show");
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), duration * 1e3);
  }
  function bindAudioPanel(control, toggle, scale, channel) {
    toggle.addEventListener("click", () => {
      audio2.handleGesture();
      const expanded = !control.classList.contains("expanded");
      control.classList.toggle("expanded", expanded);
      toggle.setAttribute("aria-expanded", String(expanded));
      scale.setAttribute("aria-hidden", String(!expanded));
    });
    return channel;
  }
  bindAudioPanel(elements.musicControl, elements.musicToggle, elements.musicScale, "music");
  bindAudioPanel(elements.sfxControl, elements.sfxToggle, elements.sfxScale, "sfx");
  elements.musicLevel.addEventListener("input", () => {
    audio2.handleGesture();
    audio2.setMusicPercent(elements.musicLevel.value);
  });
  elements.sfxLevel.addEventListener("input", () => {
    audio2.handleGesture();
    audio2.setSfxPercent(elements.sfxLevel.value);
  });
  elements.language.addEventListener("click", () => {
    audio2.handleGesture();
    const language = store2.getState().language === "en" ? "pt-BR" : "en";
    store2.dispatch({ type: "SET_LANGUAGE", language });
  });
  document.querySelectorAll("[data-mode-option]").forEach((button) => {
    button.addEventListener("click", () => {
      audio2.handleGesture();
      store2.dispatch({ type: "SELECT_MODE", mode: button.dataset.modeOption });
    });
  });
  document.querySelectorAll("[data-run-type]").forEach((button) => {
    button.addEventListener("click", () => {
      audio2.handleGesture();
      store2.dispatch({ type: "SELECT_RUN_TYPE", runType: button.dataset.runType });
    });
  });
  byId("start-button").addEventListener("click", () => {
    audio2.handleGesture();
    const state = store2.getState();
    store2.dispatch({ type: "BEGIN_RUN_TRANSITION", mode: state.mode, runType: state.runType, seed: Date.now() });
  });
  byId("restart-button").addEventListener("click", () => {
    audio2.handleGesture();
    const state = store2.getState();
    store2.dispatch({ type: "START_RUN", mode: state.mode, runType: state.runType, seed: Date.now() });
  });
  elements.mainMenu.addEventListener("click", () => {
    audio2.handleGesture();
    store2.dispatch({ type: "RETURN_TO_MENU" });
  });
    byId("resume-button").addEventListener("click", () => {
    audio2.handleGesture();
      store2.dispatch({ type: "RESUME" });
    });
    elements.mobilePause.addEventListener("click", (event) => {
      event.stopPropagation();
      audio2.handleGesture();
      togglePause(store2);
    });
  byId("replay-campaign-button").addEventListener("click", () => {
    audio2.handleGesture();
    store2.dispatch({ type: "START_RUN", mode: store2.getState().mode, runType: "campaign", seed: Date.now() });
  });
  byId("start-endless-button").addEventListener("click", () => {
    audio2.handleGesture();
    store2.dispatch({ type: "START_RUN", mode: store2.getState().mode, runType: "endless", seed: Date.now() });
  });
  byId("switch-difficulty-button").addEventListener("click", () => {
    audio2.handleGesture();
    const mode = store2.getState().mode === "hard" ? "easy" : "hard";
    store2.dispatch({ type: "START_RUN", mode, runType: "campaign", seed: Date.now() });
  });
  return { elements, render, showToast };
}
export { FAILURE_REASON_KEYS, byId, createUi, formatDuration, getFailureLaneKey, getFailureReasonKey, getGameOverMessage, getGameOverPhase, getHudProgress, restartAnimation, setHidden };
