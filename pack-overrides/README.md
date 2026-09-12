# Pack overrides

Files added to the client modpack on top of the pack itself. Paths mirror
the game directory (`%APPDATA%\BSCraft\minecraft`).

| File | Why |
|---|---|
| `CustomSkinLoader/CustomSkinLoader.json` | Points CustomSkinLoader at the BSCraft skin service first (skins uploaded from the launcher), then Mojang (players who own an account with the same name). No other skin sites, so nobody gets a stranger's skin. |
| `config/openloader/resources/bscraft-fixes/` | An always-on resource pack (OpenLoader loads it). It replaces Twilight Forest's aurora shader with one that differs by a single line: the dynamically indexed vector write `cuboct[int(hash / 16.0)] = 0.0` becomes an equivalent mask. The original crashes Intel Iris Xe / UHD drivers (32.0.101.7084 and newer) inside `glLinkProgram` while the game loads ([TF #2559](https://github.com/TeamTwilight/twilightforest/issues/2559)); the aurora looks the same. |

The CustomSkinLoader jar itself (`mods/CustomSkinLoader_Universal-15.0.1.jar`,
from Modrinth, sha512-verified) is not stored here; it is added to
`/var/www/bscraft/modpack/files/mods/` on the server.

CustomSkinLoader rewrites its config on first start (it adds its version),
so "Verify files" may report this one file as changed. That is harmless.
