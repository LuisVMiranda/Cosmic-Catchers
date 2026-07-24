# Architecture

## Delivery model

The repository is modular at authoring time and self-contained at release time:

```text
screen partials + ordered CSS + ES modules + Three.js 0.160.0
                              |
                         scripts/build.mjs
                              |
                 one HTML + sibling unchanged assets
                              | \
                              |  \ Electron portable packaging
                              |   \ release/*.exe
                      direct file:// launch
```

No fragment, module, or stylesheet is fetched at runtime. esbuild emits one minified classic IIFE with no code splitting or production source map. Screen partials remain in their original DOM order, so event binding and accessibility relationships retain the monolith contract.

Production builds write byte-identical playable HTML to the repository root and `dist/`. Bundle verification fails when these copies diverge, preventing users from opening a stale root monolith.

## Module responsibilities

| Module | Responsibility |
| --- | --- |
| `config.js` | Immutable rules, storage names, colors, mode constants, and timing. |
| `campaign.js` | Campaign target, finale, and completion boundaries. |
| `difficulty.js` | Speed bands, overlap cadence, arrival safety, and teleport geometry. |
| `patterns.js` | Seeded plans, special disks, recovery batches, and plan validation. |
| `world.js` | View bounds, lane count, and world-space lane positions. |
| `state.js` | Pure command reducer plus state store. |
| `persistence.js` | Safe legacy-compatible localStorage reads and writes. |
| `localization.js` | Complete English and Brazilian Portuguese tables. |
| `renderer.js` | Three.js scene, lane-wide mouse mapping, and projected catcher hit-testing. |
| `background-effects.js` / `disk-visuals.js` / `effects.js` | Visual-only helpers with explicit resource cleanup. |
| `audio.js` | The sole owner of media starts, stops, exclusivity, autoplay recovery, and volume. |
| `input.js` | Keyboard, mouse, touch, pen, focus, blur, and visibility routing. |
| `ui.js` | DOM rendering, localization, controls, overlays, and mobile pause semantics. |
| `game-loop.js` | Deterministic `step(delta)`, spawning, delivery, teleport, collection, and scheduling. |
| `main.js` | Dependency construction and bootstrap only. |

## State and loop contracts

`state.js` owns seven statuses: `ready`, `entering`, `playing`, `paused`, `extraction`, `gameover`, and `victory`. Commands are reduced immutably; unchanged/invalid commands preserve object identity.

`game-loop.js` exposes `start()`, `stop()`, `step(delta)`, and `getDisks()`. Its playing order is fixed:

1. advance run time;
2. advance catcher flips in place at the shared catcher Y coordinate;
3. reduce cooldown;
4. attempt a safe spawn;
5. update/collect/clean disks;
6. update renderer state;
7. update effects;
8. render UI.

The animation-frame adapter clamps browser deltas to `GAME.maxFrameDelta`. Tests inject a deterministic scheduler.

## Mobile input

Desktop mouse clicks retain lane-wide selection. Touch and pen events use each visible catcher's current animated world position. Renderer projection creates at least a 44×44 CSS-pixel target, expands to projected visual bounds when larger, and chooses the nearest catcher when Hard-mode areas intersect. Input outside every target returns `-1`.

Catchers use one fixed world Y for both sides. Flip state changes orientation and active color only; disk targets, arrival timing, teleport triggers, and collection effects use that same Y.

The canvas alone uses `touch-action: none` and disabled selection. The responsive pause control is a native button, honors safe-area insets, stops propagation, and dispatches through the same PAUSE/RESUME reducer path.

## Audio invariant

`audio.js` is the only module allowed to call media `play()` or `pause()`. Game-over and victory are exclusive one-shots. Victory uses `cosmic-catchers-game-win-soundtrack.mp3`; the prior winning MP3 remains packaged as an unreferenced rollback asset:

- all continuous and one-shot tracks stop first;
- menu requests queue while game-over is active;
- victory menu requests queue until the victory clip ends (or its guarded fallback completes);
- `ended` is primary completion;
- a 250ms watchdog accepts only paused/ended media;
- a 15-second cap explicitly stops/resets game-over;
- menu waits one additional second after confirmed stoppage;
- generation tokens make stale timers and racing completion signals harmless;
- resolved playback requests are revalidated so a track that starts after cancellation is stopped again;
- restart/menu actions cancel game-over before another track begins.

The invariant `!(gameOverPlaying && menuPlaying)` is sampled across Easy, Hard, ended, rejected-play, watchdog, hard-timeout, gesture, restart, duplicate-failure, and 1,000 delayed-play race seeds.

## Mystery disks

`patterns.js` schedules a single mystery disk on deterministic seeded rounds after phase 6 in Hard and phase 9 in Easy. Its chance starts at 6%, rises one percentage point per phase, and caps at 18%; teleport rounds retain priority so the two special behaviors never collide in one lane. The disk keeps its final gameplay color and delivery side in the plan, renders as a green/pink vertical split, pauses and flickers at the halfway trigger, reveals the final single-color material, and then resumes toward its catcher. Delivery and spacing projections include the reveal pause.

## Persistence and direct-file scope

Storage reads and writes are guarded because browsers may restrict local storage for direct files or private contexts. Existing key names and legacy campaign-best fallback remain unchanged. Moving the game to another filesystem path can give the browser a different `file://` storage origin.

Production never exposes `window.__COSMIC_TEST__`. A separately named test build may expose the frozen test interface for direct-file browser automation.

## Desktop release profile

The Windows portable executable packages only `desktop/`, the verified production HTML, and its unchanged media assets. Electron runs with Node integration disabled, context isolation and sandboxing enabled, external navigation denied, and no developer tools.

Each application version uses its own profile directory. Before the profile's first window is loaded, Electron clears local storage, IndexedDB, service workers, and cache storage, then writes an initialization marker outside the packaged application. This makes every distributed version start with clean stats without erasing a player's progress on later launches of that version. `scripts/verify-desktop.mjs` launches the actual portable executable against an isolated profile and verifies an empty storage snapshot plus zero score and best-score UI.
