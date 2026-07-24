import { AdditiveBlending, AmbientLight, BoxGeometry, BufferGeometry, CanvasTexture, CircleGeometry, CylinderGeometry, DirectionalLight, Group, LineBasicMaterial, LineLoop, Mesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, PlaneGeometry, PointLight, RingGeometry, SRGBColorSpace, Scene, SphereGeometry, TorusGeometry, Vector3, WebGLRenderer } from "three";
import { createRocketField } from "./background-effects.js";
import { COLORS, GAME, SIDE_Y, clamp } from "./config.js";
import { getApproachPresentation, makeMysteryHalves, makeSpikyGeometry, makeTeleportTooltip, syncTeleportTooltip, updateMysteryMorphPose } from "./disk-visuals.js";
import { getLaneCount, getLaneX, getViewBounds } from "./world.js";

function makeBackdropTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 900;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#1c0e32");
  gradient.addColorStop(0.52, "#371a47");
  gradient.addColorStop(1, "#110f23");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  [
    [45, 70, 210, "rgba(188, 151, 207, .18)"],
    [1500, 175, 250, "rgba(224, 180, 214, .18)"],
    [-15, 720, 280, "rgba(207, 172, 211, .16)"],
    [1600, 710, 310, "rgba(224, 180, 214, .2)"],
    [760, 520, 170, "rgba(183, 113, 187, .08)"]
  ].forEach(([x, y, radius, color]) => {
    context.beginPath();
    context.fillStyle = color;
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  });
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
function makeWhiteSilhouette(geometry, scale = GAME.strokeScale) {
  const stroke = new Mesh(geometry.clone(), new MeshBasicMaterial({ color: COLORS.white }));
  stroke.scale.setScalar(scale);
  stroke.position.z = -0.05;
  return stroke;
}
function makeBoxStroke(width, height) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const geometry = new BufferGeometry().setFromPoints([
    new Vector3(-halfWidth, -halfHeight, 0),
    new Vector3(halfWidth, -halfHeight, 0),
    new Vector3(halfWidth, halfHeight, 0),
    new Vector3(-halfWidth, halfHeight, 0)
  ]);
  const material = new LineBasicMaterial({ color: COLORS.white, linewidth: GAME.strokeWidth, depthTest: false, depthWrite: false });
  const stroke = new LineLoop(geometry, material);
  stroke.position.z = 0.25;
  stroke.renderOrder = 5;
  return stroke;
}
function makeMonsterModel(colorName, scale = 1) {
  const green = colorName === "green";
  const mainColor = green ? COLORS.green : COLORS.red;
  const darkColor = green ? COLORS.greenDark : COLORS.redDark;
  const group = new Group();
  group.scale.set(scale, scale, scale);
  const bodyWidth = 1.42;
  const bodyHeight = 0.92;
  const capHeight = 0.28;
  const bodyGeometry = new BoxGeometry(bodyWidth, bodyHeight, 0.38);
  const bodyStroke = makeWhiteSilhouette(bodyGeometry);
  const bodyOutline = makeBoxStroke(bodyWidth, bodyHeight);
  const body = new Mesh(bodyGeometry, new MeshStandardMaterial({ color: mainColor, roughness: 0.7 }));
  group.add(bodyStroke, body, bodyOutline);
  const capGeometry = new BoxGeometry(bodyWidth, capHeight, 0.42);
  const capStroke = makeWhiteSilhouette(capGeometry);
  const capOutline = makeBoxStroke(bodyWidth, capHeight);
  const cap = new Mesh(capGeometry, new MeshStandardMaterial({ color: darkColor, roughness: 0.55 }));
  cap.position.y = bodyHeight / 2 + capHeight / 2;
  capStroke.position.y = cap.position.y;
  capOutline.position.y = cap.position.y;
  group.add(capStroke, cap, capOutline);
  [-0.38, 0.38].forEach((eyeX) => {
    const eye = new Mesh(new SphereGeometry(0.16, 14, 10), new MeshBasicMaterial({ color: COLORS.white }));
    eye.position.set(eyeX, 0.05, 0.27);
    const pupil = new Mesh(new SphereGeometry(0.068, 10, 8), new MeshBasicMaterial({ color: COLORS.ink }));
    pupil.position.set(eyeX + (green ? 0.025 : -0.025), 0.04, 0.39);
    group.add(eye, pupil);
  });
  const mouth = new Mesh(new BoxGeometry(0.66, 0.12, 0.05), new MeshBasicMaterial({ color: COLORS.ink }));
  mouth.position.set(0, -0.28, 0.27);
  group.add(mouth);
  [-0.25, 0, 0.25].forEach((toothX) => {
    const tooth = new Mesh(new BoxGeometry(0.09, 0.13, 0.05), new MeshBasicMaterial({ color: COLORS.white }));
    tooth.position.set(toothX, -0.22, 0.32);
    group.add(tooth);
  });
  return group;
}
function makeSpacecraftModel() {
  const group = new Group();
  const saucerGeometry = new SphereGeometry(1, 24, 14);
  const saucerStroke = makeWhiteSilhouette(saucerGeometry);
  const saucer = new Mesh(
    saucerGeometry,
    new MeshStandardMaterial({ color: COLORS.white, roughness: 0.42, metalness: 0.08 })
  );
  saucer.scale.set(1.25, 0.2, 0.72);
  saucerStroke.scale.copy(saucer.scale).multiplyScalar(GAME.strokeScale);
  const rim = new Mesh(
    new TorusGeometry(0.86, 0.1, 8, 28),
    new MeshBasicMaterial({ color: COLORS.cyan })
  );
  rim.scale.set(1.23, 1, 0.7);
  const hub = new Mesh(
    new SphereGeometry(0.28, 18, 10),
    new MeshBasicMaterial({ color: 16751440 })
  );
  hub.scale.y = 0.25;
  hub.position.set(0, 0.02, 0.16);
  const dome = new Mesh(
    new SphereGeometry(0.5, 20, 14),
    new MeshBasicMaterial({ color: COLORS.violet, transparent: true, opacity: 0.42, depthWrite: false })
  );
  dome.scale.y = 0.85;
  dome.position.set(0, 0.38, 0.05);
  const alien = new Mesh(
    new SphereGeometry(0.29, 18, 12),
    new MeshBasicMaterial({ color: COLORS.green })
  );
  alien.scale.y = 1.18;
  alien.position.set(0, 0.34, 0.27);
  const eye = new Mesh(new SphereGeometry(0.13, 14, 10), new MeshBasicMaterial({ color: COLORS.white }));
  eye.position.set(0.04, 0.36, 0.54);
  const pupil = new Mesh(new SphereGeometry(0.055, 10, 8), new MeshBasicMaterial({ color: COLORS.ink }));
  pupil.position.set(0.055, 0.36, 0.65);
  const antenna = new Mesh(new CylinderGeometry(0.025, 0.025, 0.24, 8), new MeshBasicMaterial({ color: COLORS.green }));
  antenna.position.set(0.1, 0.75, 0.28);
  const antennaTip = new Mesh(new SphereGeometry(0.07, 10, 8), new MeshBasicMaterial({ color: COLORS.green }));
  antennaTip.position.set(0.1, 0.9, 0.28);
  group.add(saucerStroke, saucer, rim, hub, dome, alien, eye, pupil, antenna, antennaTip);
  return group;
}
function setOpacity(object, opacity) {
  object.traverse((child) => {
    if (!child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      material.transparent = true;
      material.opacity = opacity;
    });
  });
}
function easeFlip(progress2) {
  return progress2 < 0.5 ? 2 * progress2 * progress2 : 1 - Math.pow(-2 * progress2 + 2, 2) / 2;
}
function applyFlipPose(lane, model) {
  const progress2 = model.flipping ? model.flipProgress : 1;
  lane.userData.flipper.position.y = SIDE_Y[0];
  lane.userData.flipper.rotation.z = model.flipping ? Math.sin(progress2 * Math.PI) * Math.PI : 0;
}
function applyMonsterVisibility(lane, model) {
  const greenVisible = model.flipping ? model.toSide === 0 || model.flipProgress < 0.5 : model.activeSide === 0;
  const redVisible = model.flipping ? model.toSide === 1 && model.flipProgress >= 0.5 : model.activeSide === 1;
  lane.userData.green.visible = greenVisible;
  lane.userData.red.visible = redVisible;
}
function applyDockState(lane, model) {
  lane.userData.topDock.material.opacity = model.activeSide === 0 ? 0.55 : 0.18;
  lane.userData.bottomDock.material.opacity = model.activeSide === 1 ? 0.55 : 0.18;
  setOpacity(lane.userData.green, model.activeSide === 0 ? 0.95 : 0.18);
  setOpacity(lane.userData.red, model.activeSide === 1 ? 0.95 : 0.18);
}
function makeDiffuseShadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 48;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.35, "rgba(255,255,255,.58)");
  gradient.addColorStop(0.65, "rgba(255,255,255,.58)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.filter = "blur(8px)";
  context.fillStyle = gradient;
  context.fillRect(10, 13, 108, 22);
  context.filter = "none";
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
function makeDiffuseGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.2, "rgba(255,255,255,.18)");
  gradient.addColorStop(0.5, "rgba(255,255,255,.55)");
  gradient.addColorStop(0.8, "rgba(255,255,255,.18)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.filter = "blur(14px)";
  context.fillStyle = gradient;
  context.fillRect(30, 10, 68, 172);
  context.filter = "none";
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
function makeDiffuseShadow({ texture, width, height, opacity, y = -0.18 }) {
  const material = new MeshBasicMaterial({
    map: texture,
    color: COLORS.assetShadow,
    transparent: true,
    opacity,
    depthWrite: false
  });
  const shadow = new Mesh(new PlaneGeometry(width, height), material);
  shadow.position.set(0, y, -0.2);
  return shadow;
}
function makeOuterRingStroke() {
  return new Mesh(
    new RingGeometry(1.06, 1.11, 28),
    new MeshBasicMaterial({ color: COLORS.white })
  );
}
function createDiskMaterial(color) {
  return new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.18 });
}
function createSpecialGlow({ special, mystery }) {
  if (!special) return null;
  const color = mystery ? COLORS.violet : COLORS.teleport;
  return new Mesh(new TorusGeometry(0.94, 0.08, 8, 28), new MeshBasicMaterial({ color, transparent: true, opacity: 0.82, depthWrite: false }));
}
function createTeleportTooltip({ special, mystery, text }) {
  if (!special || mystery) return null;
  return makeTeleportTooltip(text);
}
function collectApproachMaterials({ visual, trail, specialGlow }) {
  const dynamicMaterials = /* @__PURE__ */ new Set([trail.material, specialGlow?.material]);
  const approachMaterials = [];
  visual.traverse((child) => {
    if (!child.material || dynamicMaterials.has(child.material)) return;
    child.material.transparent = true;
    approachMaterials.push({ material: child.material, baseOpacity: child.material.opacity });
  });
  return approachMaterials;
}
function makeDisk(options) {
  const { shadowTexture, glowTexture, colorName, speedScale, speedMultiplier, overlapSpeedReduction, special, mystery = false, teleportText } = options;
  const color = colorName === "green" ? COLORS.green : COLORS.red;
  const disk = new Group();
  const visual = new Group();
  disk.renderOrder = GAME.diskRenderOrder;
  const displaySpeedMultiplier = speedMultiplier * (1 - overlapSpeedReduction);
  const relativeSpeed = Math.abs(displaySpeedMultiplier - 1);
  const diffuseShadow = makeDiffuseShadow({ texture: shadowTexture, width: 1.72, height: 0.58, opacity: 0.2 });
  const bodyGeometry = makeSpikyGeometry();
  const bodyStroke = makeWhiteSilhouette(bodyGeometry);
  const finalBody = new Mesh(bodyGeometry, createDiskMaterial(color));
  const mysteryHalves = mystery ? makeMysteryHalves() : null;
  finalBody.visible = !mystery;
  const body = mysteryHalves || finalBody;
  const trailColor = mystery ? COLORS.white : color;
  const trail = new Mesh(new PlaneGeometry(1.2, 2.4), new MeshBasicMaterial({ map: glowTexture, color: trailColor, transparent: true, opacity: 0.03 + relativeSpeed * 0.2, depthWrite: false, blending: AdditiveBlending }));
  trail.position.set(0, 0.38, -0.16);
  trail.scale.set(0.72 + relativeSpeed * 0.65, 0.78 + relativeSpeed * 2.1, 1);
  const specialGlow = createSpecialGlow({ special, mystery });
  if (specialGlow) specialGlow.position.z = -0.08;
  const eyeMaterial = new MeshBasicMaterial({ color: COLORS.white });
  const pupilMaterial = new MeshBasicMaterial({ color: COLORS.ink });
  const leftEye = new Mesh(new SphereGeometry(0.14, 12, 8), eyeMaterial);
  const rightEye = new Mesh(new SphereGeometry(0.14, 12, 8), eyeMaterial);
  leftEye.position.set(-0.23, 0.08, 0.28);
  rightEye.position.set(0.23, 0.08, 0.28);
  const leftPupil = new Mesh(new SphereGeometry(0.055, 10, 8), pupilMaterial);
  const rightPupil = new Mesh(new SphereGeometry(0.055, 10, 8), pupilMaterial);
  leftPupil.position.set(-0.21, 0.08, 0.4);
  rightPupil.position.set(0.21, 0.08, 0.4);
  visual.add(diffuseShadow, trail, bodyStroke, finalBody, leftEye, rightEye, leftPupil, rightPupil);
  if (mysteryHalves) visual.add(mysteryHalves);
  if (specialGlow) visual.add(specialGlow);
  const teleportTooltip = createTeleportTooltip({ special, mystery, text: teleportText });
  disk.add(visual);
  if (teleportTooltip) disk.add(teleportTooltip);
  const approachMaterials = collectApproachMaterials({ visual, trail, specialGlow });
  disk.userData.speedScale = speedScale;
  disk.userData.speedMultiplier = displaySpeedMultiplier;
  disk.userData.trail = trail;
  disk.userData.special = special; disk.userData.specialGlow = specialGlow;
  disk.userData.mystery = mystery; disk.userData.finalColor = color;
  disk.userData.body = body; disk.userData.finalBody = finalBody;
  disk.userData.mysteryHalves = mysteryHalves;
  disk.userData.visual = visual;
  disk.userData.teleportTooltip = teleportTooltip;
  disk.userData.approachMaterials = approachMaterials;
  return disk;
}
function revealMysteryDisk(group) {
  const { finalBody, mysteryHalves } = group?.userData || {};
  if (!finalBody || !mysteryHalves || finalBody.visible) return;
  mysteryHalves.visible = false;
  finalBody.visible = true;
  if (group.userData.trail && group.userData.finalColor) group.userData.trail.material.color.setHex(group.userData.finalColor);
}
function isGameplayVisible(status) {
  return !["ready", "entering"].includes(status);
}
function createCatcherHitAreas({ rect, halfWidth, halfHeight, catchers }) {
  if (!rect.width || !rect.height || !halfWidth || !halfHeight) return [];
  const scaleX = rect.width / (halfWidth * 2);
  const scaleY = rect.height / (halfHeight * 2);
  const halfTapWidth = Math.max(22, 0.9 * scaleX);
  const halfTapHeight = Math.max(22, 0.78 * scaleY);
  return catchers.map((catcher) => ({
    index: catcher.index,
    centerX: rect.left + (catcher.x + halfWidth) * scaleX,
    centerY: rect.top + (halfHeight - catcher.y) * scaleY,
    halfWidth: halfTapWidth,
    halfHeight: halfTapHeight
  }));
}
function findPointerCatcher({ clientX, clientY, areas }) {
  const hits = areas.filter((area) => {
    return Math.abs(clientX - area.centerX) <= area.halfWidth && Math.abs(clientY - area.centerY) <= area.halfHeight;
  });
  if (!hits.length) return -1;
  hits.sort((left, right) => {
    const leftDistance = (clientX - left.centerX) ** 2 + (clientY - left.centerY) ** 2;
    const rightDistance = (clientX - right.centerX) ** 2 + (clientY - right.centerY) ** 2;
    return leftDistance - rightDistance;
  });
  return hits[0].index;
}
function getDiskFlickerSource(disk) {
  if (disk.teleport?.state === "waiting") {
    return { waiting: true, morphing: false, elapsed: disk.teleport.elapsed || 0, rate: 22 };
  }
  if (disk.mystery?.state === "morphing") {
    return { waiting: false, morphing: true, elapsed: disk.mystery.elapsed || 0, rate: disk.mystery.flickerRate || GAME.mysteryFlickerRate };
  }
  return { waiting: false, morphing: false, elapsed: 0, rate: 0 };
}
function getDiskFlickerState(disk) {
  const source = getDiskFlickerSource(disk);
  const flicker = !(source.waiting || source.morphing) || Math.sin(source.elapsed * source.rate) > 0;
  return { waiting: source.waiting, morphing: source.morphing, flicker };
}
function updateSpecialGlow({ disk, flicker, waiting, morphing, approachOpacity, delta, elapsed }) {
  const specialGlow = disk.group.userData.specialGlow;
  if (!specialGlow) return;
  specialGlow.rotation.z += delta * 2.4;
  const glowOpacity = waiting || morphing ? 0.62 + Math.sin(elapsed * 9) * 0.2 : 0.82;
  specialGlow.material.opacity = glowOpacity * approachOpacity;
  specialGlow.visible = flicker;
}
function updateDiskVisual({ disk, delta, elapsed, getText }) {
  const visual = disk.group.userData.visual;
  if (disk.mystery?.state === "revealed") revealMysteryDisk(disk.group);
  updateMysteryMorphPose({ group: disk.group, mystery: disk.mystery });
  visual.rotation.z += delta * (disk.color === "green" ? 1.5 : -1.5);
  visual.rotation.x = Math.sin(elapsed * 3 + disk.lane) * 0.12;
  const pulse = 1 + Math.sin(elapsed * 8 + disk.lane) * 0.035;
  const distance = Math.max(0, disk.group.position.y - disk.targetY);
  const approach = getApproachPresentation(distance);
  visual.scale.setScalar(pulse * approach.scale);
  disk.group.userData.approachMaterials.forEach(({ material, baseOpacity }) => {
    material.opacity = baseOpacity * approach.opacity;
  });
  const mixedOffset = Math.abs(disk.group.userData.speedMultiplier - 1);
  disk.group.userData.trail.material.opacity = clamp(0.025 + mixedOffset * 0.22 + Math.sin(elapsed * 7 + disk.lane) * 0.01, 0.02, 0.3) * approach.opacity;
  disk.group.userData.trail.scale.y = 0.78 + mixedOffset * 2.1;
  const { waiting, morphing, flicker } = getDiskFlickerState(disk);
  visual.visible = flicker;
  syncTeleportTooltip({ tooltip: disk.group.userData.teleportTooltip, text: getText("teleporting"), visible: waiting });
  updateSpecialGlow({ disk, flicker, waiting, morphing, approachOpacity: approach.opacity, delta, elapsed });
}
function createRenderer({ canvas, getState, getText }) {
  const scene = new Scene();
  const camera = new OrthographicCamera(-8, 8, 8, -8, 0.1, 100);
  camera.position.set(0, 0, 20);
  const renderer2 = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer2.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer2.outputColorSpace = SRGBColorSpace;
  renderer2.setClearColor(1443873, 1);
  scene.add(new AmbientLight(16777215, 2.2));
  const key = new DirectionalLight(16767218, 2.3);
  key.position.set(-5, 8, 12);
  scene.add(key);
  const fill = new PointLight(9720575, 2.8, 24);
  fill.position.set(4, -1, 8);
  scene.add(fill);
  const background = new Group();
  const world = new Group();
  const effects2 = new Group();
  scene.add(background, world, effects2);
  const catchers = [];
  const gates = [];
  const stars = [];
  const state = { halfWidth: 8, halfHeight: GAME.viewHalfHeight, elapsed: 0 };
  const shadowTexture = makeDiffuseShadowTexture();
  const glowTexture = makeDiffuseGlowTexture();
  let rocketField;
  function laneX(index, mode) {
    return getLaneX({ index, mode, halfWidth: state.halfWidth });
  }
  function createBackground() {
    const backdrop = new Mesh(new PlaneGeometry(50, 24), new MeshBasicMaterial({ map: makeBackdropTexture(), depthWrite: false }));
    backdrop.position.set(0, 0, -5);
    background.add(backdrop);
    for (let index = 0; index < 44; index += 1) {
      const star = new Mesh(new CircleGeometry(0.025 + Math.random() * 0.045, 8), new MeshBasicMaterial({ color: COLORS.white, transparent: true, opacity: 0.18 + Math.random() * 0.4, depthWrite: false }));
      star.position.set((Math.random() - 0.5) * 28, (Math.random() - 0.5) * 15, -2.1);
      star.userData = { phase: Math.random() * Math.PI * 2, opacity: star.material.opacity, twinkleSpeed: 0.8 + Math.random() * 2.4, twinkleDepth: 0.35 + Math.random() * 0.55, twinkleSharpness: 2 + Math.random() * 3 };
      background.add(star);
      stars.push(star);
    }
    rocketField = createRocketField({ parent: background, getHalfWidth: () => state.halfWidth });
  }
  function createGate(index) {
    const gate = new Group();
    gate.position.set(0, 6.15, 0.8);
    const diffuseShadow = makeDiffuseShadow({ texture: shadowTexture, width: 2.45, height: 0.72, opacity: 0.24, y: -0.68 });
    const glow = new Mesh(new CircleGeometry(1.28, 28), new MeshBasicMaterial({ color: COLORS.violet, transparent: true, opacity: 0.16, depthWrite: false }));
    const spacecraft = makeSpacecraftModel();
    gate.add(diffuseShadow, glow, spacecraft);
    gate.userData = { index, glow };
    world.add(gate);
    gates.push(gate);
  }
  function createCatcher2(index) {
    const lane = new Group();
    lane.position.z = GAME.catcherLayerZ;
    lane.renderOrder = GAME.catcherRenderOrder;
    const topDockStroke = makeOuterRingStroke();
    const topDock = new Mesh(new RingGeometry(0.96, 1.06, 28), new MeshBasicMaterial({ color: COLORS.green, transparent: true, opacity: 0.55 }));
    topDock.position.y = SIDE_Y[0];
    topDockStroke.position.y = SIDE_Y[0];
    const bottomDockStroke = makeOuterRingStroke();
    const bottomDock = new Mesh(new RingGeometry(0.96, 1.06, 28), new MeshBasicMaterial({ color: COLORS.red, transparent: true, opacity: 0.18 }));
    bottomDock.position.y = SIDE_Y[1];
    bottomDockStroke.position.y = SIDE_Y[1];
    const flipper = new Group();
    const catcherShadow = makeDiffuseShadow({ texture: shadowTexture, width: 2.28, height: 0.7, opacity: 0.22, y: -0.68 });
    const green = makeMonsterModel("green", 1);
    const red = makeMonsterModel("red", 1);
    flipper.add(catcherShadow, green, red);
    red.visible = false;
    lane.add(topDockStroke, topDock, bottomDockStroke, bottomDock, flipper);
    lane.userData = { index, flipper, green, red, topDock, bottomDock };
    world.add(lane);
    catchers.push(lane);
  }
  function syncCatcher(lane, model, visible) {
    model.visible = visible;
    if (!visible) return;
    applyFlipPose(lane, model);
    applyMonsterVisibility(lane, model);
    applyDockState(lane, model);
  }
  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer2.setSize(width, height, false);
    const view = getViewBounds({ width, height });
    state.halfWidth = view.halfWidth;
    state.halfHeight = view.halfHeight;
    camera.left = -state.halfWidth;
    camera.right = state.halfWidth;
    camera.top = state.halfHeight;
    camera.bottom = -state.halfHeight;
    camera.updateProjectionMatrix();
  }
  function update({ gameState, disks, delta }) {
    state.elapsed += delta;
    const mode = gameState.mode;
    const laneCount = getLaneCount(mode);
    const gameplayVisible = isGameplayVisible(gameState.status);
    world.visible = gameplayVisible;
    effects2.visible = gameplayVisible;
    catchers.forEach((lane, index) => {
      lane.visible = gameplayVisible && index < laneCount;
      lane.position.x = laneX(index, mode);
      if (lane.visible) syncCatcher(lane, gameState.catchers[index], true);
    });
    gates.forEach((gate, index) => {
      gate.visible = gameplayVisible && index < laneCount;
      gate.position.x = laneX(index, mode);
      gate.position.y = 6.15 + Math.sin(state.elapsed * 1.4 + index * 1.7) * 0.07;
      gate.rotation.z = Math.sin(state.elapsed * 0.75 + index) * 0.025;
      gate.userData.glow.material.opacity = 0.12 + Math.sin(state.elapsed * 2 + index) * 0.04;
      gate.userData.glow.scale.setScalar(1 + Math.sin(state.elapsed * 1.7 + index) * 0.04);
    });
    stars.forEach((star) => {
      const twinkle = Math.max(0, Math.sin(state.elapsed * star.userData.twinkleSpeed + star.userData.phase));
      const flare = Math.pow(twinkle, star.userData.twinkleSharpness);
      star.material.opacity = clamp(star.userData.opacity * (0.55 + flare * (1 + star.userData.twinkleDepth)), 0.04, 1);
      const scale = 1 + flare * star.userData.twinkleDepth * 0.8;
      star.scale.set(scale, scale, scale);
    });
    rocketField.update(delta);
    disks.forEach((disk) => updateDiskVisual({ disk, delta, elapsed: state.elapsed, getText }));
  }
  createBackground();
  [0, 1, 2].forEach(createGate);
  [0, 1, 2].forEach(createCatcher2);
  resize();
  window.addEventListener("resize", resize);
  return {
    effects: effects2,
    resize,
    laneX: (index, mode) => laneX(index, mode),
    getPlayfieldCenterX(mode = getState().mode) {
      const laneCount = getLaneCount(mode);
      const midpoint = (laneX(0, mode) + laneX(laneCount - 1, mode)) / 2;
      const width = canvas.clientWidth || window.innerWidth;
      return (midpoint + state.halfWidth) / (state.halfWidth * 2) * width;
    },
      pointerLane(clientX, mode) {
        const rect = canvas.getBoundingClientRect();
        const position = clamp((clientX - rect.left) / rect.width, 0, 0.999999);
        return Math.min(getLaneCount(mode) - 1, Math.floor(position * getLaneCount(mode)));
      },
      pointerCatcher(clientX, clientY, mode) {
        const rect = canvas.getBoundingClientRect();
        const gameState = getState();
        const activeCatchers = catchers.slice(0, getLaneCount(mode)).map((lane, index) => {
          const fallbackY = SIDE_Y[gameState.catchers[index]?.activeSide || 0];
          const renderedY = lane.userData.flipper.position.y;
          return {
            index,
            x: laneX(index, mode),
            y: Number.isFinite(renderedY) ? renderedY : fallbackY
          };
        });
        const areas = createCatcherHitAreas({
          rect,
          halfWidth: state.halfWidth,
          halfHeight: state.halfHeight,
          catchers: activeCatchers
        });
        return findPointerCatcher({ clientX, clientY, areas });
      },
    createDisk({ color, lane, effectiveSpeedScale, speedMultiplier = 1, overlapSpeedReduction = 0, special = false, mystery = false }) {
      const group = makeDisk({ shadowTexture, glowTexture, colorName: color, speedScale: effectiveSpeedScale, speedMultiplier, overlapSpeedReduction, special, mystery, teleportText: getText("teleporting") });
      group.position.set(laneX(lane, getState().mode), GAME.spawnY, GAME.diskLayerZ);
      world.add(group);
      return group;
    },
    moveDiskToLane(group, lane) {
      group.position.x = laneX(lane, getState().mode);
    },
    revealMysteryDisk,
    removeDisk(group) {
      world.remove(group);
      group.traverse((child) => {
        child.geometry?.dispose();
        child.material?.dispose();
      });
    },
    update,
    render() {
      renderer2.render(scene, camera);
    },
    dispose() {
      window.removeEventListener("resize", resize);
      renderer2.dispose();
    }
  };
}
export { applyDockState, applyFlipPose, applyMonsterVisibility, createCatcherHitAreas, createRenderer, easeFlip, findPointerCatcher, isGameplayVisible, makeBackdropTexture, makeBoxStroke, makeDiffuseGlowTexture, makeDiffuseShadow, makeDiffuseShadowTexture, makeDisk, makeMonsterModel, makeOuterRingStroke, makeSpacecraftModel, makeSpikyGeometry, makeWhiteSilhouette, revealMysteryDisk, setOpacity };
