# BSCraft Launcher: UI revamp handoff

Status as of 2026-09-12. Read this before continuing the UI work in a new session.

## TL;DR

- The React frontend (`src/`) was **fully rewritten** into a new design. The Rust backend (`src-tauri/`) is **unchanged**, and every `invoke` command and event name is the same.
- It works in a browser preview harness with a mocked backend. It has **never been type-checked or built**: this machine has no Node, Python or Rust.
- **Original UI backup:** `ui-backup-original.zip` in the project root, containing the old `src/` and `index.html`. There is no git repo, so this zip is the only way back.
- **Next step:** run `npm install` and `npm run build` (runs `tsc && vite build`), then `npm run tauri dev`, and fix whatever comes up.

## Design direction

- Brand colours are violet/pink, taken from the real logo `bsc.ico` (a pixel "BSC" on a purple/pink background). `src-tauri/icons/*` are still the default Tauri icons.
- The layout is a fixed 960×580 frameless window. A 76px **nav rail** on the left has Play / Console / Settings. The **stage** to its right holds a transparent draggable title bar.
- **Signature element:** `PixelScene`, a procedurally generated pixel-art landscape rendered on a canvas at ¼ resolution and scaled up with `image-rendering: pixelated`.
  - Layers: dithered sky, stars / shooting stars, square sun or moon, flat blocky clouds, far mountains, hills with tree sprites, a grass-block ground, fireflies. The mouse adds a little parallax.
  - It follows the local time of day (dawn/day/dusk/night), and the user can override that under Settings → Launcher → Background. The choice is stored in `localStorage` (`bscraft.scenery`), not the Rust config.
  - The animation **pauses** while the game runs or when you're off the Play page, where it's blurred and dimmed behind the other pages. It also respects `prefers-reduced-motion`.
- **Fonts:**
  - Manrope (UI) and JetBrains Mono (logs) come from Google Fonts via `index.html`. Offline users fall back to Segoe UI / Consolas.
  - The BSCRAFT wordmark and the PLAY button label use `PixelText`, a built-in 5×7 bitmap font rendered as SVG, so they work offline.

## File map (`src/`)

| File | Purpose |
|---|---|
| `App.tsx` | Shell: rail, stage, scene, pages, modals, toasts, close-guard listener, crash toast |
| `hooks/useConfig.ts` | Config state. `persist(partial)` re-reads the on-disk config and merges; saves are serialized (the backend writes the `installed_*` fields) |
| `hooks/useOperation.ts` | The single active long-running task and its progress. Subscribes to `download-progress`, `install-progress`, `sync-progress`, `verify-progress` and `launcher-update-progress`. Events only update an operation that has been `begin()`-ed |
| `hooks/useGameSession.ts` | Game running state, `startedAt`, batched and parsed log lines (max 5000), exit code, `exitSeq`, `kill`. Lives at the root so logs stream on every page |
| `hooks/useLauncher.ts` | All flows: startup, install → launch, launch, launcher update, performance mode, modpack update, check updates, verify, repair. Ported from the old `Main.tsx` / `Settings.tsx` with the same invoke sequences |
| `pages/Home.tsx` | Hero (status pill, wordmark, version chips, update/offline callouts). The dock switches between controls, install progress and in-game. Also holds the Play button |
| `pages/Settings.tsx` | Memory (slider, presets, advice), Graphics (dGPU toggle + detected GPU list), Launcher (console-on-launch, background), Maintenance (inline progress/results, repair), About |
| `pages/Console.tsx` | Parsed Forge log lines, search, All/Warnings/Errors filter with counts, copy, clear, stop game (click twice to confirm), jump to latest |
| `components/PixelScene.tsx` | The landscape (see above). Also exports `useSceneTime` and `resolveScenery` |
| `components/PixelText.tsx` | Bitmap-font SVG text (A–Z, 0–9, `% . - ! ?`, space) |
| `components/PlayerHead.tsx` | 8×8 pixel head generated from a hash of the username |
| `components/NavRail.tsx`, `TitleBar.tsx`, `ActivityCard.tsx`, `Toasts.tsx`, `ErrorModal.tsx`, `CloseWarningModal.tsx`, `Icons.tsx`, `ui.tsx` | Chrome and primitives. `ui.tsx` has Toggle, Segmented, ProgressBar (supports step segments), Spinner, `describeOperation` |
| `lib/format.ts` | Bytes/RAM formatting, `stageTitle`, username sanitising/validation, FNV hash, Forge log parser |
| `lib/clipboard.ts` | `copyText` with an execCommand fallback |
| `styles/globals.css` | The whole design system: tokens at the top, sections per component |
| `types/index.ts` | Rust-mirrored types plus new UI types (`Page`, `LaunchStatus`, `OperationKind`, `ActiveOperation`, `TaskResult`, `LogEntry`, `Toast`…) |

