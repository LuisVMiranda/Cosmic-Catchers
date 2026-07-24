# Test matrix

| Feature / outcome | Module | Automated coverage |
| --- | --- | --- |
| Every command across all seven statuses | `state.js` | `state.test.js`, `state-exhaustive.test.js` |
| Easy/Hard and Campaign/Endless boundaries | `campaign.js`, `difficulty.js`, `state.js` | `rules.test.js`, `state-exhaustive.test.js` |
| Seeded plans and explicit phase boundaries | `patterns.js`, `game-loop.js` | `patterns.test.js` (1,000 runs/property group), `patterns-negative.test.js` |
| Invalid plans and fallback generation | `patterns.js`, `game-loop.js` | `patterns-negative.test.js`, `game-loop-fallback.test.js` |
| Success, duplicate, stale, wrong side, flipping, invalid lane | `state.js` | `state.test.js`, `state-exhaustive.test.js` |
| Records, wins, fastest clear, unlocks | `state.js`, `persistence.js` | `state-exhaustive.test.js`, `localization-persistence.test.js` |
| Empty, legacy, malformed, inaccessible storage | `persistence.js`, `audio.js` | `localization-persistence.test.js`, `audio-sequencing.test.js` |
| English/Portuguese key and placeholder parity | `localization.js` | `localization-persistence.test.js` |
| Loop start/stop/idempotence/delta clamp/order | `game-loop.js` | `game-loop.test.js`, `game-loop-branches.test.js` |
| Spawn blocked/safe, queue capacity, delivery conflict | `game-loop.js` | `game-loop-branches.test.js` |
| Teleport travel/wait/block/release/relocation/arrival | `game-loop.js` | `game-loop-branches.test.js` |
| Capture delay, cleanup, batch completion, extraction, victory | `game-loop.js`, `state.js` | integration loop suites |
| Mouse lane behavior and every keyboard mapping | `input.js` | `input.test.js` |
| Touch/pen center, bounds, outside, overlap, non-primary | `renderer.js`, `input.js` | `renderer-input.test.js`, `input.test.js` |
| Portrait/landscape and Easy/Hard catcher projection | `renderer.js`, `world.js` | `renderer-input.test.js`, direct-file E2E matrix |
| In-place catcher flips and shared collecting spot Y | `config.js`, `renderer.js`, `difficulty.js`, `game-loop.js` | `visual-modules.test.js`, `rules.test.js`, `game-loop-branches.test.js` |
| Mystery disk unlock phases, seeded frequency ramp, split visual, halfway flicker/morph, and final-side collection | `patterns.js`, `renderer.js`, `game-loop.js` | `patterns-negative.test.js`, `visual-modules.test.js`, `game-loop-branches.test.js`, property plans |
| Pause visibility, size, localized state, propagation | `ui.js`, responsive CSS | `ui.test.js`, direct-file E2E matrix |
| Easy/Hard game-over exclusivity and one-second gap | `audio.js` | `audio.test.js`, `audio-sequencing.test.js` |
| Ended/watchdog/hard cap/rejected play/gesture/races | `audio.js` | `audio-sequencing.test.js` |
| Late menu/game-over `play()` resolution and 1,000 seeded interleavings | `audio.js` | `audio-sequencing.test.js` |
| Restart/menu cancellation and duplicate failure | `audio.js` | `audio-sequencing.test.js` |
| Victory soundtrack asset and exclusive victory-to-menu handoff | `audio.js`, build manifest | `audio-sequencing.test.js`, artifact checks |
| Scene creation, visual updates, disposal, fireworks | renderer/effects modules | `visual-modules.test.js` |
| Build-time assembly, classic IIFE, IDs, assets, budget | build scripts | `verify-assets.mjs`, `verify-bundle.mjs` |
| Root playable file exactly matches verified `dist` release | build scripts | `verify-bundle.mjs` byte-parity gate |
| Encoded `#` filename and direct local assets | release artifact | `direct-file.spec.js` via `pathToFileURL()` |
| Chrome, Edge, Firefox; phone/tablet orientations | release artifact | Playwright projects and responsive matrix |
| Portable executable starts with clean stats and preserves later launches | `desktop/profile.cjs`, `desktop/main.cjs` | `desktop-profile.test.js`, packaged `.exe` smoke verification |

Coverage gates:

- Global minimum: 90% lines/functions/statements and 85% branches.
- Current result is locked more tightly per core module in `vitest.config.js`.
- Source constraints are enforced by ESLint and `quality-gate.mjs`: at most 600 active lines/file, complexity 10, five parameters, and nesting depth three.
