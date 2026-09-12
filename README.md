# BSCraft Launcher

A custom Minecraft modpack launcher built with **Tauri 2 (Rust + React)**. Self-updating, manifest-driven, and offline-first — designed exclusively for the BSCraft modpack.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Project Structure](#3-project-structure)
4. [Configuration Before Building](#4-configuration-before-building)
5. [Building the Launcher](#5-building-the-launcher)
6. [Server Setup](#6-server-setup)
7. [Required Server Files & Formats](#7-required-server-files--formats)
8. [Admin Tooling — Generating the Manifest](#8-admin-tooling--generating-the-manifest)
9. [Releasing a Launcher Update](#9-releasing-a-launcher-update)
10. [Releasing a Modpack Update](#10-releasing-a-modpack-update)
11. [Development Workflow](#11-development-workflow)
12. [How the Launcher Works at Runtime](#12-how-the-launcher-works-at-runtime)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        BSCraft Launcher                          │
│                    (Tauri 2 — Rust + React)                      │
│                                                                  │
│  React Frontend                  Rust Backend                    │
│  ─────────────                  ─────────────                    │
│  Main page (play/install)   ←→  settings.rs  (config r/w)       │
│  Settings page              ←→  update.rs    (self-update)       │
│  Console page               ←→  install.rs   (JRE/MC/Forge)     │
│  Progress overlay           ←→  modpack.rs   (file sync)        │
│                             ←→  launcher.rs  (process mgmt)     │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS
              ┌────────────────▼────────────────┐
              │           Your Server            │
              │                                  │
              │  /bscraft/                        │
              │    launcher/                      │
              │      version.json   ← updater     │
              │      BSCraft-Launcher_x.x.x.exe   │
              │      BSCraft-Launcher_x.x.x.exe.sig│
              │    modpack/                       │
              │      manifest.json  ← modpack     │
              │      files/         ← mod files   │
              │        mods/jei-1.20.1.jar        │
              │        config/...                 │
              └──────────────────────────────────┘
                               │
              ┌────────────────▼────────────────┐
              │   Mojang / Forge Maven / Adoptium │
              │   (Minecraft, Forge, Java 17 JRE) │
              └──────────────────────────────────┘
```

The launcher also downloads **Minecraft vanilla**, **Forge**, and **Java 17 JRE** directly from their official sources (Mojang, Forge Maven, Adoptium). Only your modpack files (mods, configs, etc.) are served from your own server.

---

## 2. Prerequisites

### Developer machine

| Tool | Version | Notes |
|---|---|---|
| Rust | 1.77+ | Install via [rustup.rs](https://rustup.rs) |
| Node.js | 18+ | LTS recommended |
| npm | 9+ | Comes with Node |
| Tauri CLI | 2.x | Installed via `npm` (already in `package.json`) |
| Python | 3.10+ | Only for the admin manifest tool |

Install Rust targets and check everything is ready:

```powershell
# Verify Rust
rustc --version
cargo --version

# Verify Node
node --version
npm --version

# Install frontend deps (first time only)
npm install
```

---

## 3. Project Structure

```
bscraft-launcher/
├── src/                          # React frontend
│   ├── styles/
│   │   └── globals.css           # Full design system
│   ├── types/
│   │   └── index.ts              # TypeScript interfaces (mirrors Rust types)
│   ├── components/
│   │   ├── TitleBar.tsx          # Custom frameless title bar
│   │   ├── Sidebar.tsx           # Navigation sidebar
│   │   └── ProgressOverlay.tsx   # Download/install progress UI
│   ├── pages/
│   │   ├── Main.tsx              # Home page — play button, startup sequence
│   │   ├── Settings.tsx          # RAM, verify, repair, update actions
│   │   └── Console.tsx           # Minecraft log viewer
│   ├── App.tsx                   # Root component, routing
│   └── main.tsx                  # Entry point
│
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── lib.rs                # Plugin + command registration
│   │   ├── constants.rs          # ← SERVER_BASE_URL lives here
│   │   ├── state.rs              # Shared app state (game process, logs)
│   │   └── commands/
│   │       ├── mod.rs
│   │       ├── settings.rs       # Config read/write, RAM detection
│   │       ├── update.rs         # Launcher self-update
│   │       ├── install.rs        # JRE + Minecraft + Forge install
│   │       ├── modpack.rs        # Manifest fetch, file sync, verify, repair
│   │       └── launcher.rs       # Minecraft process launch & log streaming
│   ├── Cargo.toml                # Rust dependencies
│   ├── tauri.conf.json           # Tauri app config (window, plugins, updater)
│   └── capabilities/
│       └── default.json          # Tauri capability permissions
│
└── tools/
    ├── update-manifest.py        # Admin script — generates manifest.json
    └── config.ini.example        # Template for the admin script config
```

---

## 4. Configuration Before Building

Before your first build, you **must** change two files:

### 4.1 Set the Server Base URL

Open `src-tauri/src/constants.rs` and change:

```rust
pub const SERVER_BASE_URL: &str = "https://your-server.com/bscraft";
```

Replace with your actual server URL. All other URLs (manifest, files, updater) are derived from this single constant. This is the **only place** you need to change it.

### 4.2 Generate Signing Keys (Required for Self-Update)

Tauri's updater requires the binary to be cryptographically signed. Run:

```powershell
npx tauri signer generate -w bscraft-private.key
```

This outputs two things:
- A **private key** (kept secret, used at build time)
- A **public key** (pasted into `tauri.conf.json`, shipped with the app)

> ⚠️ **Store `bscraft-private.key` somewhere safe.** Never commit it to git. Losing it means you can't ship future updates.

Copy the public key output and paste it into `src-tauri/tauri.conf.json`:

```json
"plugins": {
  "updater": {
    "endpoints": [
      "https://your-server.com/bscraft/launcher/version.json"
    ],
    "dialog": false,
    "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6..."
  }
}
```

Also update the endpoint URL to match your actual server.

---

## 5. Building the Launcher

### 5.1 Development Build (Hot Reload)

```powershell
npm run tauri dev
```

This starts Vite + Tauri in dev mode. Note: the self-updater is disabled in dev mode (it only works in production builds).

### 5.2 Production Build

Set the signing private key as an environment variable, then build:

```powershell
# PowerShell
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content bscraft-private.key -Raw)
npm run tauri build
```

Or if you saved the key as a plain string:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "your-private-key-string-here"
npm run tauri build
```

Build output is in:

```
src-tauri/target/release/bundle/
├── nsis/
│   └── BSCraft Launcher_0.1.0_x64-setup.exe    ← installer
├── msi/
│   └── BSCraft Launcher_0.1.0_x64_en-US.msi    ← MSI installer
└── (each will also have a .sig signature file alongside)
```

> The `.sig` file is generated automatically by Tauri during build using your private key.

### 5.3 Bumping the App Version

Edit the `version` field in **both** of these files (they must match):

- `src-tauri/tauri.conf.json` → `"version": "0.2.0"`
- `src-tauri/Cargo.toml` → `version = "0.2.0"`

---

## 6. Server Setup

Your web server needs to serve static files over HTTPS. Any standard setup works (Nginx, Apache, Caddy, S3+CloudFront, etc.).

### 6.1 Recommended Directory Layout

```
/var/www/bscraft/           (or wherever your web root is)
└── launcher/
│   ├── version.json              ← Tauri updater endpoint
│   └── BSCraft-Launcher_0.2.0_x64-setup.exe
│   └── BSCraft-Launcher_0.2.0_x64-setup.exe.sig
└── modpack/
    ├── manifest.json             ← Modpack manifest
    └── files/
        ├── mods/
        │   ├── jei-1.20.1-forge-15.3.0.4.jar
        │   └── ...
        ├── config/
        │   └── ...
        ├── resourcepacks/
        │   └── ...
        └── shaderpacks/
            └── ...
```

### 6.2 Nginx Example Config

```nginx
server {
    listen 443 ssl;
    server_name your-server.com;

    ssl_certificate     /etc/letsencrypt/live/your-server.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-server.com/privkey.pem;

    root /var/www/bscraft;
    index index.html;

    location /bscraft/ {
        add_header Access-Control-Allow-Origin *;
        try_files $uri $uri/ =404;
    }

    # Serve large files efficiently
    location /bscraft/modpack/files/ {
        add_header Access-Control-Allow-Origin *;
        sendfile on;
        tcp_nopush on;
    }
}
```

> The `Access-Control-Allow-Origin *` header is required because the Tauri app makes cross-origin requests to your server.

### 6.3 CORS

Every file your server serves to the launcher **must** include the header:

```
Access-Control-Allow-Origin: *
```

Without this, downloads will silently fail inside the Tauri WebView.

---

## 7. Required Server Files & Formats

### 7.1 Modpack Manifest — `manifest.json`

Served at: `https://your-server.com/bscraft/modpack/manifest.json`

```json
{
  "modpack_version": "1.0.0",
  "minecraft_version": "1.20.1",
  "forge_version": "47.3.0",
  "java_version": 17,
  "files": [
    {
      "path": "mods/jei-1.20.1-forge-15.3.0.4.jar",
      "url": "https://your-server.com/bscraft/modpack/files/mods/jei-1.20.1-forge-15.3.0.4.jar",
      "sha256": "a3f1c2d4e5b6...",
      "size": 1048576
    },
    {
      "path": "config/jei/jei.toml",
      "url": "https://your-server.com/bscraft/modpack/files/config/jei/jei.toml",
      "sha256": "b7e8f9a0c1d2...",
      "size": 512
    }
  ]
}
```

#### Field Reference

| Field | Type | Description |
|---|---|---|
| `modpack_version` | `string` | Semver string. Launcher compares this to locally installed version to detect modpack updates. |
| `minecraft_version` | `string` | Exact Minecraft release string (e.g. `"1.20.1"`). Must exist in Mojang's version manifest. |
| `forge_version` | `string` | Forge build number only (e.g. `"47.3.0"`), **not** the full `"1.20.1-47.3.0"` string. |
| `java_version` | `number` | Required Java major version. Use `17` for MC 1.17+. |
| `files[]` | `array` | List of all modpack files to be present on the client. |
| `files[].path` | `string` | Path relative to the Minecraft profile directory, forward slashes. |
| `files[].url` | `string` | Full HTTPS URL where this file can be downloaded. |
| `files[].sha256` | `string` | Lowercase hex SHA-256 digest. Used for integrity checks and change detection. |
| `files[].size` | `number` | File size in bytes. Used to show accurate progress bars. |

#### Which files to include

Include everything that should be on every player's machine:

- `mods/*.jar` — all mod JARs
- `config/**` — all config files
- `resourcepacks/*.zip` — bundled resource packs (if any)
- `shaderpacks/*.zip` — bundled shaders (if any)
- `scripts/**` — CraftTweaker / KubeJS scripts
- `defaultconfigs/**` — world-generation presets

**Do not include:**
- `logs/`, `crash-reports/` — client-only
- `saves/` — player worlds
- `options.txt` — client preferences
- `servers.dat` — player server list

---

### 7.2 Launcher Updater Endpoint — `version.json`

Served at: `https://your-server.com/bscraft/launcher/version.json`

This is the Tauri updater format. The launcher checks this on every startup and will hard-block the user from playing until the launcher is up to date.

```json
{
  "version": "0.2.0",
  "notes": "Fixed Forge installation on fresh installs. Improved download speeds.",
  "pub_date": "2026-05-23T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6...",
      "url": "https://your-server.com/bscraft/launcher/BSCraft-Launcher_0.2.0_x64-setup.exe"
    }
  }
}
```

#### Field Reference

| Field | Type | Description |
|---|---|---|
| `version` | `string` | New launcher version. Must be higher than what is currently installed (semver comparison). |
| `notes` | `string` | Changelog shown to the user before updating. Markdown is supported. |
| `pub_date` | `string` | ISO 8601 timestamp of the release. |
| `platforms` | `object` | One key per platform. For Windows-only, only `windows-x86_64` is needed. |
| `platforms.*.signature` | `string` | Contents of the `.sig` file produced by `tauri build`. **Must match the binary exactly.** |
| `platforms.*.url` | `string` | HTTPS URL to the installer `.exe` or `.msi`. |

> **How to get the signature:** After running `npm run tauri build`, find the `.sig` file next to the installer in `src-tauri/target/release/bundle/nsis/`. Open it and paste the contents into `signature`.

---

## 8. Admin Tooling — Generating the Manifest

The `tools/update-manifest.py` script automates manifest generation. It:
- Recursively scans your modpack folder
- Computes SHA-256 for every file
- Diffs against the existing manifest to find what changed
- Auto-bumps the `modpack_version` patch number
- Writes the new `manifest.json`
- Optionally uploads changed files + manifest via `rsync`

### 8.1 First-Time Setup

```bash
cd tools
cp config.ini.example config.ini
```

Edit `config.ini`:

```ini
[server]
host        = your-server.com
user        = deploy
remote_path = /var/www/bscraft/modpack

# Public-facing download URL for modpack files
base_url    = https://your-server.com/bscraft/modpack/files

[modpack]
# Path to your local modpack folder (the profile directory)
local_path    = C:/path/to/your/modpack-folder
mc_version    = 1.20.1
forge_version = 47.3.0
java_version  = 17
```

### 8.2 First Run (No Existing Manifest)

```bash
python tools/update-manifest.py
```

This creates `manifest.json` in your current working directory, reporting all files as new.

### 8.3 Subsequent Updates

After adding/removing/modifying mods or configs:

```bash
# Preview changes only
python tools/update-manifest.py

# Generate new manifest and upload only changed files to server
python tools/update-manifest.py --upload

# Force a minor version bump instead of auto patch bump
python tools/update-manifest.py --bump-version minor --upload

# Non-interactive (for CI)
python tools/update-manifest.py --upload --yes
```

**Output example:**
```
BSCraft Manifest Generator
========================================
Existing manifest: v1.0.2 (47 files)

Changes detected:
  [+] mods/newmod-1.0.jar                (NEW)
  [~] config/somemod/config.toml         (CHANGED)
  [-] mods/removedmod-0.9.jar            (REMOVED)
  … 44 other files unchanged

Modpack version: 1.0.2 → 1.0.3  (auto patch bump)

Write manifest.json? (y/n): y
✓  Written: manifest.json  (48 files)

Uploading to deploy@your-server.com:/var/www/bscraft/modpack…
  ✓  mods/newmod-1.0.jar
  ✓  config/somemod/config.toml
  ✓  manifest.json

Upload complete: 2/2 files
```

### 8.4 Uploading manifest.json Manually

If you don't use rsync (e.g. S3, FTP), just upload `manifest.json` and any new/changed files to your server yourself. The script always outputs the manifest locally.

---

## 9. Releasing a Launcher Update

Follow these steps whenever you change the Rust or React code:

### Step 1 — Bump the version

In `src-tauri/tauri.conf.json`:
```json
"version": "0.2.0"
```

In `src-tauri/Cargo.toml`:
```toml
version = "0.2.0"
```

### Step 2 — Build the installer

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content bscraft-private.key -Raw)
npm run tauri build
```

Outputs (example):
```
src-tauri/target/release/bundle/nsis/
  BSCraft Launcher_0.2.0_x64-setup.exe
  BSCraft Launcher_0.2.0_x64-setup.exe.sig    ← signature
```

### Step 3 — Upload the installer

Upload the `.exe` to your server:
```
https://your-server.com/bscraft/launcher/BSCraft-Launcher_0.2.0_x64-setup.exe
```

### Step 4 — Update `version.json`

Get the signature string (copy contents of `.sig` file):

```powershell
Get-Content "src-tauri/target/release/bundle/nsis/BSCraft Launcher_0.2.0_x64-setup.exe.sig"
```

Update your server's `version.json`:

```json
{
  "version": "0.2.0",
  "notes": "What changed in this version",
  "pub_date": "2026-05-23T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<paste .sig file contents here>",
      "url": "https://your-server.com/bscraft/launcher/BSCraft-Launcher_0.2.0_x64-setup.exe"
    }
  }
}
```

Upload `version.json` to your server. The launcher will detect the update on the next startup and force-install it before allowing the user to play.

---

## 10. Releasing a Modpack Update

### Step 1 — Make your changes

Add/remove/update files in your local modpack folder.

### Step 2 — Generate and upload the new manifest

```bash
python tools/update-manifest.py --upload --yes
```

This will:
1. Detect what changed
2. Auto-bump the patch version
3. Upload only the changed files (not the entire modpack)
4. Upload the new `manifest.json`

### Step 3 — Verify

Players will get the update automatically on their next launch. The launcher:
1. Fetches `manifest.json`
2. Compares SHA-256 of every file against local copies
3. Downloads only files that are missing or changed
4. Does **not** re-download unchanged files

---

## 11. Development Workflow

### Running in Dev Mode

```powershell
npm run tauri dev
```

The Vite dev server starts on `localhost:1420` and Tauri opens the window. Hot reload works for React changes. Rust changes require a recompile (Tauri handles this automatically but it takes ~10-30s).

### Checking for Compile Errors

```powershell
# TypeScript check (fast)
npx tsc --noEmit

# Rust check (medium — first run downloads crates)
cd src-tauri
cargo check
```

### Updating SERVER_BASE_URL for Testing

While developing, you can point `SERVER_BASE_URL` in `constants.rs` to a local HTTP server:

```rust
pub const SERVER_BASE_URL: &str = "http://localhost:8080/bscraft";
```

Run a local server from your server files directory:
```powershell
python -m http.server 8080
```

### Logs Location

When running in dev mode, logs print to the terminal. In production, Tauri app logs go to:

```
%APPDATA%\com.zukashix.bsclauncher\logs\
```

Minecraft logs are streamed live into the Console page inside the launcher.

---

## 12. How the Launcher Works at Runtime

### Startup Sequence (every launch)

```
1. App opens
   │
   ├─ Check launcher version.json
   │   └─ If newer version → hard block, force update + restart
   │
   ├─ Fetch modpack manifest.json
   │   └─ If unreachable → continue with offline mode (if already installed)
   │
   ├─ Check install status
   │   └─ If JRE / Minecraft / Forge missing → show Install button
   │
   └─ Sync modpack files
       ├─ For each file in manifest:
       │   ├─ File exists locally?  No  → download
       │   └─ SHA-256 matches?      No  → re-download (changed)
       └─ Done → show Play button
```

### First Install Sequence (new user)

```
1. Install Java 17 JRE    → downloaded from Adoptium, extracted to %APPDATA%\BSCraftLauncher\minecraft\runtime\
2. Install Minecraft       → vanilla client JAR + libraries + assets from Mojang CDN
3. Install Forge           → official Forge installer JAR downloaded from Forge Maven, run in headless mode
4. Sync modpack files      → mods, configs, etc. from your server
5. Ready to play
```

### Data Directories

All game data lives under `%APPDATA%\BSCraftLauncher\`:

```
%APPDATA%\BSCraftLauncher\
├── config.json            ← Launcher settings (username, RAM, etc.)
└── minecraft/             ← Minecraft profile root
    ├── versions/          ← Minecraft version JSONs and JARs
    ├── libraries/         ← Minecraft + Forge libraries
    ├── assets/            ← Game assets (sounds, textures)
    ├── natives/           ← Native DLLs (LWJGL etc.)
    ├── runtime/           ← Bundled Java 17 JRE
    ├── mods/              ← Modpack mods
    ├── config/            ← Mod configs
    ├── resourcepacks/     ← Bundled resource packs
    └── shaderpacks/       ← Bundled shader packs
```

### `config.json` Format

```json
{
  "username": "PlayerName",
  "ram_mb": 4096,
  "console_enabled": false,
  "installed_modpack_version": "1.0.3",
  "installed_mc_version": "1.20.1",
  "installed_forge_version": "47.3.0"
}
```

---

## 13. Troubleshooting

### Build fails: `TAURI_SIGNING_PRIVATE_KEY not set`

You must set the environment variable before building. See [Section 5.2](#52-production-build).

### Updater shows "Update check failed"

- Check that `version.json` is accessible at the URL in `tauri.conf.json`
- Check that CORS headers are set (`Access-Control-Allow-Origin: *`)
- The launcher does **not** block play if the update server is unreachable — it only blocks if an update is found but fails to install

### Downloads fail silently / manifest sync does nothing

- CORS headers are missing from your server responses
- The `url` field in `manifest.json` uses HTTP instead of HTTPS
- Firewall is blocking outbound connections from the app

### Forge installation fails

- Java 17 JRE must be installed first (click Install, not just Play)
- Check that the Forge version string in the manifest exactly matches a version on Forge Maven: `https://maven.minecraftforge.net/net/minecraftforge/forge/`
- The Forge installer is run headlessly — check the launcher console for the installer's own error output

### Minecraft won't launch / crashes immediately

- Open Settings → Console View, then launch again to see the full log
- Check that `installed_mc_version` and `installed_forge_version` in `config.json` match what is actually in the `versions/` directory
- Use Settings → Verify Minecraft Installation to detect missing files

### "Username cannot be empty"

The username field must be filled before pressing Play. Usernames are stored in `config.json` between sessions.

---

## License

Private — BSCraft internal use only.
