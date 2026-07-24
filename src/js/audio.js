import { GAME } from "./config.js";

var AUTOPLAY_RECOVERY_EVENTS = Object.freeze(["pointerdown", "keydown", "touchstart"]);
var LEGACY_PERCENT = Object.freeze({
  music: Object.freeze({ 0: 0, 1: 20, 2: 40, 3: 80 }),
  sfx: Object.freeze({ 0: 0, 1: 25, 2: 55, 3: 90 })
});
var EXCLUSIVE_WATCHDOG_INTERVAL = 250;
var EXCLUSIVE_HARD_STOP_MS = 15e3;
function normalizePercent(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(100, Math.max(0, Math.round(numeric))) : fallback;
}
function readStored(storage, key, fallback) {
  try {
    return storage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function readVolume(storage, channel, fallback) {
  try {
    const stored = JSON.parse(readStored(storage, "cosmic-catchers-volume", "{}"));
    let value = stored[channel];
    const legacy = LEGACY_PERCENT[channel];
    const index = Number(value);
    if (stored.volumeVersion !== GAME.volumeVersion && Number.isInteger(index) && legacy[index] !== void 0) {
      value = legacy[index];
    }
    return normalizePercent(value, fallback);
  } catch {
    return fallback;
  }
}
function saveVolumes(storage, music, sfx) {
  try {
    storage.setItem("cosmic-catchers-volume", JSON.stringify({
      volumeVersion: GAME.volumeVersion,
      music,
      sfx
    }));
  } catch {
    // Volume persistence is best-effort for direct-file browser contexts.
  }
}
function safeStop(track) {
  if (!track) return;
  track.pause();
  try {
    track.currentTime = 0;
  } catch {
    // Some media implementations expose currentTime as read-only until metadata loads.
  }
}
function safePlay(track) {
  if (!track) return null;
  try {
    return track.play();
  } catch {
    // Media playback can throw synchronously when browser policy blocks it.
    return null;
  }
}
function requestPlay(track, guard = () => true, onRejected = () => {
}, onPlayed = () => {
}, onResolved = () => {
}) {
  let attemptInFlight = false;
  let rejectionHandled = false;
  const handleRejection = () => {
    attemptInFlight = false;
    if (rejectionHandled || !guard()) return;
    rejectionHandled = true;
    onRejected();
  };
  const handleResolution = () => {
    attemptInFlight = false;
    onResolved();
    if (guard()) onPlayed();
  };
  const play = () => {
    if (!guard() || attemptInFlight) return;
    const result = safePlay(track);
    if (result?.then) {
      attemptInFlight = true;
      result.then(handleResolution, handleRejection);
    } else if (result === null && track?.paused) {
      handleRejection();
    } else if (!track?.paused) {
      handleResolution();
    }
  };
  track?.addEventListener?.("canplay", play, { once: true });
  play();
  if (track?.paused) {
    window.setTimeout(() => {
      if (track.paused) play();
    }, GAME.audioStartupRetryDelay);
  }
}
function makeTone(context, frequency, duration, type, volume) {
  if (!context || !volume) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type || "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(1e-4, context.currentTime + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration);
}
function createAudioController({ elements, storage = window.localStorage, getState }) {
  const tracks = elements;
  let musicPercent = readVolume(storage, "music", GAME.defaultMusicPercent);
  let sfxPercent = readVolume(storage, "sfx", GAME.defaultSfxPercent);
  let currentMode = "";
  let transitionTimer = null;
  let gameOverTimer = null;
  let gameOverEndedHandler = null;
  let initialTimer = null;
  let victoryTimer = null;
  let victoryEndedHandler = null;
  let transitionToken = 0;
  let collectIndex = 0;
  let context = null;
  let autoplayBlockedMode = "";
  let autoplayRecoveryInstalled = false;
  let autoplayUnlocking = false;
  let activeExclusiveTrack = null;
  let exclusiveStartedAt = 0;
  let queuedContinuous = null;
  let gameOverSequenceActive = false;
  const allowedOneShots = new Set();
  const musicVolume = () => Math.min(musicPercent / 100, GAME.musicCap);
  const sfxVolume = () => Math.min(sfxPercent / 100, GAME.sfxCap);
  function updateVolumes() {
    [tracks.menu, tracks.game, tracks.resume, tracks.gameOver, tracks.winning].forEach((track) => {
      if (track) track.volume = musicVolume();
    });
    tracks.collect.forEach((track) => {
      track.volume = sfxVolume();
    });
  }
  function init() {
    if (!context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        try {
          context = new AudioContext();
        } catch {
          context = null;
        }
      }
    }
    updateVolumes();
    if (context?.state === "suspended") context.resume().catch(() => {
    });
  }
  function cancelTimer(timer) {
    if (timer) window.clearTimeout(timer);
    return null;
  }
  function cancelRepeater(timer) {
    if (timer) window.clearInterval(timer);
    return null;
  }
  function detachEndedHandler(track, handler) {
    if (handler) track?.removeEventListener?.("ended", handler);
    return null;
  }
  function clearTimers() {
    transitionToken += 1;
    transitionTimer = cancelTimer(transitionTimer);
    gameOverTimer = cancelRepeater(gameOverTimer);
    initialTimer = cancelTimer(initialTimer);
    victoryTimer = cancelTimer(victoryTimer);
    gameOverEndedHandler = detachEndedHandler(tracks.gameOver, gameOverEndedHandler);
    victoryEndedHandler = detachEndedHandler(tracks.winning, victoryEndedHandler);
  }
  function removeAutoplayRecovery() {
    if (!autoplayRecoveryInstalled || typeof document === "undefined") return;
    AUTOPLAY_RECOVERY_EVENTS.forEach((event) => document.removeEventListener(event, handleAutoplayRecovery, true));
    autoplayRecoveryInstalled = false;
  }
  function clearAutoplayBlock() {
    autoplayBlockedMode = "";
    autoplayUnlocking = false;
    removeAutoplayRecovery();
  }
  function installAutoplayRecovery() {
    if (autoplayRecoveryInstalled || typeof document === "undefined") return;
    AUTOPLAY_RECOVERY_EVENTS.forEach((event) => document.addEventListener(event, handleAutoplayRecovery, true));
    autoplayRecoveryInstalled = true;
  }
  function markAutoplayBlocked(mode) {
    if (mode !== "menu") return;
    autoplayBlockedMode = mode;
    autoplayUnlocking = false;
    installAutoplayRecovery();
  }
  function handleAutoplayRecovery() {
    if (autoplayBlockedMode !== "menu") return;
    init();
    unmuteCurrentTrack();
  }
  function trackFor(mode) {
    return mode === "game" ? tracks.game : tracks.menu;
  }
  function stopContinuous() {
    clearTimers();
    safeStop(tracks.menu);
    safeStop(tracks.game);
    currentMode = "";
    clearAutoplayBlock();
  }
  function stopOneShots() {
    allowedOneShots.clear();
    [tracks.resume, tracks.gameOver, tracks.winning, ...tracks.collect].forEach(safeStop);
    activeExclusiveTrack = null;
    exclusiveStartedAt = 0;
    queuedContinuous = null;
  }
  function stopAllTracks() {
    stopContinuous();
    stopOneShots();
  }
  function enforceContinuousPermission(mode, track) {
    if (activeExclusiveTrack || currentMode !== mode || trackFor(mode) !== track) safeStop(track);
  }
  function startContinuous(mode, muted = false, startupVolume = musicVolume()) {
    const track = trackFor(mode);
    if (!track) return;
    if (mode === "menu") {
      [tracks.resume, tracks.gameOver, tracks.winning].forEach(safeStop);
      activeExclusiveTrack = null;
      exclusiveStartedAt = 0;
    }
    const other = trackFor(mode === "game" ? "menu" : "game");
    safeStop(other);
    track.loop = true;
    track.autoplay = true;
    track.preload = "auto";
    track.volume = startupVolume;
    track.muted = muted;
    currentMode = mode;
    const token = transitionToken;
    const guard = () => token === transitionToken && currentMode === mode;
    const enforce = () => enforceContinuousPermission(mode, track);
    const recover = () => {
      if (mode !== "menu" || !guard()) return;
      markAutoplayBlocked(mode);
      track.muted = true;
      requestPlay(track, guard, void 0, void 0, enforce);
    };
    requestPlay(track, guard, recover, () => {
      if (!track.muted && mode === "menu") clearAutoplayBlock();
    }, enforce);
  }
  function hasBlockingExclusive(mode) {
    if (mode !== "menu" || !activeExclusiveTrack) return false;
    return !activeExclusiveTrack.paused && !activeExclusiveTrack.ended;
  }
  function requestContinuous(mode, immediate = false, delay = GAME.musicTransitionDelay) {
    if (hasBlockingExclusive(mode)) {
      queuedContinuous = { mode, immediate, delay };
      return;
    }
    if (currentMode === mode) {
      const track = trackFor(mode);
      track.volume = musicVolume();
      if (immediate && track.paused) {
        const guard = () => currentMode === mode;
        requestPlay(track, guard, void 0, void 0, () => enforceContinuousPermission(mode, track));
      }
      return;
    }
    clearTimers();
    const token = transitionToken;
    if (immediate) {
      startContinuous(mode);
      return;
    }
    safeStop(trackFor(currentMode));
    transitionTimer = window.setTimeout(() => {
      transitionTimer = null;
      if (token === transitionToken) startContinuous(mode);
    }, delay);
  }
  function playOneShot(track, { exclusive = false } = {}) {
    if (!track || !musicVolume()) return;
    safeStop(track);
    track.loop = false;
    track.volume = musicVolume();
    allowedOneShots.add(track);
    if (exclusive) {
      activeExclusiveTrack = track;
      exclusiveStartedAt = Date.now();
    }
    const result = safePlay(track);
    if (result?.then) {
      result.then(() => {
        if (!allowedOneShots.has(track) || exclusive && activeExclusiveTrack !== track) safeStop(track);
      }, () => {
      });
    }
  }
  function finishExclusive(track) {
    allowedOneShots.delete(track);
    safeStop(track);
    if (activeExclusiveTrack === track) activeExclusiveTrack = null;
    exclusiveStartedAt = 0;
  }
  function unmuteCurrentTrack() {
    const mode = currentMode;
    if (mode !== "menu" && mode !== "game") return;
    const track = trackFor(mode);
    if (!track || autoplayUnlocking) return;
    if (!track.muted && !track.paused) {
      clearAutoplayBlock();
      return;
    }
    autoplayUnlocking = true;
    const guard = () => currentMode === mode && trackFor(mode) === track;
    const recoverMutedPlayback = () => {
      if (!guard()) return;
      markAutoplayBlocked(mode);
      track.pause();
      track.muted = true;
      requestPlay(track, guard, void 0, void 0, () => enforceContinuousPermission(mode, track));
    };
    track.muted = false;
    track.volume = musicVolume();
    requestPlay(track, guard, recoverMutedPlayback, () => {
      autoplayUnlocking = false;
      clearAutoplayBlock();
    }, () => enforceContinuousPermission(mode, track));
  }
  function playCollect() {
    if (!sfxVolume() || !tracks.collect.length) return;
    const track = tracks.collect[collectIndex];
    collectIndex = (collectIndex + 1) % tracks.collect.length;
    safeStop(track);
    track.volume = sfxVolume();
    const result = safePlay(track);
    if (result?.catch) result.catch(() => {
    });
  }
  function beep(frequency, duration, type, level = 0.04) {
    init();
    makeTone(context, frequency, duration, type, level * sfxVolume());
  }
  function winningDurationMs() {
    const duration = Number(tracks.winning?.duration);
    return Number.isFinite(duration) && duration > 0 ? duration * 1e3 : GAME.winningFallbackDuration;
  }
  function scheduleVictoryMenu() {
    const token = transitionToken;
    let finished = false;
    const finish = () => {
      if (finished || token !== transitionToken) return;
      finished = true;
      if (victoryTimer) window.clearTimeout(victoryTimer);
      if (victoryEndedHandler) tracks.winning?.removeEventListener?.("ended", victoryEndedHandler);
      victoryTimer = null;
      victoryEndedHandler = null;
      finishExclusive(tracks.winning);
      if (getState().status === "victory") requestContinuous("menu", false, GAME.victoryMenuDelay);
    };
    victoryEndedHandler = finish;
    tracks.winning?.addEventListener?.("ended", finish, { once: true });
    victoryTimer = window.setTimeout(finish, winningDurationMs() + 100);
  }
  function scheduleGameOverMenu() {
    const token = transitionToken;
    let finished = false;
    const finish = () => {
      if (finished || token !== transitionToken) return;
      finished = true;
      gameOverTimer = cancelRepeater(gameOverTimer);
      if (gameOverEndedHandler) tracks.gameOver?.removeEventListener?.("ended", gameOverEndedHandler);
      gameOverEndedHandler = null;
      finishExclusive(tracks.gameOver);
      const queued = queuedContinuous;
      queuedContinuous = null;
      if (getState().status === "gameover") {
        requestContinuous("menu", false, GAME.gameOverMusicDelay);
      } else if (queued) {
        requestContinuous(queued.mode, queued.immediate, queued.delay);
      }
    };
    gameOverEndedHandler = finish;
    tracks.gameOver?.addEventListener?.("ended", finish, { once: true });
    gameOverTimer = window.setInterval(() => {
      if (finished || token !== transitionToken) return;
      const stopped = tracks.gameOver?.paused || tracks.gameOver?.ended;
      const hardStopReached = Date.now() - exclusiveStartedAt >= EXCLUSIVE_HARD_STOP_MS;
      if (stopped || hardStopReached) finish();
    }, EXCLUSIVE_WATCHDOG_INTERVAL);
  }
  function playVictory() {
    stopAllTracks();
    playOneShot(tracks.winning, { exclusive: true });
    scheduleVictoryMenu();
  }
  function preservePlayingMenu() {
    if (currentMode !== "menu" || tracks.menu?.paused) return false;
    clearTimers();
    stopOneShots();
    safeStop(tracks.game);
    tracks.menu.volume = musicVolume();
    tracks.menu.muted = false;
    return true;
  }
  function scheduleInitialMenu() {
    if (getState().status !== "ready" || !tracks.menu) return;
    if (currentMode === "menu") return;
    startContinuous("menu", true, 0);
    if (initialTimer) window.clearTimeout(initialTimer);
    initialTimer = window.setTimeout(() => {
      initialTimer = null;
      if (getState().status === "ready" && currentMode === "menu") unmuteCurrentTrack();
    }, GAME.initialMenuDelay);
  }
  function handleStateChange(state, command) {
    if (command.type === "COMPLETE_RUN") {
      gameOverSequenceActive = false;
      playVictory();
      return;
    }
    if (command.type === "START_RUN") {
      gameOverSequenceActive = false;
      stopAllTracks();
      playOneShot(tracks.resume);
      requestContinuous("game", false, 300);
      return;
    }
    if (command.type === "RETURN_TO_MENU") {
      gameOverSequenceActive = false;
      if (preservePlayingMenu()) return;
      stopAllTracks();
      requestContinuous("menu", true);
      return;
    }
    if (command.type === "FAIL_RUN") {
      if (gameOverSequenceActive) return;
      gameOverSequenceActive = true;
      stopAllTracks();
      playOneShot(tracks.gameOver, { exclusive: true });
      scheduleGameOverMenu();
      return;
    }
    if (command.type === "PAUSE") {
      stopOneShots();
      requestContinuous("menu");
      return;
    }
    if (command.type === "RESUME") {
      gameOverSequenceActive = false;
      stopAllTracks();
      playOneShot(tracks.resume);
      requestContinuous("game", false, 300);
      return;
    }
    if (state.status === "ready") scheduleInitialMenu();
  }
  function syncMusicToState({ state, immediate = false }) {
    if (state.status === "playing" || state.status === "extraction") requestContinuous("game", immediate);
    else if (state.status === "ready" || state.status === "paused") requestContinuous("menu", immediate);
  }
  function setMusicPercent(value) {
    musicPercent = normalizePercent(value, musicPercent);
    saveVolumes(storage, musicPercent, sfxPercent);
    updateVolumes();
  }
  function setSfxPercent(value) {
    sfxPercent = normalizePercent(value, sfxPercent);
    saveVolumes(storage, musicPercent, sfxPercent);
    updateVolumes();
  }
  return {
    init,
    startInitialMenu: scheduleInitialMenu,
    handleStateChange,
    playCollect,
    playVictory,
    beep,
    musicVolume,
    sfxVolume,
    getLevels: () => ({ music: musicPercent, sfx: sfxPercent }),
    setMusicPercent,
    setSfxPercent,
    syncMusicToState,
    handleGesture() {
      init();
      const state = getState();
      if (state.status === "gameover" || state.status === "victory") return;
      unmuteCurrentTrack();
      syncMusicToState({ state, immediate: true });
    },
    stopAll() {
      gameOverSequenceActive = false;
      stopAllTracks();
    }
  };
}
export { AUTOPLAY_RECOVERY_EVENTS, LEGACY_PERCENT, createAudioController, makeTone, normalizePercent, readStored, readVolume, requestPlay, safePlay, safeStop, saveVolumes };
