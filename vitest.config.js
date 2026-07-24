import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/js/**/*.js"],
      exclude: ["src/js/main.js"],
      thresholds: {
        branches: 85,
        functions: 90,
        lines: 90,
        statements: 90,
        "src/js/audio.js": { branches: 87, functions: 97, lines: 100, statements: 97 },
        "src/js/campaign.js": { branches: 94, functions: 100, lines: 100, statements: 100 },
        "src/js/difficulty.js": { branches: 96, functions: 100, lines: 100, statements: 100 },
        "src/js/game-loop.js": { branches: 93, functions: 98, lines: 100, statements: 98 },
        "src/js/input.js": { branches: 98, functions: 100, lines: 100, statements: 100 },
        "src/js/patterns.js": { branches: 96, functions: 100, lines: 100, statements: 99 },
        "src/js/state.js": { branches: 95, functions: 100, lines: 100, statements: 100 }
      }
    },
    restoreMocks: true,
    testTimeout: 10000
  }
});
