# BSCraft Launcher

The Windows launcher for the BSCraft modpack server. Tauri 2 (Rust backend,
React 19 + TypeScript frontend), a fixed 960×580 frameless window.

It installs Java, Minecraft 1.20.1, Forge and the modpack, keeps them up to
date, and starts the game straight into the BSCraft server. Players manage
their name, server password, skin, cape and elytra from the launcher.

The server side (skin service, nginx, game server notes) is documented in
[`server/README.md`](server/README.md); extra files added on top of the client
pack are in [`pack-overrides/`](pack-overrides/README.md).

## What players get

| Page | |
|---|---|
| **Play** | Pixel-art landscape (follows the time of day). The bottom bar shows how many players are on the BSCraft server; hovering it lists who's in game (in a Minecraft-style tooltip). Install, modpack and launcher updates with progress, then Play. The ▴ beside Play picks where the game starts: Minecraft's main menu (default) or straight into the BSCraft server. BSCraft is always in the in-game server list. Asks for a server password before the first launch. |
| **Profile** | Name (with a live free / yours / taken check), server password, a rotatable 3D preview (skinview3d), and a wardrobe: skin with classic/slim arms, cape, elytra design, "copy a look" from any BSCraft player or Minecraft account. Also Minecraft's Skin Customization switches and main hand, written into `options.txt`. |
| **Console** | Live game log with filters, search, copy, and Stop. |
| **Settings** | Memory, preferred GPU, where the game starts, console, background, performance mode, check for updates, verify and repair files. |

## How it fits together

- **Modpack:** `https://bscraft.zukashix.com/modpack/manifest.json` lists every
  file with its SHA-256. The launcher downloads what's missing or changed.
- **Accounts:** the server is offline-mode with the SimpleLogin mod. The launcher
  writes the password SimpleLogin reads (`<game>/.sl_password`), so players never
  see its prompt, and uses the same credential for skin uploads.
- **Skins:** the modpack's CustomSkinLoader loads everyone's skin and cape from
  `https://bscraft.zukashix.com/skins/`, where the skin service publishes what
  players upload from Profile. Minecraft paints the elytra from the cape texture,
  so an elytra design is stored in the cape's wing area.
- **Player count:** the launcher asks the game server for its status the way the
  multiplayer screen does (Server List Ping). Minecraft shares up to 12 names and
  hides players who turned off "Allow Server Listings"; the rest show as "+N more".
- **Launcher updates:** the Tauri updater reads
  `https://bscraft.zukashix.com/launcher/version.json`; the Play screen shows its
  `notes` and the Play button turns into Update.

All URLs derive from `SERVER_BASE_URL` in `src-tauri/src/constants.rs`.

## Development

Needs Node 18+, Rust (stable, MSVC) and, for the pack tool, Python 3.10+.

```powershell
npm install
npm run tauri dev
```

Frontend edits reload instantly; Rust edits rebuild and restart the window
(about 15 s). Note that a rebuild also closes a game the dev window started.

**UI without the backend:** `npm run preview:ui` serves the real frontend at
<http://localhost:5179/> against a mocked backend (`tools/ui-preview/mocks.js`).
Query parameters pick the situation:

| Parameter | |
|---|---|
| `s=installed\|fresh\|update\|offline\|launcherupdate` | Install state (default `installed`) |
| `acct=new\|registered\|mismatch`, `nopw=1` | Server account state; mock password is `hunter22` |
| `speed=2` | Run mock downloads faster |
| `srv=down\|empty\|busy` | Server status (default: 3 players online) |

`tools/ui-preview/scene.html?t=night&q=s%3Dfresh` opens the preview with a fixed
time of day.

**Try a modpack change before publishing it:** dev builds read the manifest
from `BSCRAFT_MANIFEST_URL` when it's set (release builds ignore it):

```powershell
$env:BSCRAFT_MANIFEST_URL = "http://127.0.0.1:8765/manifest.json"; npm run tauri dev
```

**Checks:**

```powershell
npx tsc --noEmit          # frontend types
npm run build             # tsc + production bundle
cd src-tauri; cargo test --lib  # Rust unit tests (options.txt, servers.dat, UUID, paths, hashing)
```

