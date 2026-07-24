import { AdditiveBlending, CanvasTexture, CircleGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from "three";
import { COLORS, clamp } from "./config.js";

var ROCKET_VERTICAL_SPEEDS = Object.freeze([0, 0.82, -0.82]);
function makeRocketTrailTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 48;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, "rgba(255,155,80,0)");
  gradient.addColorStop(0.45, "rgba(255,155,80,.12)");
  gradient.addColorStop(0.8, "rgba(255,155,80,.62)");
  gradient.addColorStop(1, "rgba(255,220,150,.9)");
  context.filter = "blur(8px)";
  context.fillStyle = gradient;
  context.fillRect(8, 9, 240, 30);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
function makeRocket({ trailTexture }) {
  const rocket = new Group();
  rocket.scale.setScalar(0.62);
  rocket.position.z = -1.55;
  const trail = new Mesh(new PlaneGeometry(1.8, 0.28), new MeshBasicMaterial({
    map: trailTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending
  }));
  trail.position.set(-1.02, 0, -0.2);
  const body = new Mesh(new CylinderGeometry(0.1, 0.13, 0.48, 8), new MeshBasicMaterial({ color: COLORS.white }));
  body.rotation.z = -Math.PI / 2;
  const nose = new Mesh(new ConeGeometry(0.13, 0.24, 8), new MeshBasicMaterial({ color: COLORS.red }));
  nose.rotation.z = -Math.PI / 2;
  nose.position.x = 0.36;
  const window2 = new Mesh(new CircleGeometry(0.055, 12), new MeshBasicMaterial({ color: COLORS.cyan }));
  window2.position.set(0.02, 0, 0.14);
  const flame = new Mesh(new ConeGeometry(0.09, 0.3, 8), new MeshBasicMaterial({ color: 16751440 }));
  flame.rotation.z = Math.PI / 2;
  flame.position.x = -0.39;
  rocket.add(trail, body, nose, window2, flame);
  rocket.userData = { active: false, elapsed: 0, wait: 0, speed: 0, duration: 0, trail, routeIndex: -1, velocityY: 0 };
  return rocket;
}
function resetRocket(rocket) {
  Object.assign(rocket.userData, { active: false, elapsed: 0, wait: 4 + Math.random() * 4 });
  rocket.userData.trail.material.opacity = 0;
  rocket.visible = false;
}
function routeStartY({ velocityY }) {
  if (velocityY > 0) return -4.8 + Math.random() * 1.3;
  if (velocityY < 0) return 4.8 - Math.random() * 1.3;
  return -0.4 + Math.random() * 5.8;
}
function launchRocket({ rocket, halfWidth }) {
  const data = rocket.userData;
  data.active = true;
  data.elapsed = 0;
  data.speed = 4.2 + Math.random() * 1.1;
  data.duration = (halfWidth * 2 + 4) / data.speed;
  data.routeIndex = (data.routeIndex + 1) % ROCKET_VERTICAL_SPEEDS.length;
  data.velocityY = ROCKET_VERTICAL_SPEEDS[data.routeIndex];
  rocket.position.set(-halfWidth - 2, routeStartY(data), -1.55);
  rocket.rotation.z = Math.atan2(data.velocityY, data.speed);
  data.trail.material.opacity = 0.72;
  rocket.visible = true;
}
function createRocketField({ parent, getHalfWidth }) {
  const rocket = makeRocket({ trailTexture: makeRocketTrailTexture() });
  parent.add(rocket);
  resetRocket(rocket);
  return {
    update(delta) {
      const data = rocket.userData;
      if (!data.active) {
        data.wait -= delta;
        if (data.wait <= 0) launchRocket({ rocket, halfWidth: getHalfWidth() });
        return;
      }
      data.elapsed += delta;
      rocket.position.x += data.speed * delta;
      rocket.position.y += data.velocityY * delta;
      const fade = clamp(1 - data.elapsed / Math.max(data.duration * 0.78, 1), 0, 1);
      data.trail.material.opacity = 0.72 * fade;
      if (data.elapsed >= data.duration) resetRocket(rocket);
    }
  };
}
export { ROCKET_VERTICAL_SPEEDS, createRocketField, launchRocket, makeRocket, makeRocketTrailTexture, resetRocket, routeStartY };
