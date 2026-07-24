import { AdditiveBlending, CanvasTexture, Mesh, MeshBasicMaterial, SphereGeometry, Sprite, SpriteMaterial, Vector3 } from "three";
import { COLORS, clamp } from "./config.js";

function createEffects({ group }) {
  const particles = [];
  const floatTexts = [];
  const fireworkColors = [COLORS.lime, COLORS.red, COLORS.cyan, COLORS.violet, COLORS.white];
  let fireworksActive = false;
  let fireworkCountdown = 0;
  function addFloatText(text, position, color) {
    const canvas = document.createElement("canvas");
    canvas.width = 420;
    canvas.height = 160;
    const context = canvas.getContext("2d");
    context.font = '500 72px "Roboto Medium", Roboto, Arial';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = color;
    context.shadowColor = "rgba(16, 3, 24, .92)";
    context.shadowBlur = 14;
    context.shadowOffsetY = 4;
    context.fillText(text, 210, 80);
    const texture = new CanvasTexture(canvas);
    const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.position.set(position.x, position.y, 5);
    sprite.scale.set(1.85, 0.72, 1);
    group.add(sprite);
    floatTexts.push({ sprite, texture, life: 1 });
  }
  function burst(position, color = COLORS.lime, amount = 16) {
    for (let index = 0; index < amount; index += 1) {
      const particle = new Mesh(
        new SphereGeometry(0.035 + Math.random() * 0.05, 7, 6),
        new MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false })
      );
      particle.position.set(position.x, position.y, 4);
      group.add(particle);
      particles.push({
        mesh: particle,
        life: 0.45 + Math.random() * 0.5,
        maxLife: 0.95,
        gravity: 3.8,
        celebration: false,
        velocity: new Vector3(-1.7 + Math.random() * 3.4, 0.4 + Math.random() * 2.4, -0.2 + Math.random() * 0.4)
      });
    }
  }
  function addFireworkParticle({ position, color, angle }) {
    const life = 1.5 + Math.random();
    const speed = 1.4 + Math.random() * 2.8;
    const particle = new Mesh(
      new SphereGeometry(0.055 + Math.random() * 0.055, 8, 7),
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.86,
        depthWrite: false,
        blending: AdditiveBlending
      })
    );
    particle.position.set(position.x, position.y, 4);
    group.add(particle);
    particles.push({
      mesh: particle,
      life,
      maxLife: life,
      gravity: 1.45,
      celebration: true,
      velocity: new Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, 0)
    });
  }
  function fireworkBurst(position, color) {
    const amount = 30;
    for (let index = 0; index < amount; index += 1) {
      const angle = Math.PI * 2 * index / amount + Math.random() * 0.12;
      addFireworkParticle({ position, color, angle });
    }
  }
  function randomFirework() {
    const position = { x: -5.4 + Math.random() * 10.8, y: -0.4 + Math.random() * 5.4 };
    const color = fireworkColors[Math.floor(Math.random() * fireworkColors.length)];
    fireworkBurst(position, color);
    fireworkCountdown = 0.45 + Math.random() * 0.35;
  }
  function startVictoryFireworks() {
    stopVictoryFireworks();
    fireworksActive = true;
    fireworkBurst({ x: -4.6, y: 2.5 }, COLORS.lime);
    fireworkBurst({ x: 0, y: 4.1 }, COLORS.cyan);
    fireworkBurst({ x: 4.6, y: 2.2 }, COLORS.red);
    fireworkCountdown = 0.55;
  }
  function removeParticle(particle, index) {
    group.remove(particle.mesh);
    dispose(particle.mesh);
    particles.splice(index, 1);
  }
  function stopVictoryFireworks() {
    fireworksActive = false;
    fireworkCountdown = 0;
    for (let index = particles.length - 1; index >= 0; index -= 1) {
      if (particles[index].celebration) removeParticle(particles[index], index);
    }
  }
  function dispose(object) {
    object.traverse((child) => {
      child.geometry?.dispose();
      if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
      else child.material?.dispose();
    });
  }
  function update(delta) {
    if (fireworksActive) {
      fireworkCountdown -= delta;
      if (fireworkCountdown <= 0) randomFirework();
    }
    for (let index = particles.length - 1; index >= 0; index -= 1) {
      const particle = particles[index];
      particle.life -= delta;
      particle.velocity.y -= delta * particle.gravity;
      particle.mesh.position.addScaledVector(particle.velocity, delta);
      particle.mesh.material.opacity = clamp(particle.life / particle.maxLife, 0, 1) * 0.9;
      if (particle.life <= 0) {
        removeParticle(particle, index);
      }
    }
    for (let index = floatTexts.length - 1; index >= 0; index -= 1) {
      const floating = floatTexts[index];
      floating.life -= delta * 1.35;
      floating.sprite.position.y += delta * 0.65;
      floating.sprite.material.opacity = clamp(floating.life * 1.7, 0, 1);
      if (floating.life <= 0) {
        group.remove(floating.sprite);
        floating.texture.dispose();
        floating.sprite.material.dispose();
        floatTexts.splice(index, 1);
      }
    }
  }
  function clear() {
    fireworksActive = false;
    fireworkCountdown = 0;
    particles.splice(0).forEach((particle) => {
      group.remove(particle.mesh);
      dispose(particle.mesh);
    });
    floatTexts.splice(0).forEach((floating) => {
      group.remove(floating.sprite);
      floating.texture.dispose();
      floating.sprite.material.dispose();
    });
  }
  return { addFloatText, burst, startVictoryFireworks, stopVictoryFireworks, update, clear };
}
export { createEffects };
