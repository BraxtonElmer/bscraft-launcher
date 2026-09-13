// ============================================================
// constants.rs — Single source of truth for all external URLs
// Change SERVER_BASE_URL here to point to your server.
// ============================================================

/// Base URL of your BSCraft file server. Change this before building.
pub const SERVER_BASE_URL: &str = "https://bscraft.zukashix.com";

/// Embedded at compile time from Cargo.toml version field.
pub const LAUNCHER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Human-readable launcher brand name used in Minecraft launch args.
pub const LAUNCHER_NAME: &str = "BSCraftLauncher";

/// The BSCraft game server, as it appears in the in-game server list.
pub const GAME_SERVER_NAME: &str = "BSCraft";
pub const GAME_SERVER_ADDRESS: &str = "bscraft.zukashix.com";

// ── External service URLs ──────────────────────────────────────────────────

/// Adoptium (Eclipse Temurin) API — returns JRE download metadata.
/// Targets Java 17 JRE for Windows x64 (required for Minecraft 1.17+).
/// Adoptium direct binary download — kept for reference; active code uses the /binary/latest endpoint.
#[allow(dead_code)]
pub const ADOPTIUM_API_URL: &str =
    "https://api.adoptium.net/v3/assets/latest/17/jre?os=windows&architecture=x64&image_type=jre";

/// Mojang version manifest — lists all released Minecraft versions + their JSON URLs.
pub const MOJANG_VERSION_MANIFEST_URL: &str =
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

/// Forge Maven repository base for downloading the official Forge installer.
pub const FORGE_MAVEN_BASE: &str =
    "https://maven.minecraftforge.net/net/minecraftforge/forge";

/// Minecraft asset CDN — assets are keyed by the first 2 chars of their SHA-1 hash.
pub const MINECRAFT_RESOURCES_URL: &str =
    "https://resources.download.minecraft.net";

// ── Derived URLs (built from SERVER_BASE_URL at runtime) ──────────────────

/// Full URL to the modpack manifest JSON on your server.
pub fn modpack_manifest_url() -> String {
    // Dev builds can try an unpublished manifest, e.g.
    // BSCRAFT_MANIFEST_URL=http://127.0.0.1:8765/manifest.json npm run tauri dev
    #[cfg(debug_assertions)]
    if let Ok(url) = std::env::var("BSCRAFT_MANIFEST_URL") {
        return url;
    }
    format!("{}/modpack/manifest.json", SERVER_BASE_URL)
}

/// Full URL to the launcher version JSON used by the Tauri updater.
#[allow(dead_code)]
pub fn launcher_version_url() -> String {
    format!("{}/launcher/version.json", SERVER_BASE_URL)
}

/// Constructs the official Forge installer JAR download URL from Forge Maven.
///
/// # Arguments
/// * `mc_version` — e.g. "1.20.1"
/// * `forge_version` — e.g. "47.3.0"
pub fn forge_installer_url(mc_version: &str, forge_version: &str) -> String {
    format!(
        "{base}/{mc}-{forge}/forge-{mc}-{forge}-installer.jar",
        base = FORGE_MAVEN_BASE,
        mc = mc_version,
        forge = forge_version
    )
}
