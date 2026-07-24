# Cosmic Catchers

Cosmic Catchers is a direct-file Three.js arcade game. Its maintainable source lives in `src/`; the build assembles all HTML segments, CSS, application modules, and Three.js into one classic inline script that opens through `file://` without a server.

## Requirements

- Node.js 24
- npm

## Build and play

```powershell
npm ci
npm run build
```

Open the repository-root `## JOGUE AQUI.html` directly. A production build refreshes that canonical playable file and writes the identical packaged copy to `dist/`. Keep the HTML and its sibling SVG/MP3 files together. The `#` characters are intentional; scripts and browser tests use filesystem APIs and `pathToFileURL()` so they are encoded safely.

`npm run package:release` creates `dist/Cosmic-Catchers-direct-file.zip`. The ZIP root contains the playable HTML, exact media assets, SVG, and checksums.

## Controls

- Keyboard: A/Left and D/Right flip Easy lanes; A/Left, S/Down, and D/Right flip Hard lanes; P pauses; Space/Enter starts or restarts.
- Mouse: click a lane to flip its catcher.
- Touch/pen: tap the visible catcher itself. Its projected hit target is at least 44×44 CSS pixels.
- Tablet/mobile: a 44×44 pause/resume button appears at the top-left at widths up to 1100px.
- Mystery disks: from phase 6 in Hard and phase 9 in Easy, a green/pink split disk can flicker and reveal its final color halfway to the catcher; its frequency rises gently with later phases.

## Verification

```powershell
npm run verify
npm run test:e2e
npm run audit
```

`verify` checks original asset hashes, code-quality limits, unit/property/integration behavior, coverage thresholds, the production build, direct-file artifact contracts, size budget, and release ZIP. Browser tests run the actual test-instrumented `file://` artifact in Chrome, Edge, and Firefox.

See [architecture](docs/architecture.md) and the [test matrix](docs/test-matrix.md).