On a PC with Windows Smart App Control, freshly built test and build-script
executables can be blocked ("An Application Control policy has blocked this
file"); `npm run tauri dev` usually still works. The skin service has its own
suite, run on the server: `python3 server/skin-service/test_skin_service.py`.

## Project layout

```
src/                      React frontend
  App.tsx                 shell: nav rail, stage, pages, modals, toasts
  pages/                  Home (Play), Profile (+ profile/), Console, Settings
  components/             PixelScene + sceneLife (landscape, mobs), SkinViewer3D,
                          PlayerHead, PasswordForm, ui controls, icons
  hooks/                  useLauncher (install/update/launch flows), useOperation
                          (progress), useGameSession, useAccount, useSkin, useConfig
  lib/                    skin.ts (texture checks, cape wings), defaultSkin.ts, format.ts
src-tauri/src/
  commands/install.rs     Java, Minecraft, Forge
  commands/modpack.rs     manifest, sync, verify, repair, performance mode
  commands/launcher.rs    launch arguments, log streaming, exit tracking
  commands/account.rs     password file, skin service, Mojang import, options.txt
  commands/settings.rs    config.json, RAM and GPU detection
  commands/server.rs      live server status (player count and names)
  commands/update.rs      launcher self-update
  servers_dat.rs          keeps BSCraft in the game's server list (NBT)
tools/
  update-manifest.py      builds the modpack manifest (see below)
  ui-preview/             mock backend + Vite config for the browser preview
server/                   skin service, nginx config, server notes
pack-overrides/           files added to the client pack
```

## Player data on disk

Everything lives in `%APPDATA%\BSCraft\`:

| Path | |
|---|---|
| `config.json` | Launcher settings: username, RAM, GPU preference, auto-join, installed versions |
| `cached_manifest.json` | Last fetched manifest (performance mode works offline) |
| `installed_manifest.json` | Manifest of the last completed sync; tells an update what the pack itself installed |
| `performance_backup/` | Mods moved out by performance mode |
| `minecraft/` | The game directory: runtime (Java), versions, libraries, assets, mods, config, … |
| `minecraft/.sl_password` | The SimpleLogin password (plain text, as the mod stores it) |
| `minecraft/options.txt` | Minecraft settings; the pack's default is installed once, then it's the player's |
| `minecraft/servers.dat` | Server list; the launcher adds BSCraft when it's missing |

## Releasing a modpack update

1. Put the new client pack in a folder, then copy `pack-overrides/` over it and
   add `mods/CustomSkinLoader_Universal-15.0.1.jar` (from the live files).
2. Run the tool against it (settings can live in `tools/config.ini`, see
   `config.ini.example`):
   ```powershell
   python tools/update-manifest.py --modpack-dir <folder> --base-url https://bscraft.zukashix.com/modpack/files --mc-version 1.20.1 --forge-version 47.4.10 --out tools/manifest.json
   ```
   It lists added, changed and removed files, bumps the patch version, keeps the
   performance-mode flags, and puts `options.txt` in `initial_files`.
3. Upload the changed files to `/var/www/bscraft/modpack/files/`, check them over
   HTTPS, then replace `manifest.json` (keep the old one to roll back). Add the
   same jars to the game server unless they're client-only; see the mod
   differences table in `server/README.md`.

What an update does on a player's PC: files whose hash differs are downloaded
again; `mods/` is made to match the manifest exactly; elsewhere only files the
previous version of the pack installed and the new one dropped are removed, so
configs that mods write and resource or shader packs players add stay.

### Manifest format

```json
{
  "modpack_version": "1.0.5",
  "minecraft_version": "1.20.1",
  "forge_version": "47.4.10",
  "java_version": 17,
  "files": [
    { "path": "mods/jei.jar", "url": "https://…/files/mods/jei.jar", "sha256": "…", "size": 1234, "performance": true }
  ],
  "initial_files": [
    { "path": "options.txt", "url": "https://…/files/options.txt", "sha256": "…", "size": 11420 }
  ]
}
```

- `performance: true` marks a file that Performance Mode moves out.
- `initial_files` are installed only when the player doesn't have them, and never
  replaced afterwards. Launchers before 1.1.0 ignore the list.
- Don't list `servers.dat` or `usercache.json`.

## Releasing a launcher update

1. Set the same version in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json` (currently **1.1.0**).
2. Build and sign with the updater key (`bscraft-private.key`, never committed):
   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content bscraft-private.key -Raw
   npm run tauri build
   ```
   The installer and its `.sig` are in `src-tauri/target/release/bundle/nsis/`.
3. Upload the installer to `/var/www/bscraft/launcher/` and update
   `version.json`: `version`, `notes` (shown on the Play screen, keep it to two
   short lines), `pub_date`, and under `platforms.windows-x86_64` the `url` and
   the `.sig` file's contents as `signature`.

Launchers check on start; players press Update and the launcher installs the new
version and restarts.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Game crashes while loading, in `igxelpicd64.dll` | Intel graphics driver vs Twilight Forest's aurora shader. Pack v1.0.5 ships the fix (`config/openloader/resources/bscraft-fixes`); run Verify files if it's missing. |
| "Mismatched mod list" when joining | Client and server mods differ; compare the pack with the server (`server/README.md`). |
| Launcher says the password doesn't match | The server has a different password for that name. Enter the old one in Profile, or an admin runs `/simplelogin unregister <name in lowercase>`. |
| Profile says "not registered" right after joining | SimpleLogin saves new names every 5 minutes. |
| Skin shows in Profile but not in game | Players load skins when they join; rejoin. |
| `An Application Control policy has blocked this file` while building | Windows Smart App Control; see Development. |

Private: BSCraft internal use only.
