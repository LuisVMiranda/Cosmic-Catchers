import { getLaneCount } from "./world.js";

function togglePause(store2) {
  const status = store2.getState().status;
  if (status === "playing") store2.dispatch({ type: "PAUSE" });
  else if (status === "paused") store2.dispatch({ type: "RESUME" });
}
function startOrFlip(store2, lane) {
  const state = store2.getState();
  if (state.status === "victory") {
    store2.dispatch({ type: "START_RUN", mode: state.mode, runType: "campaign", seed: Date.now() });
    return;
  }
  if (state.status === "ready") {
    store2.dispatch({ type: "BEGIN_RUN_TRANSITION", mode: state.mode, runType: state.runType, seed: Date.now() });
    return;
  }
  if (state.status === "gameover") {
    store2.dispatch({ type: "START_RUN", mode: state.mode, runType: state.runType, seed: Date.now() });
    return;
  }
  if (state.status === "playing") store2.dispatch({ type: "FLIP_CATCHER", lane });
}
function getFlipLane(code, mode) {
  const laneByCode = {
    KeyA: 0,
    ArrowLeft: 0,
    KeyD: getLaneCount(mode) - 1,
    ArrowRight: getLaneCount(mode) - 1
  };
  if (code === "KeyS" || code === "ArrowDown") return mode === "hard" ? 1 : -1;
  return laneByCode[code] ?? -1;
}
function handleFlipKey({ event, state, store: store2 }) {
  if (state.status !== "playing") return;
  const lane = getFlipLane(event.code, state.mode);
  if (lane < 0) return;
  event.preventDefault();
  store2.dispatch({ type: "FLIP_CATCHER", lane });
}
function handleKeydown({ event, store: store2, audio: audio2 }) {
  if (event.repeat) return;
  audio2.handleGesture();
  if (event.code === "KeyP") {
    event.preventDefault();
    togglePause(store2);
    return;
  }
  if (event.code === "Space" || event.code === "Enter") {
    event.preventDefault();
    const state = store2.getState();
    if (state.status === "paused") store2.dispatch({ type: "RESUME" });
    else startOrFlip(store2, 0);
    return;
  }
  handleFlipKey({ event, state: store2.getState(), store: store2 });
}
function bindInput({ canvas, store: store2, renderer: renderer2, audio: audio2 }) {
  canvas.addEventListener("pointerdown", (event) => {
    if (event.isPrimary === false) return;
    if ((event.pointerType || "mouse") === "mouse" && event.button !== 0) return;
    audio2.handleGesture();
    const state = store2.getState();
    if (state.status !== "playing") {
      startOrFlip(store2, 0);
      return;
    }
    const touchLike = event.pointerType === "touch" || event.pointerType === "pen";
    if (touchLike) event.preventDefault();
    const lane = touchLike
      ? renderer2.pointerCatcher(event.clientX, event.clientY, state.mode)
      : renderer2.pointerLane(event.clientX, state.mode);
    if (lane < 0) return;
    store2.dispatch({ type: "FLIP_CATCHER", lane });
  });
  window.addEventListener("keydown", (event) => handleKeydown({ event, store: store2, audio: audio2 }));
  window.addEventListener("blur", () => {
    if (store2.getState().status === "playing") store2.dispatch({ type: "PAUSE" });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && store2.getState().status === "playing") store2.dispatch({ type: "PAUSE" });
    else audio2.handleGesture();
  });
  window.addEventListener("focus", () => audio2.handleGesture());
}
export { bindInput, getFlipLane, handleFlipKey, handleKeydown, startOrFlip, togglePause };
