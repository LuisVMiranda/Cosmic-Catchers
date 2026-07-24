import { CanvasTexture, Group, Mesh, MeshStandardMaterial, Shape, ShapeGeometry, SRGBColorSpace, Sprite, SpriteMaterial } from "three";
import { COLORS, GAME, clamp, lerp } from "./config.js";

function spikyPoints() {
  return Array.from({ length: 16 }, (_, index) => {
    const angle = index / 16 * Math.PI * 2;
    const radius = index % 2 === 0 ? 0.82 : 0.59;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}
function geometryFromPoints(points) {
  const shape = new Shape();
  points.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.y);
    else shape.lineTo(point.x, point.y);
  });
  shape.closePath();
  return new ShapeGeometry(shape);
}
function makeSpikyGeometry() {
  return geometryFromPoints(spikyPoints());
}
function splitAtCenter(points, keepLeft) {
  const inside = (point) => keepLeft ? point.x <= 0 : point.x >= 0;
  const intersection = (from, to) => {
    const ratio = -from.x / (to.x - from.x);
    return { x: 0, y: from.y + (to.y - from.y) * ratio };
  };
  const clipped = [];
  points.forEach((point, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    if (inside(point) !== inside(previous)) clipped.push(intersection(previous, point));
    if (inside(point)) clipped.push(point);
  });
  return clipped;
}
function diskMaterial(color) {
  return new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.18 });
}
function makeMysteryHalves() {
  const halves = new Group();
  const points = spikyPoints();
  halves.add(
    new Mesh(geometryFromPoints(splitAtCenter(points, true)), diskMaterial(COLORS.green)),
    new Mesh(geometryFromPoints(splitAtCenter(points, false)), diskMaterial(COLORS.red))
  );
  return halves;
}

function drawTooltip({ canvas, text }) {
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(24, 12, 42, .7)";
  context.fillRect(3, 3, canvas.width - 6, canvas.height - 6);
  context.strokeStyle = "rgba(255, 255, 255, .58)";
  context.lineWidth = 3;
  context.strokeRect(4.5, 4.5, canvas.width - 9, canvas.height - 9);
  context.shadowColor = "rgba(0, 0, 0, .75)";
  context.shadowBlur = 8;
  context.font = "500 30px Roboto, Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#fff8ff";
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
}
function makeTeleportTooltip(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 72;
  drawTooltip({ canvas, text });
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const tooltip = new Sprite(new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false
  }));
  tooltip.position.set(0, 1.32, 1);
  tooltip.scale.set(2.35, 0.66, 1);
  tooltip.renderOrder = 40;
  tooltip.visible = false;
  tooltip.userData = { canvas, text };
  return tooltip;
}
function syncTeleportTooltip({ tooltip, text, visible }) {
  if (!tooltip) return;
  tooltip.visible = visible;
  if (tooltip.userData.text === text) return;
  tooltip.userData.text = text;
  drawTooltip({ canvas: tooltip.userData.canvas, text });
  tooltip.material.map.needsUpdate = true;
}
function getApproachPresentation(distance) {
  const progress2 = clamp(1 - distance / GAME.approachFadeDistance, 0, 1);
  return {
    scale: lerp(1, GAME.approachMinScale, progress2),
    opacity: lerp(1, GAME.approachMinOpacity, progress2)
  };
}
function updateMysteryMorphPose({ group, mystery }) {
  const body = group.userData.body;
  if (!body) return;
  if (mystery?.state !== "morphing") {
    body.scale.set(1, 1, 1);
    body.rotation.z = 0;
    return;
  }
  const progress = clamp(mystery.elapsed / Math.max(1e-6, mystery.morphDuration), 0, 1);
  const pulse = Math.sin(progress * Math.PI);
  body.scale.set(1 + pulse * 0.16, 1 - pulse * 0.35, 1);
  body.rotation.z = pulse * Math.PI * 0.18;
}
export { drawTooltip, getApproachPresentation, makeMysteryHalves, makeSpikyGeometry, makeTeleportTooltip, syncTeleportTooltip, updateMysteryMorphPose };
