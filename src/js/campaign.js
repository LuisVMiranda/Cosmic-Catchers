import { MODE_CONFIG, clamp, getModeConfig } from "./config.js";

function getCampaignTarget({ mode }) {
  const config = getModeConfig(mode);
  return (config.phaseCap - 1) * config.bumpEvery + config.finaleBatches;
}
function getFinaleStart({ mode }) {
  const config = getModeConfig(mode);
  return (config.phaseCap - 1) * config.bumpEvery;
}
function getFinaleProgress({ mode, completedBatches }) {
  const config = getModeConfig(mode);
  const start = getFinaleStart({ mode });
  const completed = Math.max(0, Number(completedBatches) || 0);
  const active = completed >= start;
  const current = active ? clamp(completed - start + 1, 1, config.finaleBatches) : 0;
  return {
    active,
    current,
    total: config.finaleBatches,
    completed: clamp(completed - start, 0, config.finaleBatches)
  };
}
function isCampaignSpawnAllowed({ state }) {
  if (state.runType === "endless") return true;
  const active = state.activeBatchIds?.length || 0;
  return state.completedBatches + active < getCampaignTarget({ mode: state.mode });
}
function isCampaignComplete({ state }) {
  if (state.runType !== "campaign" || state.status !== "playing") return false;
  const target = getCampaignTarget({ mode: state.mode });
  return state.completedBatches >= target && (state.activeBatchIds?.length || 0) === 0;
}
function isFinalPhase({ mode, phase }) {
  return phase >= (MODE_CONFIG[mode] || MODE_CONFIG.easy).phaseCap;
}
export { getCampaignTarget, getFinaleProgress, getFinaleStart, isCampaignComplete, isCampaignSpawnAllowed, isFinalPhase };
