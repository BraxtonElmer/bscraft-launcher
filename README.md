# BSCraft Launcher

The Windows and macOS launcher for the BSCraft modpack server. Tauri 2 (Rust
backend, React 19 + TypeScript frontend), a fixed 960×580 window: frameless on
Windows, with the native traffic-light buttons over the nav rail on macOS.

It installs Java, Minecraft 1.20.1, Forge and the modpack, keeps them up to
date, and starts the game straight into the BSCraft server. Players manage
their name, server password, skin, cape and elytra from the launcher.

The server side (skin service, nginx, game server notes) is documented in
[`server/README.md`](server/README.md); extra files added on top of the client
pack are in [`pack-overrides/`](pack-overrides/README.md).

## What players get

| Page | |
|---|---|
| **Play** | Pixel-art landscape (follows the time of day). Everyone on the BSCraft server hangs out in it, drawn from their own skin with a name tag, doing things together by time of day: toasting marshmallows at the campfire, fishing at the pond, watching the sunset, stargazing, picnics, dancing round a jukebox, tag, chasing a chicken, picking flowers for each other, hugs and high-fives. Click someone and they wave; drag them to pick them up and throw them (ragdoll physics, splashes in the pond). Overdo it and they get a gravestone until an angel comes for them. Install, modpack and launcher updates with progress, then Play. The ▴ beside Play picks where the game starts: Minecraft's main menu (default) or straight into the BSCraft server. BSCraft is always in the in-game server list. Asks for a server password before the first launch. |
| **Profile** | Name (with a live free / yours / taken check), server password, a rotatable 3D preview (skinview3d), and a wardrobe: skin with classic/slim arms, cape, elytra design, "copy a look" from any BSCraft player or Minecraft account. Also Minecraft's Skin Customization switches and main hand, written into `options.txt`. |
| **Console** | Live game log with filters, search, copy, and Stop. |
| **Settings** | Memory, preferred GPU (Windows; macOS picks the GPU itself), where the game starts, console, background, performance mode, check for updates, verify and repair files, storage and uninstall. |

## How it fits together

- **Modpack:** `https://bscraft.zukashix.com/modpack/manifest.json` lists every
  file with its SHA-256. The launcher downloads what's missing or changed.
  The manifest's `java_version`, `minecraft_version` and `forge_version` are
  checked every time Play is pressed: anything not installed in exactly that
  version is installed first, whether or not `modpack_version` changed.
- **Accounts:** the server is offline-mode with the SimpleLogin mod. The launcher
  writes the password SimpleLogin reads (`<game>/.sl_password`), so players never
  see its prompt, and uses the same credential for skin uploads.
- **Skins:** the modpack's CustomSkinLoader loads everyone's skin and cape from
  `https://bscraft.zukashix.com/skins/`, where the skin service publishes what
  players upload from Profile. Minecraft paints the elytra from the cape texture,
  so an elytra design is stored in the cape's wing area.
- **Who's online:** the launcher asks the game server for its status the way the
  multiplayer screen does (Server List Ping), every 30 s while the Play screen is
  showing. Minecraft shares up to 12 names and hides players who turned off "Allow
  Server Listings"; those still appear, without a name tag. The landscape shows up
  to 8, each wearing the skin published for them (or the generated default).
- **Launcher updates:** the Tauri updater reads
  `https://bscraft.zukashix.com/launcher/version.json`; the Play screen shows its
  `notes` and the Play button turns into Update. Each platform (`windows-x86_64`,
  `darwin-aarch64`, `darwin-x86_64`) has its own entry; a launcher whose platform
  isn't listed counts itself up to date.
- **Windows vs macOS:** `src-tauri/src/platform.rs` holds what differs: Mojang's
  library and argument rules (natives, `-XstartOnFirstThread`), the classpath
  separator, and which Adoptium Java to download (Windows x64 `.zip`; macOS
  `aarch64`/`x64` `.tar.gz`, whose Java home is `jdk-…-jre/Contents/Home`).
  `src-tauri/tauri.macos.conf.json` overrides the window and bundle settings on
  macOS.

All URLs derive from `SERVER_BASE_URL` in `src-tauri/src/constants.rs`.

## Development

Needs Node 18+, Rust (stable; MSVC on Windows, Xcode or its Command Line Tools
on macOS) and, for the pack tool, Python 3.10+.

```powershell
npm install
npm run tauri dev
```

