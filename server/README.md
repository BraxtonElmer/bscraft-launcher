# Server side

Everything BSCraft runs on the server at `bscraft.zukashix.com`
(Ubuntu 24.04, nginx).

| Path on the server | What |
|---|---|
| `/var/www/bscraft/modpack/` | Launcher modpack: `manifest.json` + `files/` |
| `/var/www/bscraft/launcher/version.json` | Launcher self-update feed |
| `/var/www/bscraft/skins/` | Published skins (written by the skin service) |
| `/home/ubuntu/bscraft-skins/` | Skin service code + its private `data/index.json` |
| `/home/ubuntu/game_hosting/BSCraft4/` | Forge game server (screen session `bscraft`) |
| `/etc/nginx/sites-available/bscraftfs` | Site config, tracked here as `nginx/bscraftfs.conf` |

## Skin service (`skin-service/`)

A small Python service (standard library + `python3-bcrypt`) that lets
players set their skin, cape and elytra from the launcher. Accounts are the
SimpleLogin registrations in `BSCraft4/world/sl_entries.dat` (read-only), so
an upload needs the same password the player joins with. Textures are
published in CustomSkinLoader's CustomSkinAPI format
(`<Name>.json` with `skins`, `cape` and `elytra` pointing into `textures/`),
which the modpack's CustomSkinLoader loads from
`https://bscraft.zukashix.com/skins/`.

| Route | |
|---|---|
| `GET /api/health` | |
| `GET /api/profile?name=<name>` | Public, case-insensitive: what a player has published (the launcher's "copy a look") |
| `POST /api/account/verify` | `{username, passwordHash}` → `{registered, valid}` |
| `POST /api/skin?model=default\|slim` | PNG body, 64×64 or 64×32, max 32 KB |
| `POST /api/cape`, `POST /api/elytra` | PNG body, 64×32 or HD up to 512×256, max 60 KB |
| `DELETE /api/skin\|cape\|elytra` | Removes one texture; the profile file goes once nothing is left |

Texture routes take the headers `X-Username` and `X-Password-Hash`
(lowercase hex SHA-256 of the SimpleLogin password, as the game sends it).
SimpleLogin's server hashes that value once more before bcrypt, so entries
hold `bcrypt(sha256(sha256(password)))`; the service does the same.

Minecraft only applies skin and cape textures from a profile. The elytra
is always drawn from the cape's wing area, so the launcher puts elytra
designs into the cape; the `elytra` route and field are kept but unused.

It listens on `127.0.0.1:18765`; nginx proxies `/api/` to it and serves
`/skins/` directly.

```bash
# run the tests (throwaway instance on port 18799, temp files)
python3 test_skin_service.py

# deploy a new version
scp skin_service.py zukashiserver:/home/ubuntu/bscraft-skins/
ssh zukashiserver 'sudo systemctl restart bscraft-skins && systemctl is-active bscraft-skins'

# logs
ssh zukashiserver 'journalctl -u bscraft-skins -n 50'
```

The unit file is `skin-service/bscraft-skins.service`
(installed to `/etc/systemd/system/`).

## Server mods vs the client pack

The server runs the server pack with these differences, each found by
booting it or joining it:

| Mod | Server | Why |
|---|---|---|
| Ok Zoomer, Lightspeed | removed | Client-only; they crash a dedicated server at startup |
| `particular-1.20.1-Forge-1.2.7.jar` | added (from the client pack, 2026-09-12) | Its network channel is required on both sides; without it every client is refused with "mismatched mod list" |

## Resetting a player

If someone forgets their password, stop nothing: in the game server
console run `/simplelogin unregister <name>` with the name in **lowercase**
(SimpleLogin stores names lowercased and the command is case-sensitive:
`unregister Elmer` says "Registry for player %s does not exist", `unregister
elmer` works). Their next join registers the name again with whatever
password their launcher has. New registrations reach `sl_entries.dat`, and
so the skin service, within about 5 minutes (SimpleLogin's auto-save).
