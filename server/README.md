# Server side

Two machines:

- **Web server**, `bscraft.zukashix.com` (Ubuntu 24.04, nginx): the modpack,
  launcher updates and the skin service.
- **Game server**, `bsc.akariyu.com` (129.159.19.58): the Forge server in
  `/home/elmer/game-hosting/bscraft4/` (leave `bscraft4-cleancopy` alone).

| Path on the web server | What |
|---|---|
| `/var/www/bscraft/modpack/` | Launcher modpack: `manifest.json` + `files/` |
| `/var/www/bscraft/launcher/` | Launcher self-update feed (`version.json`) and installers |
| `/var/www/bscraft/skins/` | Published skins (written by the skin service) |
| `/home/ubuntu/bscraft-skins/` | Skin service code, its private `data/` (index, accounts copy) |
| `/etc/nginx/sites-available/bscraftfs` | Site config, tracked here as `nginx/bscraftfs.conf` |

## Skin service (`skin-service/`)

A small Python service (standard library + `python3-bcrypt`) that lets
players set their skin, cape and elytra from the launcher. Accounts are the
SimpleLogin registrations in the game server's `world/sl_entries.dat`
(read-only), so an upload needs the same password the player joins with.

The game server is on the other machine, so whenever the service needs the
accounts (an upload or a password check, at most every 10 s) it fetches the
file over ssh and keeps the last good copy in `data/sl_entries.dat`; if the
game server can't be reached it carries on with that copy. The key it uses,
`/home/ubuntu/.ssh/bsc_sl_pull`, can do nothing but print that one file, from
this machine only. It's this line in `elmer`'s `~/.ssh/authorized_keys` on the
game server:

```
from="140.245.6.70",command="cat /home/elmer/game-hosting/bscraft4/world/sl_entries.dat",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA… bscraft-skins-sl-pull
```

The ssh command is set in `skin-service/bscraft-skins-sl-entries.conf`
(installed as `/etc/systemd/system/bscraft-skins.service.d/sl-entries.conf`),
with the game server's host key pinned in `/home/ubuntu/bscraft-skins/akariyu_known_hosts`.

Textures are
published in CustomSkinLoader's CustomSkinAPI format
(`<Name>.json` with `skins`, `cape` and `elytra` pointing into `textures/`),
which the modpack's CustomSkinLoader loads from
`https://bscraft.zukashix.com/skins/`.

| Route | |
|---|---|
| `GET /api/health` | |
| `GET /api/profile?name=<name>` | Public, case-insensitive: what a player has published (the launcher's "copy a look") |
| `POST /api/account/verify` | `{username, passwordHash}` → `{registered, valid}`, plus `claim` for an unregistered name with a look saved |
| `POST /api/skin?model=default\|slim` | PNG body, 64×64 or 64×32, max 32 KB |
| `POST /api/cape`, `POST /api/elytra` | PNG body, 64×32 or HD up to 512×256, max 60 KB |
| `DELETE /api/skin\|cape\|elytra` | Removes one texture; the profile file goes once nothing is left |

Texture routes take the headers `X-Username` and `X-Password-Hash`
(lowercase hex SHA-256 of the SimpleLogin password, as the game sends it).
SimpleLogin's server hashes that value once more before bcrypt, so entries
hold `bcrypt(sha256(sha256(password)))`; the service does the same.

### Looks saved before the first join

A name nobody has registered yet can still get a look, so a new player can
set theirs up in the launcher and have it from their very first join. It's
saved as a *claim*: published straight away, and tied to the credential that
saved it (the index keeps `sha256` of it, which is what SimpleLogin runs
through bcrypt, and nothing else), so only that password can change it. Every
minute the service settles claims against `sl_entries.dat`:

- the name got registered with the same password → the look is theirs, the claim goes;
- someone else registered it → the look is removed;
- nobody registered it within 7 days → the look is removed.

A registered owner saving before a round has run settles it on the spot. An
address can start at most 5 new claims a day, and `verify` answers
`"claim": "yours"|"someone"` for an unregistered name that has one, with
wrong guesses throttled like wrong passwords. Someone could still save a look
for a name that isn't theirs; it shows only until the real owner registers
the name (up to ~5 minutes after their first join, then the next round).

Minecraft only applies skin and cape textures from a profile. The elytra
is always drawn from the cape's wing area, so the launcher puts elytra
designs into the cape; the `elytra` route and field are kept but unused.

It listens on `127.0.0.1:18765`; nginx proxies `/api/` to it and serves
`/skins/` directly.

```bash
# run the tests (throwaway instances on ports 18799-18802, temp files)
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
so the skin service, within about 5 minutes (SimpleLogin's auto-save; the
service itself always reads the file fresh).
