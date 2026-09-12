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
players set their skin from the launcher. Accounts are the SimpleLogin
registrations in `BSCraft4/world/sl_entries.dat` (read-only), so a skin
upload needs the same password the player joins with. Skins are published
in CustomSkinLoader's CustomSkinAPI format, which the modpack's
CustomSkinLoader loads from `https://bscraft.zukashix.com/skins/`.

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

## Resetting a player

If someone forgets their password, stop nothing: in the game server
console run `/simplelogin unregister <name>`. Their next join registers
the name again with whatever password their launcher has.
