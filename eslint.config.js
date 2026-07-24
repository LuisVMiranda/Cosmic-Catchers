import eslint from "@eslint/js";

const browserGlobals = {
  AudioContext: "readonly",
  Event: "readonly",
  EventTarget: "readonly",
  clearInterval: "readonly",
  clearTimeout: "readonly",
  document: "readonly",
  localStorage: "readonly",
  performance: "readonly",
  setInterval: "readonly",
  setTimeout: "readonly",
  window: "readonly"
};

const nodeGlobals = {
  Buffer: "readonly",
  console: "readonly",
  process: "readonly",
  structuredClone: "readonly",
  URL: "readonly"
};

const qualityRules = {
  complexity: ["error", 10],
  "max-depth": ["error", 3],
  "max-lines": ["error", { max: 600, skipBlankLines: true, skipComments: true }],
  "max-params": ["error", 5],
  "no-duplicate-imports": "error",
  "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }]
};

export default [
  { ignores: ["coverage/**", "dist/**", "node_modules/**", "playwright-report/**", "test-results/**"] },
  eslint.configs.recommended,
  {
    files: ["src/js/**/*.js"],
    languageOptions: { globals: { ...browserGlobals, __COSMIC_TEST__: "readonly" } },
    rules: qualityRules
  },
  {
    files: ["scripts/**/*.mjs", "*.config.js"],
    languageOptions: { globals: nodeGlobals },
    rules: qualityRules
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: { globals: { ...browserGlobals, ...nodeGlobals } },
    rules: qualityRules
  }
];
