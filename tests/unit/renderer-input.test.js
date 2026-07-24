import { describe, expect, it } from "vitest";
import { createCatcherHitAreas, findPointerCatcher } from "../../src/js/renderer.js";

function sampleAreas(overrides = {}) {
  return createCatcherHitAreas({
    rect: { left: 0, top: 0, width: 320, height: 640 },
    halfWidth: 4,
    halfHeight: 8,
    catchers: [
      { index: 0, x: -2, y: -1.775 },
      { index: 1, x: 2, y: -4.525 }
    ],
    ...overrides
  });
}

describe("catcher touch hit-testing", () => {
  it("projects world positions into screen hit areas with a 44px minimum", () => {
    const areas = sampleAreas({
      rect: { left: 10, top: 20, width: 80, height: 120 },
      halfWidth: 20,
      halfHeight: 30,
      catchers: [{ index: 0, x: 0, y: 0 }]
    });
    expect(areas).toEqual([expect.objectContaining({ index: 0, centerX: 50, centerY: 80 })]);
    expect(areas[0].halfWidth).toBe(22);
    expect(areas[0].halfHeight).toBe(22);
  });

  it("accepts the center and inclusive edges but rejects points outside", () => {
    const [area] = sampleAreas();
    expect(findPointerCatcher({ clientX: area.centerX, clientY: area.centerY, areas: [area] })).toBe(0);
    expect(findPointerCatcher({ clientX: area.centerX + area.halfWidth, clientY: area.centerY, areas: [area] })).toBe(0);
    expect(findPointerCatcher({ clientX: area.centerX + area.halfWidth + 0.01, clientY: area.centerY, areas: [area] })).toBe(-1);
  });

  it("chooses the nearest catcher when enlarged touch areas overlap", () => {
    const areas = [
      { index: 0, centerX: 100, centerY: 300, halfWidth: 60, halfHeight: 60 },
      { index: 1, centerX: 140, centerY: 300, halfWidth: 60, halfHeight: 60 }
    ];
    expect(findPointerCatcher({ clientX: 132, clientY: 300, areas })).toBe(1);
    expect(findPointerCatcher({ clientX: 108, clientY: 300, areas })).toBe(0);
  });

  it("returns no areas for unusable canvas dimensions", () => {
    expect(sampleAreas({ rect: { left: 0, top: 0, width: 0, height: 0 } })).toEqual([]);
  });
});

