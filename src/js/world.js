import { GAME, clamp, getModeConfig } from "./config.js";

function getLaneCount(mode) {
  return getModeConfig(mode).lanes;
}
function getViewBounds({ width, height }) {
  const aspect2 = Math.max(1, width) / Math.max(1, height);
  const halfHeight = Math.max(GAME.viewHalfHeight, GAME.minimumViewHalfWidth / aspect2);
  return { halfHeight, halfWidth: halfHeight * aspect2 };
}
function getLaneX({ index, mode, halfWidth }) {
  if (mode === "hard") {
    const available2 = Math.max(1.15, halfWidth - GAME.playfieldSidePadding);
    const span2 = Math.min(clamp(halfWidth * 0.38, 2.25, 5.2), available2);
    return (index - 1) * span2;
  }
  const center = -halfWidth * 0.1;
  const available = Math.max(1.15, halfWidth - GAME.playfieldSidePadding - Math.abs(center));
  const span = Math.min(clamp(halfWidth * 0.28, 2.1, 4), available);
  return center + (index === 0 ? -span : span);
}
export { getLaneCount, getLaneX, getViewBounds };
