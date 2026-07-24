import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const gameUrl = pathToFileURL(path.join(root, "dist", "## JOGUE AQUI.test.html")).href;

function captureRuntimeFailures(page) {
  const failures = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (request.url().startsWith("file:")) failures.push(`requestfailed: ${request.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  return failures;
}

async function openGame(page) {
  const failures = captureRuntimeFailures(page);
  await page.goto(gameUrl, { waitUntil: "load" });
  await expect(page.locator("#ready-screen")).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.__COSMIC_TEST__))).toBe(true);
  return failures;
}

test("opens its encoded # filename from file:// with local assets", async ({ page }) => {
  const failures = await openGame(page);
  expect(new URL(gameUrl).protocol).toBe("file:");
  expect(gameUrl).toContain("%23%23");
  expect(gameUrl).not.toContain("##");
  expect(failures).toEqual([]);
});

test("preserves desktop mode, language, keyboard, and mouse paths", async ({ page }) => {
  const failures = await openGame(page);
  await page.locator('[data-mode-option="hard"]').click();
  await page.locator("#language-button").click();
  await page.locator("#start-button").click();
  await page.evaluate(() => window.__COSMIC_TEST__.store.dispatch({ type: "ADVANCE_RUN_TRANSITION", deltaSeconds: 2 }));
  await expect(page.locator("#shell")).toHaveAttribute("data-state", "playing");
  await page.keyboard.press("KeyA");
  await page.locator("#game-canvas").click({ position: { x: 10, y: 200 } });
  expect(await page.evaluate(() => window.__COSMIC_TEST__.store.getState().mode)).toBe("hard");
  expect(await page.evaluate(() => window.__COSMIC_TEST__.store.getState().language)).toBe("pt");
  expect(failures).toEqual([]);
});

test("preserves existing storage keys after direct-file reload", async ({ page }) => {
  const failures = await openGame(page);
  await page.evaluate(() => {
    localStorage.setItem("cosmic-catchers-mode", "hard");
    localStorage.setItem("cosmic-catchers-language", "pt-BR");
    localStorage.setItem("cosmic-catchers-campaign-best-hard", "17");
  });
  await page.reload({ waitUntil: "load" });
  await expect.poll(() => page.evaluate(() => Boolean(window.__COSMIC_TEST__))).toBe(true);
  const restored = await page.evaluate(() => {
    const state = window.__COSMIC_TEST__.store.getState();
    return { best: state.campaignBestByMode.hard, language: state.language, mode: state.mode };
  });
  expect(restored).toEqual({ best: 17, language: "pt-BR", mode: "hard" });
  expect(failures).toEqual([]);
});

test("requires two confirmations and clears only game progress", async ({ page }) => {
  const failures = await openGame(page);
  await page.evaluate(() => {
    localStorage.setItem("cosmic-catchers-language", "pt-BR");
    localStorage.setItem("cosmic-catchers-mode", "hard");
    localStorage.setItem("cosmic-catchers-volume", '{"music":20,"sfx":30}');
    localStorage.setItem("cosmic-catchers-campaign-best-hard", "17");
    localStorage.setItem("cosmic-catchers-endless-best-hard", "11");
    localStorage.setItem("cosmic-catchers-wins-hard", "3");
    localStorage.setItem("cosmic-catchers-fastest-hard", "42");
    localStorage.setItem("cosmic-catchers-endless-unlocked-hard", "true");
  });
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("#reset-stats-button")).toBeVisible();
  await page.locator("#reset-stats-button").click();
  await expect(page.locator("#reset-screen")).toBeVisible();
  await page.locator("#reset-continue-button").click();
  await expect(page.locator("#reset-step-two")).toBeVisible();
  await page.locator("#reset-confirm-button").click();
  await expect(page.locator("#reset-screen")).toBeHidden();
  const result = await page.evaluate(() => {
    const state = window.__COSMIC_TEST__.store.getState();
    return {
      state: {
        best: state.best,
        campaignBestByMode: state.campaignBestByMode,
        endlessBestByMode: state.endlessBestByMode,
        endlessUnlockedByMode: state.endlessUnlockedByMode,
        language: state.language,
        mode: state.mode,
        runType: state.runType,
        status: state.status,
        winsByMode: state.winsByMode
      },
      storage: Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]))
    };
  });
  expect(result.state).toMatchObject({
    best: 0,
    campaignBestByMode: { easy: 0, hard: 0 },
    endlessBestByMode: { easy: 0, hard: 0 },
    endlessUnlockedByMode: { easy: false, hard: false },
    language: "pt-BR",
    mode: "hard",
    runType: "campaign",
    status: "ready",
    winsByMode: { easy: 0, hard: 0 }
  });
  expect(result.storage).toMatchObject({
    "cosmic-catchers-language": "pt-BR",
    "cosmic-catchers-mode": "hard",
    "cosmic-catchers-volume": '{"music":20,"sfx":30}'
  });
  for (const key of [
    "cosmic-catchers-best-easy", "cosmic-catchers-best-hard",
    "cosmic-catchers-campaign-best-easy", "cosmic-catchers-campaign-best-hard",
    "cosmic-catchers-endless-best-easy", "cosmic-catchers-endless-best-hard",
    "cosmic-catchers-wins-easy", "cosmic-catchers-wins-hard",
    "cosmic-catchers-fastest-easy", "cosmic-catchers-fastest-hard",
    "cosmic-catchers-endless-unlocked-easy", "cosmic-catchers-endless-unlocked-hard"
  ]) expect(result.storage[key]).toBeUndefined();
  expect(failures).toEqual([]);
});

test("keeps both localized reset steps inside the panel", async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 727, height: 651 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    await openGame(page);
    await page.evaluate(() => localStorage.setItem("cosmic-catchers-language", "pt-BR"));
    await page.reload({ waitUntil: "load" });
    await page.locator("#reset-stats-button").click();
    for (const nextStep of ["#reset-step-one", "#reset-step-two"]) {
      const overflow = await page.evaluate((stepSelector) => {
        const panel = document.querySelector("#reset-screen .reset-panel");
        const step = document.querySelector(stepSelector);
        const nodes = [panel, step, ...step.querySelectorAll("*")].filter(Boolean);
        return nodes.filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.id || node.className);
      }, nextStep);
      expect(overflow).toEqual([]);
      if (nextStep === "#reset-step-one") await page.locator("#reset-continue-button").click();
    }
    await page.locator("#reset-back-button").click();
    await page.locator("#reset-cancel-button").click();
  }
});

test("renders every state overlay without changing the fixed DOM contract", async ({ page }) => {
  const failures = await openGame(page);
  for (const status of ["ready", "entering", "playing", "paused", "extraction", "gameover", "victory"]) {
    await page.evaluate((nextStatus) => {
      const testApi = window.__COSMIC_TEST__;
      testApi.store.replace({ ...testApi.store.getState(), status: nextStatus });
    }, status);
    await expect(page.locator("#shell")).toHaveAttribute("data-state", status);
  }
  await expect(page.locator("#mobile-pause-button")).toBeHidden();
  expect(failures).toEqual([]);
});

test("renders mystery disks as exact green-left and pink-right spiky halves", async ({ page }, testInfo) => {
  const failures = await openGame(page);
  const model = await page.evaluate(() => {
    const testApi = window.__COSMIC_TEST__;
    testApi.store.replace({ ...testApi.store.getState(), status: "playing" });
    const disk = testApi.renderer.createDisk({
      color: "green",
      lane: 0,
      effectiveSpeedScale: 1,
      special: true,
      mystery: true
    });
    disk.position.y = 2.7;
    const [left, right] = disk.userData.mysteryHalves.children;
    left.geometry.computeBoundingBox();
    right.geometry.computeBoundingBox();
    return {
      finalHidden: !disk.userData.finalBody.visible,
      leftColor: left.material.color.getHex(),
      leftMax: left.geometry.boundingBox.max.x,
      rightColor: right.material.color.getHex(),
      rightMin: right.geometry.boundingBox.min.x
    };
  });
  expect(model).toEqual({
    finalHidden: true,
    leftColor: 0x8db345,
    leftMax: 0,
    rightColor: 0xff557f,
    rightMin: 0
  });
  await page.locator("#game-canvas").screenshot({ path: testInfo.outputPath("mystery-disk-halves.png") });
  expect(failures).toEqual([]);
});

for (const mode of ["easy", "hard"]) {
  test(`${mode} game-over media never overlaps menu media`, async ({ page }) => {
    const failures = await openGame(page);
    await page.locator("#start-button").click();
    await page.evaluate((nextMode) => {
      const testApi = window.__COSMIC_TEST__;
      const current = testApi.store.getState();
      testApi.store.replace({ ...current, mode: nextMode, status: "gameover" });
      testApi.audio.handleStateChange(testApi.store.getState(), { type: "FAIL_RUN" });
    }, mode);
    const samples = [];
    for (let index = 0; index < 12; index += 1) {
      samples.push(await page.evaluate(() => ({
        gameOver: !document.getElementById("game-over-sound").paused,
        menu: !document.getElementById("menu-music").paused
      })));
      await page.waitForTimeout(50);
    }
    expect(samples.every(({ gameOver, menu }) => !(gameOver && menu))).toBe(true);
    if (samples.some(({ gameOver }) => gameOver)) {
      await page.evaluate(() => document.getElementById("game-over-sound").dispatchEvent(new Event("ended")));
      await page.waitForTimeout(999);
      expect(await page.locator("#menu-music").evaluate((track) => track.paused)).toBe(true);
      await page.waitForTimeout(1);
      expect(await page.locator("#game-over-sound").evaluate((track) => track.paused)).toBe(true);
    }
    expect(failures).toEqual([]);
  });
}

test("game-over watchdog completes only after media is stopped", async ({ page }) => {
  const failures = await openGame(page);
  await page.locator("#start-button").click();
  await page.evaluate(() => {
    const testApi = window.__COSMIC_TEST__;
    testApi.store.replace({ ...testApi.store.getState(), status: "gameover" });
    testApi.audio.handleStateChange(testApi.store.getState(), { type: "FAIL_RUN" });
  });
  await page.waitForTimeout(500);
  expect(await page.locator("#menu-music").evaluate((track) => track.paused)).toBe(true);
  await page.locator("#game-over-sound").evaluate((track) => track.pause());
  await page.waitForTimeout(1250);
  expect(await page.locator("#menu-music").evaluate((track) => track.paused)).toBe(false);
  expect(failures).toEqual([]);
});

for (const device of [
  { name: "phone portrait", width: 390, height: 844 },
  { name: "phone landscape", width: 844, height: 390 },
  { name: "tablet portrait", width: 820, height: 1180 },
  { name: "tablet landscape", width: 1180, height: 820 }
]) {
  test(`${device.name} pause control and touch catcher input`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ hasTouch: true, viewport: device });
    const page = await context.newPage();
    const failures = await openGame(page);
    await page.evaluate(() => {
      const testApi = window.__COSMIC_TEST__;
      const state = testApi.store.getState();
      testApi.store.replace({ ...state, status: "playing" });
    });
    const button = page.locator("#mobile-pause-button");
    if (device.width <= 1100) {
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await button.tap();
      await expect(page.locator("#shell")).toHaveAttribute("data-state", "paused");
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await button.tap();
      await expect(page.locator("#shell")).toHaveAttribute("data-state", "playing");
    } else {
      await expect(button).toBeHidden();
    }
    const hit = await page.evaluate(() => {
      const testApi = window.__COSMIC_TEST__;
      const canvas = document.getElementById("game-canvas");
      const rect = canvas.getBoundingClientRect();
      const mode = testApi.store.getState().mode;
      for (let y = rect.top; y <= rect.bottom; y += 10) {
        for (let x = rect.left; x <= rect.right; x += 10) {
          const lane = testApi.renderer.pointerCatcher(x, y, mode);
          if (lane >= 0) return { lane, x, y };
        }
      }
      return null;
    });
    expect(hit).not.toBeNull();
    const before = await page.evaluate((lane) => window.__COSMIC_TEST__.store.getState().laneFlipCounts[lane], hit.lane);
    await page.touchscreen.tap(hit.x, hit.y);
    const after = await page.evaluate((lane) => window.__COSMIC_TEST__.store.getState().laneFlipCounts[lane], hit.lane);
    expect(after).toBe(before + 1);
    await page.screenshot({ path: testInfo.outputPath(`${device.name.replaceAll(" ", "-")}.png`) });
    expect(failures).toEqual([]);
    await context.close();
  });
}
