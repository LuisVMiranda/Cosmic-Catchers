var COLORS = Object.freeze({
  lime: 13238114,
  green: 9286469,
  greenDark: 5013558,
  red: 16733567,
  redDark: 12070497,
  white: 16775423,
  ink: 2232367,
  cyan: 8580095,
  violet: 9194984,
  assetShadow: 8749452,
  teleport: 10190079
});
var GAME = Object.freeze({
  defaultMode: "easy",
  defaultLanguage: "en",
  baseSpeed: 2.65,
  speedStep: 0.1,
  baseSpawnDelay: 0.58,
  spawnDelayStep: 0.01,
  minSpawnDelay: 0.3,
  initialSpawnDelay: 0.35,
  flipDuration: 0.22,
  spawnY: 8.45,
  viewHalfHeight: 8,
  minimumViewHalfWidth: 3.7,
  playfieldSidePadding: 1.16,
  catcherShiftDown: 3.15,
  flipDistance: 2.75,
  musicTransitionDelay: 1e3,
  gameOverMusicDelay: 1e3,
  initialMenuDelay: 1e3,
  victoryMenuDelay: 500,
  winningFallbackDuration: 4488,
  extractionIntroDuration: 1.8,
  entryTransitionDuration: 1.45,
  musicCap: 0.8,
  sfxCap: 0.9,
  defaultMusicPercent: 40,
  defaultSfxPercent: 55,
  volumeVersion: 2,
  maxPlanRetries: 8,
  maxActiveBatches: 2,
  maxSlowQueueBatches: 2,
  overlapSpawnGapMultiplier: 1.55,
  diskDiameter: 1.64,
  minimumDiskGapDiameters: 3,
  approachFadeDistance: 0.88,
  approachMinScale: 0.65,
  approachMinOpacity: 0.65,
  catchPopupOffset: 0.6,
  captureDuration: 0.08,
  catcherLayerZ: 0,
  diskLayerZ: 3,
  catcherRenderOrder: 10,
  diskRenderOrder: 20,
  strokeScale: 1.07,
  strokeWidth: 2,
  teleportTriggerFraction: 0.5,
  teleportStopDuration: 1,
  mysteryTriggerFraction: 0.5,
  mysteryMorphDuration: 0.34,
  mysteryFlickerRate: 24,
  mysteryBaseChance: 0.06,
  mysteryChanceStep: 0.01,
  mysteryChanceCap: 0.18,
  audioStartupRetryDelay: 120,
  maxFrameDelta: 0.04
});
var MODE_CONFIG = Object.freeze({
  easy: Object.freeze({
    lanes: 2,
    bumpEvery: 3,
    spawnDelayPhases: 2,
    phaseCap: 25,
    finaleBatches: 4,
    startSpeedScale: 1.2,
    speedCap: 3,
    endlessHoldUntilPhase: 40,
    endlessMilestoneEvery: 5,
    endlessSpeedCap: 3.5,
    endlessMinSpawnDelay: 0.41,
    minReactionWindow: 0.7,
    minColorSwitchWindow: 0.52,
    batchOverlapUnlockPhase: 10,
    lateOverlapPhase: 20,
    lateMaxActiveBatches: 2,
    minimumOverlapMultiplier: 1.05,
    eventfulCadencePhase: 12,
    lateOverlapReduction: 0.12,
    teleportUnlockPhase: 16,
    teleportEvery: 3,
    mysteryUnlockPhase: 9,
    labelKey: "modeEasy",
    introKey: "readyIntroEasy",
    helpKey: "helpEasy"
  }),
  hard: Object.freeze({
    lanes: 3,
    bumpEvery: 2,
    spawnDelayPhases: 2,
    phaseCap: 30,
    finaleBatches: 6,
    startSpeedScale: 1.5,
    speedCap: 4,
    endlessHoldUntilPhase: 45,
    endlessMilestoneEvery: 6,
    endlessSpeedCap: 4.5,
    endlessMinSpawnDelay: 0.39,
    minReactionWindow: 0.55,
    minColorSwitchWindow: 0.4,
    batchOverlapUnlockPhase: 12,
    lateOverlapPhase: 22,
    lateMaxActiveBatches: 3,
    minimumOverlapMultiplier: 0.85,
    eventfulCadencePhase: 12,
    lateOverlapReduction: 0.18,
    teleportUnlockPhase: 10,
    teleportEvery: 2,
    mysteryUnlockPhase: 6,
    labelKey: "modeHard",
    introKey: "readyIntroHard",
    helpKey: "helpHard"
  })
});
var CATCHER_Y = -GAME.catcherShiftDown;
var SIDE_Y = Object.freeze([CATCHER_Y, CATCHER_Y]);
var STORAGE_KEYS = Object.freeze({
  language: "cosmic-catchers-language",
  mode: "cosmic-catchers-mode",
  volume: "cosmic-catchers-volume",
  bestEasy: "cosmic-catchers-best-easy",
  bestHard: "cosmic-catchers-best-hard",
  campaignBestEasy: "cosmic-catchers-campaign-best-easy",
  campaignBestHard: "cosmic-catchers-campaign-best-hard",
  endlessBestEasy: "cosmic-catchers-endless-best-easy",
  endlessBestHard: "cosmic-catchers-endless-best-hard",
  winsEasy: "cosmic-catchers-wins-easy",
  winsHard: "cosmic-catchers-wins-hard",
  fastestEasy: "cosmic-catchers-fastest-easy",
  fastestHard: "cosmic-catchers-fastest-hard",
  endlessUnlockedEasy: "cosmic-catchers-endless-unlocked-easy",
  endlessUnlockedHard: "cosmic-catchers-endless-unlocked-hard"
});
var AUDIO_FILES = Object.freeze({
  menu: "cosmic-catchers-menu-soundtrack.mp3",
  game: "cosmic-catchers-game-soundtrack.mp3",
  resume: "cosmic-catchers-resume-start-soundtrack.mp3",
  gameOver: "cosmic-catchers-game-over-soundtrack.mp3",
  winning: "cosmic-catchers-game-win-soundtrack.mp3",
  collect: "cosmic-catchers-collect-soundtrack.mp3"
});
function getModeConfig(mode) {
  return MODE_CONFIG[mode] || MODE_CONFIG[GAME.defaultMode];
}
function normalizeMode(mode) {
  return MODE_CONFIG[mode] ? mode : GAME.defaultMode;
}
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
function lerp(start, end, amount) {
  return start + (end - start) * amount;
}
export { AUDIO_FILES, COLORS, GAME, MODE_CONFIG, SIDE_Y, STORAGE_KEYS, clamp, getModeConfig, lerp, normalizeMode };