Deleted (they're in the zip): `pages/Main.tsx`, `components/Sidebar.tsx`, `components/ProgressOverlay.tsx`, `App.css`, `assets/react.svg`.

## Behaviour changes vs the old UI (frontend only)

- Pages stay usable during tasks. Progress shows in the Play dock, inline in Settings, or as a floating card on Console, instead of a blocking full-screen overlay.
- A **modpack update banner** appears on Play when `installed_modpack_version` ≠ manifest version. Its **Update** button runs the same flow as Settings → Check for updates.
- Install shows **Step N of 4** (Java → Minecraft → Forge → Modpack) with a segmented progress bar.
- The username is sanitised to `[A-Za-z0-9_]`, 3–16 characters, and validated *before* installing. An invalid name shakes and focuses the field instead of opening a modal.
- `console_enabled` now means "Open console on launch". The Console tab is always available.
- A non-zero exit code shows an error toast with "View log", unless the user stopped the game.
- The launcher-update check now also runs on startup when the game isn't installed yet.
- Check for updates no longer auto-installs the modpack when the base game isn't installed. It tells the user to press Install instead.
- After Verify finds missing Java/Minecraft/Forge, the install status is re-read, so Play turns back into Install.
- Launcher-update download progress (`launcher-update-progress`) is now displayed. The old UI ignored it.
- Maintenance buttons are disabled while the game runs or another task is active, with the reason shown.

## Verification status

- **Done (browser harness):**
  - All Home states: ready, update available, fresh install, offline, launching, in-game.
  - The full install → launch flow, and the in-game dock with timer, Console and Stop.
  - Username nudge and sanitising.
  - Settings layout, verify with the failed-file list and Repair.
  - All four scenery palettes.
  - No React runtime errors. The 404s in the console are just the harness probing `.tsx` vs `.ts` extensions.
- **Not done:**
  - `tsc` type-check and a real Vite/Tauri build. Imports and unused variables were reviewed by hand; strict mode with `noUnusedLocals` / `noUnusedParameters` is on.
  - Visual check of the ErrorModal, the CloseWarningModal and the toasts.
  - The Console page with live logs, and the launcher-update flow.
  - Progress bar animation. The harness pane freezes CSS transitions between screenshots (0 rAF frames), so bars looked stuck. That's an artifact of the pane, not a known bug.
  - Real-window checks: that `data-tauri-drag-region` works on the title bar and rail logo, and that minimize/close work.

## Preview harness (no Node needed)

A copy lives in `tools/ui-preview/`. It's dev-only and safe to delete.

- `server.ps1` is a PowerShell HttpListener on `http://localhost:5178/`. It serves the harness and maps `/src/*` to the project's `src/`.
- `index.html` uses Babel-standalone (cdnjs) to compile the real `src/*.tsx` in the browser as CommonJS. React 19 comes from esm.sh.
- `mocks.js` is a fake Tauri backend: every invoke command, simulated progress events, fake Forge logs, and `window.__mock.exitGame(code)`.
- URL params:
  - `?s=installed|update|fresh|offline|launcherupdate` picks the scenario.
  - `&speed=N` makes the mock faster or slower.
- Run it in the background with `& "tools\ui-preview\server.ps1"`, then open `http://localhost:5178/?s=update` in the Browser pane at 960×580.

## Ideas / possible next steps

- Bundle the fonts locally (e.g. `@fontsource/manrope`) so the UI looks the same offline.
- Replace the default Tauri icons in `src-tauri/icons/` with the BSCraft logo.
- Add a "skip for now" option for launcher updates. They're currently a hard block, as in the original.
- Consider auto-updating the modpack from the Play button when it's outdated. Right now that's an explicit Update click.
- Optional: an "Open game folder" button. It needs a Rust command, or the opener plugin scope plus an mc-dir command.