On macOS, install Rust with [rustup](https://rustup.rs) (`rustup target add
x86_64-apple-darwin aarch64-apple-darwin` for release builds, see below); the
same commands work in Terminal.

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
| `srv=down\|empty\|busy\|hidden` | Server status (default: 3 players online; `hidden` has 2 unnamed) |

`tools/ui-preview/scene.html?t=night&q=s%3Dfresh` opens the preview with a fixed
time of day. In dev builds `__party` in the console is the players' scene state;
`__party.timer = 0` shuffles everyone into new groups and activities. In the
preview, `__players = [...]` changes who's online, `__freezeStatus = true` stops
the mock server answering, and `?bubbles=1` keeps a speech bubble over everyone.

After changing the players' scene (`src/components/scene*.ts`), run the soak
test from the preview's console (with `?srv=busy`). It plays a copy of the scene
at full speed while clicking, throwing, killing, flinging the angel, throwing
the imp, and logging people on and off at random. It checks every frame that
nobody gets stuck, lost, invisible or NaN:

```js
await (await import('/tools/ui-preview/party-soak.js')).soak(600)
```

`broken` in the result should be empty.

**Try a modpack change before publishing it:** dev builds read the manifest
from `BSCRAFT_MANIFEST_URL` when it's set (release builds ignore it):

```powershell
$env:BSCRAFT_MANIFEST_URL = "http://127.0.0.1:8765/manifest.json"; npm run tauri dev
```

```bash
BSCRAFT_MANIFEST_URL=http://127.0.0.1:8765/manifest.json npm run tauri dev   # macOS
```

**Checks:**

```powershell
npx tsc --noEmit          # frontend types
npm run build             # tsc + production bundle
cd src-tauri; cargo test --lib  # Rust unit tests (options.txt, servers.dat, UUID, paths, hashing, OS rules)
```

On a PC with Windows Smart App Control, freshly built test and build-script
executables can be blocked ("An Application Control policy has blocked this
file"); `npm run tauri dev` usually still works. The skin service has its own
suite, run on the server: `python3 server/skin-service/test_skin_service.py`.

## Releasing the launcher

Players' launchers update themselves from `launcher/version.json` on the server,
and only accept an update signed with the updater key whose public half is in
`src-tauri/tauri.conf.json`. The private key (`bscraft-private.key`) and its
password (`bscraft-private.key.password.txt`) sit in the repo folder, gitignored.
Keep a private backup of both: without them no installed launcher can be updated.
Windows and macOS use the same key.

Release both platforms together, with the same version: `version.json` names one
version, and every platform in it must point at that version's file.

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json` and
   `src-tauri/Cargo.toml`.
2. Build Windows and macOS (below), upload the files, then write `version.json`.

### Windows

1. On Windows, `npm run tauri build`. The installer players need is
   `src-tauri/target/release/bundle/nsis/BSCraft Launcher_<version>_x64-setup.exe`.
2. Sign it (writes a `.sig` next to it):
   ```bash
   npx tauri signer sign --private-key-path bscraft-private.key \
     --password "$(cat bscraft-private.key.password.txt)" "<installer>"
   ```
3. Upload the installer to `/var/www/bscraft/launcher/` as
   `bsclauncher-<version>-setup.exe`, and as `bsclauncher-setup.exe` (the fixed
   link for new players).

The installer isn't code-signed, so Windows SmartScreen warns on first install
("More info → Run anyway"); updates installed by the launcher itself don't.

### macOS

On a Mac with Xcode (or `xcode-select --install`), Node and Rust, with the two
key files copied into the repo folder:

```bash
npm install
tools/build-macos.sh
```

It builds one universal app (Apple silicon and Intel), with Java, natives and
everything else picked at runtime for the Mac it runs on, and signs the update
archive with the updater key. The files end up in
`src-tauri/target/release-macos/<version>/`:

| File | |
|---|---|
| `bsclauncher-<version>-macos.dmg` | First installs: players open it and drag BSCraft Launcher to Applications |
| `bsclauncher-<version>-macos.app.tar.gz` | What installed launchers download to update themselves |
| `bsclauncher-<version>-macos.app.tar.gz.sig` | Its updater signature, for `version.json` |

Upload the `.dmg` and the `.app.tar.gz` to `/var/www/bscraft/launcher/`, and the
`.dmg` also as `bsclauncher-macos.dmg` (the fixed link for new players).

An archive built without the key (or with another one) can be signed afterwards;
that writes the `.sig` next to it:

```bash
npx tauri signer sign --private-key-path bscraft-private.key \
  --password "$(cat bscraft-private.key.password.txt)" bsclauncher-<version>-macos.app.tar.gz
```

**Apple signing.** Without an Apple Developer ID the app is only ad-hoc signed.
It works, but the first time a player opens it macOS says it can't check it for
malware: they click Done, open System Settings › Privacy & Security, and click
Open Anyway next to BSCraft Launcher (on macOS 14 and older, right-click the app
› Open also works). That's once; updates the launcher installs itself aren't
asked about. To skip that step for players, join the Apple Developer Program and
build with your Developer ID; the build is then signed with the hardened runtime,
notarized and stapled:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: <Name> (<TEAMID>)"
export APPLE_ID=<apple id email> APPLE_PASSWORD=<app-specific password> APPLE_TEAM_ID=<TEAMID>
tools/build-macos.sh
```

### version.json

After uploading, write `version.json` with the tool (it reads the `.sig` files and
checks the URLs are downloadable), and upload it to `/var/www/bscraft/launcher/`:

```bash
python3 tools/launcher-version.py --version <version> --notes "<two short lines>" \
  --windows https://bscraft.zukashix.com/launcher/bsclauncher-<version>-setup.exe "<installer>.sig" \
  --macos https://bscraft.zukashix.com/launcher/bsclauncher-<version>-macos.app.tar.gz \
    src-tauri/target/release-macos/<version>/bsclauncher-<version>-macos.app.tar.gz.sig \
  --out version.json
```

It writes `version`, `notes` (shown on the Play screen), `pub_date` and one entry
per platform: `windows-x86_64`, and `darwin-aarch64` plus `darwin-x86_64` (both the
universal archive). Launchers check on start; players press Update, and the
launcher installs the new version and restarts.

- **Never carry a platform's entry over from an older release.** Launchers only
  compare the version number, so they'd download the old file, install it, and be
  offered the same "update" again on the next start.
- **A platform you didn't build this time: leave it out.** Its launchers stay on
  their version and count themselves up to date (Windows launchers up to 1.1.4
  show "Launcher: server unreachable" under Check for updates instead, so don't
  leave Windows out).

### Auto-update on macOS: first-time setup

Nothing in the app needs changing: macOS launchers use the same key and the same
`version.json` as Windows. What it takes:

1. Publish a release that includes macOS (above), so `version.json` has the
   `darwin-aarch64` and `darwin-x86_64` entries and the `.dmg` is downloadable.
2. Players install from the `.dmg` once. From then on the launcher replaces
   itself in place when they press Update.
3. The launcher has to run from Applications (or any folder they can write to).
   macOS won't let an app replace itself while it runs from the disk image, or
   from the Downloads copy it never moved (App Translocation); the launcher tells
   the player to move it to Applications first. If changing Applications needs an
   administrator on that Mac, macOS asks for the password during the update.

**Trying an update before publishing.** Build the current version and the next one
so both check a local `version.json`, signing with the updater key as above:

```bash
npm run tauri build -- --target universal-apple-darwin --config \
  '{"bundle":{"createUpdaterArtifacts":true},"plugins":{"updater":{"endpoints":["http://127.0.0.1:8765/version.json"],"dangerousInsecureTransportProtocol":true}}}'
```

Put the newer `.app.tar.gz` in a folder with a `version.json` written by
`tools/launcher-version.py --no-check` (URL `http://127.0.0.1:8765/<archive>`), serve
it with `python3 -m http.server 8765`, copy the older `.app` to a writable folder,
open it and press Update: it downloads, replaces itself and reopens as the new
version. Stop the server afterwards, or test launchers keep offering the update.

## Project layout

```
src/                      React frontend
  App.tsx                 shell: nav rail, stage, pages, modals, toasts
  pages/                  Home (Play), Profile (+ profile/), Console, Settings
  components/             PixelScene + sceneLife (landscape, mobs), scenePlayers
                          (who's online: activities, drag and throw), playerRig
                          (skin to posed body), playerRagdoll, sceneProps (pond,
                          campfire, picnic, jukebox, grave, angel), SkinViewer3D,
                          PlayerHead, PasswordForm, ui controls, icons
  hooks/                  useLauncher (install/update/launch flows), useOperation
                          (progress), useGameSession, useAccount, useSkin, useConfig,
                          useOnlinePlayers
  lib/                    skin.ts (texture checks, cape wings), defaultSkin.ts, format.ts
src-tauri/src/
  commands/install.rs     Java, Minecraft, Forge
  commands/modpack.rs     manifest, sync, verify, repair, performance mode
  commands/launcher.rs    launch arguments, log streaming, exit tracking
  commands/account.rs     password file, skin service, Mojang import, options.txt
  commands/settings.rs    config.json, RAM and GPU detection (WMI / System Information)
  commands/storage.rs     disk usage, clearing caches, uninstall
  commands/server.rs      live server status (player count and names)
  commands/update.rs      launcher self-update
  platform.rs             what differs between Windows and macOS (Mojang rules, Java downloads)
  servers_dat.rs          keeps BSCraft in the game's server list (NBT)
src-tauri/tauri.macos.conf.json   macOS window (traffic lights) and bundle settings
src-tauri/windows/        NSIS installer hooks
tools/
  update-manifest.py      builds the modpack manifest (see below)
  build-macos.sh          macOS release build (universal, updater-signed)
  launcher-version.py     writes launcher/version.json for a release
  ui-preview/             mock backend + Vite config for the browser preview
server/                   skin service, nginx config, server notes
pack-overrides/           files added to the client pack
```

## Player data on disk

Everything lives in `%APPDATA%\BSCraft\` on Windows and
`~/Library/Application Support/BSCraft/` on macOS:

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

Settings › Storage shows how much of that is the game, Java, the modpack, the
player's own worlds and the caches, and can clear the caches (logs, crash
reports, downloaded skins, Distant Horizons' far-terrain cache). Uninstall there
removes all of it, optionally moving worlds, screenshots, schematics and map
waypoints to `Documents\BSCraft worlds`, then removes the launcher: on Windows it
opens the uninstaller, on macOS it moves BSCraft Launcher.app to the Trash (along
with the web view's data in `~/Library/WebKit` and `~/Library/Caches`) and quits.
Uninstalling from Windows' Apps list removes the game folder too when "Delete the
application data" is ticked (`windows/installer-hooks.nsh`), but never during an
update. On macOS, dragging the app to the Trash leaves the game folder; Settings ›
Storage › Uninstall is the way to remove everything.

## Memory

Settings › Memory is on Auto unless the player picks an amount. Auto gives the
game the most that helps and that the computer can spare (`settings::plan_for`):
at most 8 GB (10 GB on PCs with 24 GB or more, for Distant Horizons and busy
servers), keeping 7 GB for Windows, the apps people keep open and the game's
own memory outside the heap, plus 1.5 GB more on integrated graphics (Apple
silicon's GPU shares the Mac's memory, so it counts as integrated). That's
7 GB on a 16 GB laptop with Intel graphics, 8 GB on 16 GB with a graphics card,
10 GB on 32 GB, and 4 GB (with advice to use Performance mode) on 8–12 GB.
Other big packs say much the same: at least 6 GB, 8 on a 16 GB PC, 8–12 on
bigger ones, and never more than 10–12.

It comes from measuring pack 4.0.3 with Java's GC log (singleplayer, sprinting
through new terrain): the heap holds about 4 GB once in a world, peaking near
5.5 GB between clean-ups, and the game uses about 2 GB more outside it. More
heap doesn't make it faster: each clean-up has more to go through and Windows
starts swapping, which is why big allocations feel laggy. The launcher also
starts Java with G1 settings tuned for short pauses (`GC_FLAGS` in
`launcher.rs`), which halved the longest pauses in the same test (344 ms to
163 ms). The warnings: under 6 GB is too little, over 10 GB is more than the
pack can use, and over the PC's total minus ~5.5 GB starves Windows.

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
configs that mods write and resource or shader packs players add stay. If any file
can't be downloaded (a 404, a dropped connection), the launcher stops with an error
naming the files and doesn't start the game or record the new version, so the next
Play tries again; files are written to `<name>.part` first, so a failed download
never replaces a working copy.

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

## Troubleshooting

| Symptom | Cause |
|---|---|
| Game crashes while loading, in `igxelpicd64.dll` | Intel graphics driver vs Twilight Forest's aurora shader. Pack v1.0.5 ships the fix (`config/openloader/resources/bscraft-fixes`); run Verify files if it's missing. |
| "Mismatched mod list" when joining | Client and server mods differ; compare the pack with the server (`server/README.md`). |
| Launcher says the password doesn't match | The server has a different password for that name. Enter the old one in Profile, or an admin runs `/simplelogin unregister <name in lowercase>`. |
| Profile says "not registered" right after joining | SimpleLogin saves new names every 5 minutes. |
| Skin shows in Profile but not in game | Players load skins when they join; rejoin. |
| `An Application Control policy has blocked this file` while building | Windows Smart App Control; see Development. |
| Mac: "Apple could not verify BSCraft Launcher is free of malware" on first open | The build isn't signed with an Apple Developer ID. System Settings › Privacy & Security › Open Anyway (once), or release with a Developer ID; see Releasing › macOS. |
| Mac: Update says to move the launcher to Applications | It's running from the disk image or from where it was downloaded; macOS won't let it replace itself there. Drag it to Applications and open it from there. |
| Mac: a shader pack won't load or looks broken | macOS stops at OpenGL 4.1 (the log shows `GL version 4.1 Metal`); packs that need newer OpenGL features don't work on any Mac. |
| Mac: PowerGrid logs "Native backend failed to load … Unsupported platform!" | The mod only ships Windows and Linux natives, so on Macs it uses its slower built-in solver. Harmless. |

Private: BSCraft internal use only.
