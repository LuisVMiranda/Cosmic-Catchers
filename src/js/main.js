import { createAudioController } from "./audio.js";
import { GAME, STORAGE_KEYS } from "./config.js";
import { createEffects } from "./effects.js";
import { createGameLoop } from "./game-loop.js";
import { bindInput } from "./input.js";
import { translate } from "./localization.js";
import { clearProgress, loadProgress, saveProgress } from "./persistence.js";
import { createRenderer } from "./renderer.js";
import { createInitialState, createStateStore } from "./state.js";
import { createUi } from "./ui.js";

function readStorage(key, fallback) {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function getAudioElements() {
  return {
    menu: document.getElementById("menu-music"),
    game: document.getElementById("game-music"),
    resume: document.getElementById("resume-start-sound"),
    gameOver: document.getElementById("game-over-sound"),
    winning: document.getElementById("winning-sound"),
    collect: [...document.querySelectorAll("[data-collect-sound]")]
  };
}
function sideKey(lane, mode) {
  if (lane === 0) return "left";
  if (lane === 1 && mode === "hard") return "middle";
  return "right";
}
function persistPreferences({ state, previous }) {
  if (state.mode !== previous.mode || state.language !== previous.language) {
    try {
      window.localStorage.setItem(STORAGE_KEYS.mode, state.mode);
      window.localStorage.setItem(STORAGE_KEYS.language, state.language);
    } catch {
      // Preference persistence is best-effort for direct-file browser contexts.
    }
  }
}
function syncAudio({ state, previous, command, audio: audio2 }) {
  if (state.status === "gameover" && previous.status !== "gameover") {
    audio2.handleStateChange(state, { type: "FAIL_RUN" });
    return;
  }
  if (state.status === "playing" && previous.status === "entering") {
    audio2.handleStateChange(state, { type: "START_RUN" });
    return;
  }
  audio2.handleStateChange(state, command);
}
function handleFlipEffect({ state, command, ui: ui2, audio: audio2 }) {
  if (command.type !== "FLIP_CATCHER" || state.status !== "playing") return;
  const side = translate(state.language, sideKey(command.lane, state.mode));
  const colorKey = state.catchers[command.lane]?.toSide === 0 ? "green" : "red";
  const color = translate(state.language, colorKey);
  ui2.showToast("flipToast", { side, color });
  audio2.beep(300 + command.lane * 90, 0.14, "triangle", 0.045);
}
function handleCollectEffect({ state, previous, command, ui: ui2 }) {
  if (command.type !== "COLLECT_DISK" || state.score <= previous.score || state.status !== "playing") return;
  ui2.showToast("collectedToast", { color: translate(state.language, command.color) }, 0.65);
}
function handlePhaseEffect({ state, previous, ui: ui2, audio: audio2 }) {
  if (state.phase <= previous.phase) return;
  ui2.showToast("waveToast", { phase: state.phase }, 1.25);
  audio2.beep(660 + state.phase * 25, 0.15, "triangle", 0.045);
}
function handleStartEffect({ state, previous, command, ui: ui2, audio: audio2 }) {
  const enteredField = state.status === "playing" && previous.status === "entering";
  if (command.type !== "START_RUN" && !enteredField) return;
  ui2.showToast(state.mode === "hard" ? "readyToastHard" : "readyToastEasy", {}, 1.2);
  audio2.beep(430, 0.1, "triangle", 0.035);
}
function syncVictoryEffects({ state, previous, effects: effects2 }) {
  if (state.status === "victory" && previous.status !== "victory") effects2.startVictoryFireworks();
  if (state.status !== "victory" && previous.status === "victory") effects2.stopVictoryFireworks();
}
function attachStateEffects({ state, previous, command, ui: ui2, audio: audio2, effects: effects2 }) {
  persistPreferences({ state, previous });
  if (command.type === "RESET_PROGRESS") clearProgress(window.localStorage);
  else saveProgress({ storage: window.localStorage, state, previous });
  syncAudio({ state, previous, command, audio: audio2 });
  syncVictoryEffects({ state, previous, effects: effects2 });
  handleFlipEffect({ state, command, ui: ui2, audio: audio2 });
  handleCollectEffect({ state, previous, command, ui: ui2 });
  handlePhaseEffect({ state, previous, ui: ui2, audio: audio2 });
  handleStartEffect({ state, previous, command, ui: ui2, audio: audio2 });
}
var initialMode = readStorage(STORAGE_KEYS.mode, GAME.defaultMode);
var initialLanguage = readStorage(STORAGE_KEYS.language, GAME.defaultLanguage);
var ui;
var audio;
var store;
var effects;
var progress = loadProgress(window.localStorage);
var initialState = createInitialState({
  mode: initialMode,
  language: initialLanguage,
  ...progress
});
store = createStateStore(initialState, (state, command, previous) => {
  if (ui) ui.render(state);
  if (audio && effects) attachStateEffects({ state, previous, command, ui, audio, effects });
});
audio = createAudioController({
  elements: getAudioElements(),
  getState: () => store.getState()
});
var renderer = createRenderer({
  canvas: document.getElementById("game-canvas"),
  getState: () => store.getState(),
  getText: (key) => translate(store.getState().language, key)
});
effects = createEffects({ group: renderer.effects });
ui = createUi({ store, audio, renderer });
var loop = createGameLoop({ store, renderer, effects, audio, ui });
bindInput({
  canvas: document.getElementById("game-canvas"),
  store,
  renderer,
  audio
});
ui.render(store.getState());
audio.startInitialMenu();
loop.start();

if (__COSMIC_TEST__) {
  window.__COSMIC_TEST__ = Object.freeze({ audio, effects, loop, renderer, store, ui });
}
export { attachStateEffects, audio, effects, getAudioElements, handleCollectEffect, handleFlipEffect, handlePhaseEffect, handleStartEffect, initialLanguage, initialMode, initialState, loop, persistPreferences, progress, readStorage, renderer, sideKey, store, syncAudio, syncVictoryEffects, ui };
