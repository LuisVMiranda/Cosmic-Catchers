// @vitest-environment jsdom

import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("three", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    WebGLRenderer: class {
      constructor() {
        this.dispose = vi.fn();
        this.render = vi.fn();
        this.setClearColor = vi.fn();
        this.setPixelRatio = vi.fn();
        this.setSize = vi.fn();
      }
    }
  };
});

import {
  createRocketField,
  launchRocket,
  makeRocket,
  makeRocketTrailTexture,
  resetRocket,
  routeStartY
} from "../../src/js/background-effects.js";
import { COLORS, GAME, SIDE_Y } from "../../src/js/config.js";
import {
  drawTooltip,
  getApproachPresentation,
  makeTeleportTooltip,
  syncTeleportTooltip
} from "../../src/js/disk-visuals.js";
import { createEffects } from "../../src/js/effects.js";
import {
  applyDockState,
  applyFlipPose,
  applyMonsterVisibility,
  createRenderer,
  easeFlip,
  isGameplayVisible,
  makeBackdropTexture,
  makeBoxStroke,
  makeDiffuseGlowTexture,
  makeDiffuseShadow,
  makeDiffuseShadowTexture,
  makeDisk,
  makeMonsterModel,
  makeOuterRingStroke,
  makeSpacecraftModel,
  makeSpikyGeometry,
  makeWhiteSilhouette,
  revealMysteryDisk,
  setOpacity
} from "../../src/js/renderer.js";
import { createInitialState } from "../../src/js/state.js";
import { getViewBounds } from "../../src/js/world.js";

function canvasContext() {
  const gradient = { addColorStop: vi.fn() };
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeRect: vi.fn()
  };
}

function installCanvas() {
  vi.spyOn(window.HTMLCanvasElement.prototype, "getContext").mockImplementation(() => canvasContext());
}

describe("canvas textures and background effects", () => {
  beforeEach(() => {
    installCanvas();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => vi.restoreAllMocks());

  it("builds backdrop, shadow, glow, and tooltip textures", () => {
    expect(makeBackdropTexture().image.width).toBe(1600);
    expect(makeDiffuseShadowTexture().image.height).toBe(48);
    expect(makeDiffuseGlowTexture().image.height).toBe(192);
    expect(makeRocketTrailTexture().image.width).toBe(256);
    const tooltip = makeTeleportTooltip("Teleporting");
    expect(tooltip.visible).toBe(false);
    syncTeleportTooltip({ tooltip, text: "Teleporting", visible: true });
    expect(tooltip.visible).toBe(true);
    syncTeleportTooltip({ tooltip, text: "Teletransportando", visible: false });
    expect(tooltip.userData.text).toBe("Teletransportando");
    expect(tooltip.material.map.version).toBeGreaterThan(0);
    expect(() => syncTeleportTooltip({ tooltip: null, text: "x", visible: true })).not.toThrow();
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 50;
    expect(() => drawTooltip({ canvas, text: "Ready" })).not.toThrow();
  });

  it("calculates approach fade bounds", () => {
    expect(getApproachPresentation(GAME.approachFadeDistance * 2)).toEqual({ scale: 1, opacity: 1 });
    expect(getApproachPresentation(0)).toEqual({ scale: GAME.approachMinScale, opacity: GAME.approachMinOpacity });
  });

  it("cycles rocket routes, launches, fades, and resets", () => {
    const rocket = makeRocket({ trailTexture: makeRocketTrailTexture() });
    resetRocket(rocket);
    expect(rocket.visible).toBe(false);
    expect(routeStartY({ velocityY: 1 })).toBeLessThan(0);
    expect(routeStartY({ velocityY: -1 })).toBeGreaterThan(0);
    expect(routeStartY({ velocityY: 0 })).toBeGreaterThan(0);
    launchRocket({ rocket, halfWidth: 8 });
    expect(rocket.userData).toMatchObject({ active: true, routeIndex: 0, velocityY: 0 });
    launchRocket({ rocket, halfWidth: 8 });
    expect(rocket.userData.velocityY).toBe(0.82);
    launchRocket({ rocket, halfWidth: 8 });
    expect(rocket.userData.velocityY).toBe(-0.82);
    const parent = new Group();
    const field = createRocketField({ parent, getHalfWidth: () => 8 });
    const managed = parent.children[0];
    managed.userData.wait = 0;
    field.update(0.1);
    expect(managed.userData.active).toBe(true);
    field.update(0.1);
    managed.userData.elapsed = managed.userData.duration;
    field.update(0.1);
    expect(managed.userData.active).toBe(false);
  });
});

describe("renderer model helpers", () => {
  beforeEach(() => {
    installCanvas();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => vi.restoreAllMocks());

  it("builds all models, strokes, shadows, and disks", () => {
    const geometry = new PlaneGeometry(1, 1);
    expect(makeWhiteSilhouette(geometry).position.z).toBe(-0.05);
    expect(makeBoxStroke(2, 3).renderOrder).toBe(5);
    expect(makeMonsterModel("green").children.length).toBeGreaterThan(5);
    expect(makeMonsterModel("red", 0.5).scale.x).toBe(0.5);
    expect(makeSpikyGeometry()).toBeDefined();
    expect(makeSpacecraftModel().children.length).toBe(10);
    expect(makeOuterRingStroke()).toBeInstanceOf(Mesh);
    const shadow = makeDiffuseShadow({ texture: makeDiffuseShadowTexture(), width: 2, height: 1, opacity: 0.2 });
    expect(shadow.material.opacity).toBe(0.2);
    const normal = makeDisk({
      shadowTexture: makeDiffuseShadowTexture(),
      glowTexture: makeDiffuseGlowTexture(),
      colorName: "green",
      speedScale: 1,
      speedMultiplier: 1,
      overlapSpeedReduction: 0,
      special: false,
      teleportText: "Teleporting"
    });
    expect(normal.userData.specialGlow).toBeNull();
    const special = makeDisk({
      shadowTexture: makeDiffuseShadowTexture(),
      glowTexture: makeDiffuseGlowTexture(),
      colorName: "red",
      speedScale: 2,
      speedMultiplier: 1.2,
      overlapSpeedReduction: 0.45,
      special: true,
      teleportText: "Teleporting"
    });
    expect(special.userData.specialGlow).not.toBeNull();
    expect(special.userData.teleportTooltip).not.toBeNull();
    const mystery = makeDisk({
      shadowTexture: makeDiffuseShadowTexture(),
      glowTexture: makeDiffuseGlowTexture(),
      colorName: "green",
      speedScale: 1,
      speedMultiplier: 1,
      overlapSpeedReduction: 0,
      special: true,
      mystery: true,
      teleportText: "Teleporting"
    });
    expect(mystery.userData.mystery).toBe(true);
    expect(mystery.userData.teleportTooltip).toBeNull();
    const [leftHalf, rightHalf] = mystery.userData.mysteryHalves.children;
    const fullGeometry = makeSpikyGeometry();
    fullGeometry.computeBoundingBox();
    leftHalf.geometry.computeBoundingBox();
    rightHalf.geometry.computeBoundingBox();
    expect(leftHalf.geometry.boundingBox.max.x).toBeCloseTo(0);
    expect(rightHalf.geometry.boundingBox.min.x).toBeCloseTo(0);
    expect(leftHalf.geometry.boundingBox.min.x).toBeCloseTo(fullGeometry.boundingBox.min.x);
    expect(rightHalf.geometry.boundingBox.max.x).toBeCloseTo(fullGeometry.boundingBox.max.x);
    expect(leftHalf.geometry.boundingBox.min.y).toBeCloseTo(fullGeometry.boundingBox.min.y);
    expect(rightHalf.geometry.boundingBox.max.y).toBeCloseTo(fullGeometry.boundingBox.max.y);
    expect(leftHalf.material.color.getHex()).toBe(COLORS.green);
    expect(rightHalf.material.color.getHex()).toBe(COLORS.red);
    expect(mystery.userData.finalBody.visible).toBe(false);
    expect(mystery.userData.trail.material.color.getHex()).toBe(COLORS.white);
    revealMysteryDisk(mystery);
    expect(mystery.userData.mysteryHalves.visible).toBe(false);
    expect(mystery.userData.finalBody.visible).toBe(true);
    expect(mystery.userData.trail.material.color.getHex()).toBe(COLORS.green);
    revealMysteryDisk(mystery);
  });

  it("applies opacity, flip easing, pose, visibility, and dock state", () => {
    const lane = new Group();
    const green = makeMonsterModel("green");
    const red = makeMonsterModel("red");
    const flipper = new Group();
    const topDock = new Mesh(new PlaneGeometry(), new MeshBasicMaterial({ opacity: 1 }));
    const bottomDock = new Mesh(new PlaneGeometry(), new MeshBasicMaterial({ opacity: 1 }));
    lane.userData = { bottomDock, flipper, green, red, topDock };
    setOpacity(green, 0.25);
    expect(green.children.find((child) => child.material)?.material.opacity).toBe(0.25);
    const multi = new Mesh(new PlaneGeometry(), [new MeshBasicMaterial(), new MeshBasicMaterial()]);
    const multiGroup = new Group();
    multiGroup.add(multi);
    setOpacity(multiGroup, 0.4);
    expect(multi.material[0].opacity).toBe(0.4);
    expect(easeFlip(0.25)).toBe(0.125);
    expect(easeFlip(0.75)).toBe(0.875);
    const stable = { activeSide: 0, flipping: false };
    applyFlipPose(lane, stable);
    expect(flipper.position.y).toBe(SIDE_Y[0]);
    const flipping = { activeSide: 0, fromSide: 0, toSide: 1, flipProgress: 0.25, flipping: true };
    applyFlipPose(lane, flipping);
    expect(SIDE_Y[1]).toBe(SIDE_Y[0]);
    expect(flipper.position.y).toBe(SIDE_Y[0]);
    expect(flipper.rotation.z).not.toBe(0);
    applyFlipPose(lane, { ...flipping, flipProgress: 0.75 });
    expect(flipper.position.y).toBe(SIDE_Y[0]);
    applyMonsterVisibility(lane, flipping);
    expect(green.visible).toBe(true);
    applyMonsterVisibility(lane, { ...flipping, flipProgress: 0.75 });
    expect(red.visible).toBe(true);
    applyMonsterVisibility(lane, { activeSide: 1, flipping: false });
    expect(green.visible).toBe(false);
    applyDockState(lane, stable);
    expect(topDock.material.opacity).toBe(0.55);
    applyDockState(lane, { activeSide: 1 });
    expect(bottomDock.material.opacity).toBe(0.55);
    expect(isGameplayVisible("ready")).toBe(false);
    expect(isGameplayVisible("entering")).toBe(false);
    expect(isGameplayVisible("playing")).toBe(true);
  });
});

describe("renderer adapter", () => {
  beforeEach(() => {
    installCanvas();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => vi.restoreAllMocks());

  it("resizes, maps pointer input, animates both modes, and owns disk resources", () => {
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 600 });
    canvas.getBoundingClientRect = () => ({ bottom: 600, height: 600, left: 0, right: 800, top: 0, width: 800 });
    let current = createInitialState({ mode: "easy" });
    const renderer = createRenderer({
      canvas,
      getState: () => current,
      getText: (key) => key
    });
    expect(renderer.laneX(0, "easy")).toBeLessThan(renderer.laneX(1, "easy"));
    expect(renderer.getPlayfieldCenterX("easy")).toBeGreaterThan(0);
    expect(renderer.pointerLane(-10, "easy")).toBe(0);
    expect(renderer.pointerLane(1000, "hard")).toBe(2);
    current = { ...current, status: "playing" };
    renderer.update({ gameState: current, disks: [], delta: 0.1 });
    const view = getViewBounds({ width: 800, height: 600 });
    const laneX = renderer.laneX(0, "easy");
    const catcherX = (laneX + view.halfWidth) / (view.halfWidth * 2) * 800;
    const catcherY = (view.halfHeight - SIDE_Y[0]) / (view.halfHeight * 2) * 600;
    expect(renderer.pointerCatcher(catcherX, catcherY, "easy")).toBe(0);
    expect(renderer.pointerCatcher(799, 10, "easy")).toBe(-1);
    current = { ...current, mode: "hard", status: "playing" };
    current.catchers[0] = { ...current.catchers[0], flipping: true, fromSide: 0, toSide: 1, flipProgress: 0.6 };
    renderer.update({ gameState: current, disks: [], delta: 10 });
    const normal = renderer.createDisk({ color: "green", lane: 0, effectiveSpeedScale: 1 });
    const special = renderer.createDisk({
      color: "red",
      lane: 1,
      effectiveSpeedScale: 2,
      speedMultiplier: 1.2,
      overlapSpeedReduction: 0.45,
      special: true
    });
    const normalDisk = { color: "green", group: normal, lane: 0, targetY: SIDE_Y[0], teleport: null };
    const specialDisk = {
      color: "red",
      group: special,
      lane: 1,
      targetY: SIDE_Y[1],
      teleport: { elapsed: 0.1, state: "waiting" }
    };
    const mysteryGroup = renderer.createDisk({ color: "green", lane: 2, effectiveSpeedScale: 1, special: true, mystery: true });
    const mysteryDisk = {
      color: "green",
      group: mysteryGroup,
      lane: 2,
      targetY: SIDE_Y[0],
      mystery: { elapsed: GAME.mysteryMorphDuration / 2, morphDuration: GAME.mysteryMorphDuration, flickerRate: GAME.mysteryFlickerRate, state: "morphing" },
      teleport: null
    };
    renderer.update({ gameState: current, disks: [normalDisk, specialDisk], delta: 0.1 });
    renderer.update({ gameState: current, disks: [mysteryDisk], delta: 0.1 });
    expect(mysteryGroup.userData.body.scale.y).toBeLessThan(1);
    mysteryDisk.mystery.state = "revealed";
    renderer.update({ gameState: current, disks: [mysteryDisk], delta: 0.1 });
    expect(mysteryGroup.userData.body.scale.y).toBe(1);
    specialDisk.teleport.elapsed = 0.2;
    renderer.update({ gameState: current, disks: [specialDisk], delta: 0.1 });
    renderer.moveDiskToLane(normal, 2);
    expect(normal.position.x).toBe(renderer.laneX(2, "hard"));
    renderer.render();
    renderer.removeDisk(normal);
    renderer.removeDisk(mysteryGroup);
    Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 0 });
    Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 0 });
    renderer.resize();
    renderer.dispose();
  });
});

describe("effects adapter", () => {
  beforeEach(() => {
    installCanvas();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => vi.restoreAllMocks());

  it("creates, advances, expires, stops, and clears every effect type", () => {
    const group = new Group();
    const effects = createEffects({ group });
    effects.addFloatText("+1", { x: 1, y: 2 }, "#fff");
    effects.burst({ x: 0, y: 0 }, undefined, 2);
    expect(group.children.length).toBe(3);
    effects.update(0.1);
    effects.update(2);
    expect(group.children.length).toBe(0);
    effects.startVictoryFireworks();
    expect(group.children.length).toBe(90);
    effects.update(0.6);
    expect(group.children.length).toBeGreaterThan(90);
    effects.stopVictoryFireworks();
    expect(group.children.length).toBe(0);
    effects.addFloatText("x", { x: 0, y: 0 }, "#fff");
    effects.burst({ x: 0, y: 0 }, 1, 1);
    effects.clear();
    expect(group.children.length).toBe(0);
  });
});
