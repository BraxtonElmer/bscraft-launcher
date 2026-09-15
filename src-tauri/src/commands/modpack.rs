// ============================================================
// commands/modpack.rs — Modpack manifest, sync, verify, repair
// ============================================================

use crate::commands::install::{download_file_quiet, get_mc_dir, java_for_pack};
use crate::commands::settings::{load_config_internal, save_config_internal};
use crate::constants::modpack_manifest_url;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use tauri::Emitter;

// ── Types ──────────────────────────────────────────────────────────────────

/// Mirrors the server-side manifest.json schema exactly.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModpackManifest {
    pub modpack_version: String,
    pub minecraft_version: String,
    pub forge_version: String,
    pub java_version: u8,
    pub files: Vec<ManifestFile>,
    /// Files installed only when missing and the player's from then on, like the pack's
    /// default options.txt. A separate list, so launchers that predate it ignore it
    /// instead of overwriting players' settings on every update.
    #[serde(default)]
    pub initial_files: Vec<ManifestFile>,
    /// How much memory the pack needs (see settings::PackMemory); absent means the built-in numbers
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory: Option<crate::commands::settings::PackMemory>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ManifestFile {
    /// Relative path within the Minecraft profile directory (e.g. "mods/jei.jar")
    pub path: String,
    /// Full download URL for this file
    pub url: String,
    /// SHA-256 hex digest for integrity verification
    pub sha256: String,
    /// File size in bytes
    pub size: u64,
    /// When true, this file is disabled when Performance Mode is ON.
    /// Optional — absent means the file is always kept.
    #[serde(default)]
    pub performance: Option<bool>,
}

#[derive(Debug, Serialize, Clone)]
pub struct SyncResult {
    pub files_checked: u32,
    pub files_updated: u32,
    pub files_added: u32,
    pub files_removed: u32,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct VerifyResult {
    pub total: u32,
    pub passed: u32,
    pub failed: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct SyncProgress {
    pub stage: String,
    pub file: String,
    pub files_done: u32,
    pub files_total: u32,
    pub overall_percent: f32,
}

/// Combined result from verify_all: covers JRE, MC, Forge, and all modpack files.
#[derive(Debug, Serialize, Clone)]
pub struct VerifyAllResult {
    pub jre_ok: bool,
    pub minecraft_ok: bool,
    pub forge_ok: bool,
    pub modpack_total: u32,
    pub modpack_passed: u32,
    pub modpack_failed: Vec<String>,
    pub server_reachable: bool,
}

// ── Tauri commands ─────────────────────────────────────────────────────────

/// Fetches and parses the modpack manifest from the server.
/// Saves a local cache so performance mode can work offline.
#[tauri::command]
pub async fn fetch_manifest() -> Result<ModpackManifest, String> {
    let client = reqwest::Client::builder()
        .user_agent(format!(
            "{}/{}",
            crate::constants::LAUNCHER_NAME,
            crate::constants::LAUNCHER_VERSION
        ))
        .build()
        .map_err(|e| e.to_string())?;

    let mut manifest: ModpackManifest = client
        .get(&modpack_manifest_url())
        .send()
        .await
        .map_err(|e| format!("Failed to fetch manifest: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse manifest: {}", e))?;
    // Folder clutter that slipped into the pack isn't installed (and, being gone from the
    // list now, is tidied away from players who already have it)
    manifest.files.retain(|f| !is_os_clutter(&f.path));
    manifest.initial_files.retain(|f| !is_os_clutter(&f.path));
    crate::commands::settings::set_pack_memory(manifest.memory);

    // Cache manifest on disk so apply_performance_mode works offline
    save_manifest_cache(&manifest);

    Ok(manifest)
}

/// Files Windows and macOS leave in folders (desktop.ini, Thumbs.db, .DS_Store...)
fn is_os_clutter(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    matches!(name.as_str(), "desktop.ini" | "thumbs.db" | "ehthumbs.db" | ".ds_store")
        || name.starts_with("._")
        || path.split('/').any(|part| part == "__MACOSX")
}

// ── Manifest cache ─────────────────────────────────────────────────────────

fn get_manifest_cache_path() -> Result<std::path::PathBuf, String> {
    crate::commands::settings::get_data_dir().map(|d| d.join("cached_manifest.json"))
}

fn save_manifest_cache(manifest: &ModpackManifest) {
    if let Ok(path) = get_manifest_cache_path() {
        if let Ok(json) = serde_json::to_string(manifest) {
            // On a first run the launcher's data folder doesn't exist yet
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir).ok();
            }
            std::fs::write(path, json).ok();
        }
    }
}

fn load_manifest_cache() -> Option<ModpackManifest> {
    let path = get_manifest_cache_path().ok()?;
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// The pack's memory needs, from the last manifest fetched (None if it doesn't say)
pub(crate) fn cached_pack_memory() -> Option<crate::commands::settings::PackMemory> {
    load_manifest_cache().and_then(|m| m.memory)
}

/// The Java version the modpack runs on, from the last manifest fetched
pub(crate) fn required_java() -> Option<u8> {
    load_manifest_cache().map(|m| m.java_version)
}

/// The manifest of the last completed sync: what the pack put on this PC. The cache above
/// can't serve, since it already holds the newer manifest by the time an update runs.
fn installed_manifest_path() -> Result<std::path::PathBuf, String> {
    crate::commands::settings::get_data_dir().map(|d| d.join("installed_manifest.json"))
}

fn load_installed_manifest() -> Option<ModpackManifest> {
    let raw = std::fs::read_to_string(installed_manifest_path().ok()?).ok()?;
    serde_json::from_str(&raw).ok()
}

fn save_installed_manifest(manifest: &ModpackManifest) {
    if let (Ok(path), Ok(json)) = (installed_manifest_path(), serde_json::to_string(manifest)) {
        std::fs::write(path, json).ok();
    }
}

/// Where each pack file lives on this PC. With Performance Mode on, the files it
/// switches off wait in the backup folder, so syncing, verifying and repairing
/// don't quietly put them back into the game.
struct FileHomes {
    mc_dir: std::path::PathBuf,
    backup_dir: std::path::PathBuf,
    performance: bool,
}

impl FileHomes {
    fn load() -> Result<Self, String> {
        Ok(Self {
            mc_dir: get_mc_dir()?,
            backup_dir: crate::commands::settings::get_data_dir()?.join("performance_backup"),
            performance: load_config_internal().map(|c| c.performance_mode).unwrap_or(false),
        })
    }

    fn path(&self, mf: &ManifestFile) -> std::path::PathBuf {
        if self.performance && mf.performance == Some(true) {
            self.backup_dir.join(&mf.path)
        } else {
            self.mc_dir.join(&mf.path)
        }
    }

    /// A switched-off file found in the game folder goes (back) to the backup folder
    fn park(&self, mf: &ManifestFile) {
        if !(self.performance && mf.performance == Some(true)) {
            return;
        }
        let in_game = self.mc_dir.join(&mf.path);
        let parked = self.backup_dir.join(&mf.path);
        if !in_game.exists() {
            return;
        }
        if parked.exists() {
            std::fs::remove_file(&in_game).ok();
        } else if let Some(parent) = parked.parent() {
            std::fs::create_dir_all(parent).ok();
            std::fs::rename(&in_game, &parked).ok();
        }
    }
}

/// Enables or disables Performance Mode by moving flagged modpack files
/// to/from a backup folder.  Works offline once the manifest has been cached.
#[tauri::command]
pub async fn apply_performance_mode(enabled: bool) -> Result<String, String> {
    let mc_dir = get_mc_dir()?;
    let data_dir = crate::commands::settings::get_data_dir()?;
    let backup_dir = data_dir.join("performance_backup");

    // The cached copy lets this work offline; without one, ask the server
    let manifest = match load_manifest_cache() {
        Some(m) => m,
        None => fetch_manifest().await.map_err(|e| {
            format!("Couldn't get the modpack's file list from the server to switch modes. {}", e)
        })?,
    };

    let perf_files: Vec<&ManifestFile> = manifest
        .files
        .iter()
        .filter(|f| f.performance == Some(true))
        .collect();

    let mut moved = 0u32;

    if enabled {
        // Move files from mc_dir → backup
        std::fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
        for mf in &perf_files {
            let src = mc_dir.join(&mf.path);
            let dst = backup_dir.join(&mf.path);
            if src.exists() {
                if let Some(parent) = dst.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                std::fs::rename(&src, &dst)
                    .map_err(|e| format!("Cannot move {} to backup: {}", mf.path, e))?;
                moved += 1;
            }
        }
        Ok(format!("Performance Mode ON — {} file(s) moved to backup", moved))
    } else {
        // Move files back from backup → mc_dir
        for mf in &perf_files {
            let src = backup_dir.join(&mf.path);
            let dst = mc_dir.join(&mf.path);
            if src.exists() {
                if let Some(parent) = dst.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                std::fs::rename(&src, &dst)
                    .map_err(|e| format!("Cannot restore {} from backup: {}", mf.path, e))?;
                moved += 1;
            }
        }
        Ok(format!("Performance Mode OFF — {} file(s) restored", moved))
    }
}

/// Syncs the local modpack files against the server manifest.
/// - Downloads files that are missing or have a different SHA-256.
/// - Removes files that are no longer in the manifest (if `remove_deleted` is true).
/// - Emits `sync-progress` events for UI feedback.
///
/// Fails if any file couldn't be downloaded, without recording the new pack version, so
/// the game isn't started with mods missing and the next Play tries again.
#[tauri::command]
pub async fn sync_modpack(app: tauri::AppHandle, remove_deleted: bool) -> Result<SyncResult, String> {
    let mc_dir = get_mc_dir()?;
    let homes = FileHomes::load()?;
    let previous = load_installed_manifest();
    let manifest = fetch_manifest().await?;

    let client = reqwest::Client::builder()
        .user_agent(format!(
            "{}/{}",
            crate::constants::LAUNCHER_NAME,
            crate::constants::LAUNCHER_VERSION
        ))
        .build()
        .map_err(|e| e.to_string())?;

    let total = manifest.files.len() as u32;
    let mut files_done: u32 = 0;
    let mut files_updated: u32 = 0;
    let mut files_added: u32 = 0;
    // Files the pack needs that couldn't be downloaded
    let mut failed: Vec<String> = Vec::new();

    for mf in &manifest.files {
        files_done += 1;
        homes.park(mf);
        let local_path = homes.path(mf);

        let needs_download = if local_path.exists() {
            // Check SHA-256
            match sha256_file(&local_path) {
                Ok(hash) if hash == mf.sha256 => false,
                Ok(_) => {
                    files_updated += 1;
                    true
                }
                // Unreadable: download it again
                Err(_) => {
                    files_updated += 1;
                    true
                }
            }
        } else {
            files_added += 1;
            true
        };

        app.emit(
            "sync-progress",
            SyncProgress {
                stage: if needs_download { "downloading" } else { "checking" }.to_string(),
                file: mf.path.clone(),
                files_done,
                files_total: total,
                overall_percent: files_done as f32 / total as f32 * 100.0,
            },
        )
        .ok();

        if needs_download {
            if let Err(e) = download_file_quiet(&client, &mf.url, &local_path).await {
                failed.push(format!("{} ({})", mf.path, e));
            }
        }
    }

    // Pack defaults (e.g. options.txt) go in only once; after that they're the player's
    for mf in &manifest.initial_files {
        let local_path = mc_dir.join(&mf.path);
        if let Err(e) = install_initial_file(&client, mf, &local_path).await {
            failed.push(format!("{} ({})", mf.path, e));
        } else if !local_path.exists() {
            failed.push(mf.path.clone());
        }
    }

    if !failed.is_empty() {
        return Err(download_failure_message(&failed, total as usize + manifest.initial_files.len()));
    }

    // Optional: remove files the pack no longer ships
    let files_removed = if remove_deleted {
        remove_stale_files(&mc_dir, &manifest, previous.as_ref())
    } else {
        0
    };
    save_installed_manifest(&manifest);

    // Update config with new modpack version
    let mut config = load_config_internal()?;
    config.installed_modpack_version = Some(manifest.modpack_version.clone());
    config.installed_mc_version = Some(manifest.minecraft_version.clone());
    config.installed_forge_version = Some(manifest.forge_version.clone());
    save_config_internal(&config)?;

    Ok(SyncResult {
        files_checked: total,
        files_updated,
        files_added,
        files_removed,
        errors: Vec::new(),
    })
}

/// Verifies the SHA-256 of every file listed in the manifest against the local copy.
/// Does not download anything — only reports what is wrong.
#[tauri::command]
pub async fn verify_files(app: tauri::AppHandle) -> Result<VerifyResult, String> {
    let homes = FileHomes::load()?;
    let manifest = fetch_manifest().await?;

    let total = manifest.files.len() as u32;
    let mut passed: u32 = 0;
    let mut failed: Vec<String> = Vec::new();

    for (i, mf) in manifest.files.iter().enumerate() {
        let local_path = homes.path(mf);

        let ok = if local_path.exists() {
            match sha256_file(&local_path) {
                Ok(hash) => hash == mf.sha256,
                Err(_) => false,
            }
        } else {
            false
        };

        if ok {
            passed += 1;
        } else {
            failed.push(mf.path.clone());
        }

        app.emit(
            "verify-progress",
            serde_json::json!({
                "file": mf.path,
                "ok": ok,
                "files_done": i + 1,
                "files_total": total,
            }),
        )
        .ok();
    }

    Ok(VerifyResult { total, passed, failed })
}

/// Re-downloads a specific list of files by their relative paths.
/// Used after verify_files returns failures, or after manual "Repair" action.
#[tauri::command]
pub async fn repair_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }

    let homes = FileHomes::load()?;
    let manifest = fetch_manifest().await?;

    let client = reqwest::Client::builder()
        .user_agent(format!(
            "{}/{}",
            crate::constants::LAUNCHER_NAME,
            crate::constants::LAUNCHER_VERSION
        ))
        .build()
        .map_err(|e| e.to_string())?;

    let total = paths.len() as u32;
    for (i, path) in paths.iter().enumerate() {
        let mf = manifest
            .files
            .iter()
            .find(|f| &f.path == path)
            .ok_or_else(|| format!("File not found in manifest: {}", path))?;

        let local_path = homes.path(mf);

        app.emit(
            "sync-progress",
            SyncProgress {
                stage: "repairing".to_string(),
                file: path.clone(),
                files_done: i as u32 + 1,
                files_total: total,
                overall_percent: (i as f32 + 1.0) / total as f32 * 100.0,
            },
        )
        .ok();

        download_file_quiet(&client, &mf.url, &local_path).await?;
    }

    Ok(())
}

/// Comprehensive file integrity check: JRE, Minecraft client, Forge, and all modpack files.
/// Emits `verify-progress` events as it goes. Does not download anything.
#[tauri::command]
pub async fn verify_all(app: tauri::AppHandle) -> Result<VerifyAllResult, String> {
    let mc_dir = get_mc_dir()?;
    let config = load_config_internal()?;

    // Step 1: JRE
    app.emit(
        "verify-progress",
        serde_json::json!({ "step": "jre", "detail": "Checking Java runtime…", "percent": 10.0 }),
    )
    .ok();
    let jre_ok = java_for_pack().is_ok();

    // Step 2: Minecraft client JAR
    app.emit(
        "verify-progress",
        serde_json::json!({ "step": "minecraft", "detail": "Checking Minecraft client…", "percent": 25.0 }),
    )
    .ok();
    let minecraft_ok = config
        .installed_mc_version
        .as_ref()
        .map(|v| {
            mc_dir
                .join("versions")
                .join(v)
                .join(format!("{}.jar", v))
                .exists()
        })
        .unwrap_or(false);

    // Step 3: Forge version JSON
    app.emit(
        "verify-progress",
        serde_json::json!({ "step": "forge", "detail": "Checking Forge installation…", "percent": 40.0 }),
    )
    .ok();
    let forge_ok = match (&config.installed_mc_version, &config.installed_forge_version) {
        (Some(mc), Some(forge)) => {
            let vid = format!("{}-forge-{}", mc, forge);
            mc_dir
                .join("versions")
                .join(&vid)
                .join(format!("{}.json", vid))
                .exists()
        }
        _ => false,
    };

    // Step 4: Modpack files (requires server)
    app.emit(
        "verify-progress",
        serde_json::json!({ "step": "modpack", "detail": "Fetching manifest…", "percent": 50.0 }),
    )
    .ok();

    let manifest_result = fetch_manifest().await;
    let server_reachable = manifest_result.is_ok();

    let (modpack_total, modpack_passed, modpack_failed) = if let Ok(manifest) = manifest_result {
        let total = manifest.files.len() as u32;
        let mut passed = 0u32;
        let mut failed = Vec::new();

        let homes = FileHomes::load()?;
        for (i, mf) in manifest.files.iter().enumerate() {
            let local_path = homes.path(mf);
            let ok = if local_path.exists() {
                sha256_file(&local_path)
                    .map(|h| h == mf.sha256)
                    .unwrap_or(false)
            } else {
                false
            };

            if ok {
                passed += 1;
            } else {
                failed.push(mf.path.clone());
            }

            let pct = 50.0 + (i as f32 + 1.0) / total as f32 * 50.0;
            app.emit(
                "verify-progress",
                serde_json::json!({
                    "step": "modpack",
                    "detail": format!("Checking {} / {} modpack files…", i + 1, total),
                    "percent": pct,
                    "files_done": i + 1,
                    "files_total": total,
                }),
            )
            .ok();
        }

        (total, passed, failed)
    } else {
        (0, 0, vec![])
    };

    Ok(VerifyAllResult {
        jre_ok,
        minecraft_ok,
        forge_ok,
        modpack_total,
        modpack_passed,
        modpack_failed,
        server_reachable,
    })
}

// ── Helpers ────────────────────────────────────────────────────────────────

/// What the player is told when files couldn't be downloaded: how many, the first few, and what to do
fn download_failure_message(failed: &[String], total: usize) -> String {
    const SHOWN: usize = 3;
    let mut msg = format!(
        "Couldn't download {} of {} modpack files from the BSCraft server, so the game wasn't started.",
        failed.len(),
        total
    );
    for f in failed.iter().take(SHOWN) {
        msg.push_str("\n• ");
        msg.push_str(f);
    }
    if failed.len() > SHOWN {
        msg.push_str(&format!("\n• and {} more", failed.len() - SHOWN));
    }
    msg.push_str("\n\nCheck your internet connection and press Play to try again. Files that did download are kept.");
    msg
}

/// Computes the SHA-256 hash of a file and returns it as a lowercase hex string.
pub fn sha256_file(path: &Path) -> Result<String, String> {
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    Ok(hex::encode(hasher.finalize()))
}

/// Installs a pack default when it's missing. An options.txt the launcher wrote before the
/// game was installed (only skin settings) is replaced by the pack's, keeping those settings.
async fn install_initial_file(client: &reqwest::Client, mf: &ManifestFile, local_path: &Path) -> Result<(), String> {
    let stub = match std::fs::read_to_string(local_path) {
        Ok(text) if mf.path == "options.txt" && crate::commands::account::is_skin_prefs_stub(&text) => Some(text),
        Ok(_) => return Ok(()),
        Err(_) if local_path.exists() => return Ok(()),
        Err(_) => None,
    };
    download_file_quiet(client, &mf.url, local_path).await?;
    if let Some(stub) = stub {
        let prefs = crate::commands::account::parse_skin_prefs(&stub);
        let pack = std::fs::read_to_string(local_path).map_err(|e| e.to_string())?;
        let merged = crate::commands::account::apply_skin_prefs(Some(&pack), &prefs);
        std::fs::write(local_path, merged).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// A manifest path that stays inside the game folder
fn safe_relative(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains(':')
        && path.split(['/', '\\']).all(|part| part != ".." && !part.is_empty())
}

/// Removes files the pack no longer ships. Returns how many were removed.
///
/// mods/ belongs to the pack: any file there it doesn't list goes, because an extra or
/// outdated mod can stop you joining. Everywhere else only files the pack installed
/// before and has since dropped are removed, so configs that mods write while running
/// and resource or shader packs players add themselves are left alone.
fn remove_stale_files(mc_dir: &Path, manifest: &ModpackManifest, previous: Option<&ModpackManifest>) -> u32 {
    let current: std::collections::HashSet<&str> = manifest
        .files
        .iter()
        .chain(manifest.initial_files.iter())
        .map(|f| f.path.as_str())
        .collect();
    let mut removed = 0u32;

    if let Ok(entries) = walkdir_flat(&mc_dir.join("mods"), mc_dir) {
        for (rel, abs) in entries {
            if !current.contains(rel.as_str()) && std::fs::remove_file(&abs).is_ok() {
                removed += 1;
            }
        }
    }

    if let Some(previous) = previous {
        for f in &previous.files {
            if current.contains(f.path.as_str()) || f.path.starts_with("mods/") || !safe_relative(&f.path) {
                continue;
            }
            let abs = mc_dir.join(&f.path);
            if abs.is_file() && std::fs::remove_file(&abs).is_ok() {
                removed += 1;
            }
        }
    }

    removed
}

/// Returns a flat list of (relative_path, absolute_path) for all files under `dir`.
fn walkdir_flat(dir: &Path, base: &Path) -> Result<Vec<(String, std::path::PathBuf)>, String> {
    let mut result = Vec::new();
    collect_files(dir, base, &mut result)?;
    Ok(result)
}

fn collect_files(
    current: &Path,
    base: &Path,
    out: &mut Vec<(String, std::path::PathBuf)>,
) -> Result<(), String> {
    let entries = std::fs::read_dir(current).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, base, out)?;
        } else {
            let rel = path
                .strip_prefix(base)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            out.push((rel, path));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{download_failure_message, is_os_clutter, safe_relative, ModpackManifest};

    #[test]
    fn download_failures_name_the_first_files_and_the_count() {
        let failed: Vec<String> = (1..=5).map(|i| format!("mods/mod{i}.jar (HTTP 404 Not Found for https://x/mods/mod{i}.jar)")).collect();
        let msg = download_failure_message(&failed, 2666);
        assert!(msg.starts_with("Couldn't download 5 of 2666 modpack files"));
        assert!(msg.contains("• mods/mod1.jar (HTTP 404") && msg.contains("• mods/mod3.jar"));
        assert!(!msg.contains("mod4.jar") && msg.contains("• and 2 more"));
        let one = download_failure_message(&failed[..1], 10);
        assert!(!one.contains("more") && one.contains("press Play to try again"));
    }

    #[test]
    fn reads_the_packs_memory_needs_when_given() {
        let base = r#""modpack_version":"4.0.3","minecraft_version":"1.20.1","forge_version":"47.4.10","java_version":17,"files":[]"#;
        let old: ModpackManifest = serde_json::from_str(&format!("{{{base}}}")).unwrap();
        assert!(old.memory.is_none());
        let new: ModpackManifest = serde_json::from_str(&format!(
            r#"{{{base},"memory":{{"min_mb":6144,"recommended_mb":8192,"recommended_large_mb":10240,"max_useful_mb":12288}}}}"#
        ))
        .unwrap();
        assert_eq!(new.memory, Some(crate::commands::settings::PackMemory::default()));
    }

    #[test]
    fn folder_clutter_is_left_out() {
        for junk in ["desktop.ini", "config/Desktop.ini", "shaderpacks/Thumbs.db", "mods/.DS_Store", "__MACOSX/mods/x.jar", "mods/._jei.jar"] {
            assert!(is_os_clutter(junk), "{junk}");
        }
        for real in ["mods/jei-1.20.1.jar", "config/desktop.json", "options.txt", "config/thumbs/db.toml"] {
            assert!(!is_os_clutter(real), "{real}");
        }
    }

    #[test]
    fn manifest_paths_must_stay_inside_the_game_folder() {
        assert!(safe_relative("config/openloader/resources/bscraft-fixes/pack.mcmeta"));
        assert!(!safe_relative("../outside.txt"));
        assert!(!safe_relative("config/../../outside.txt"));
        assert!(!safe_relative("C:/Windows/x.dll"));
        assert!(!safe_relative("/etc/passwd"));
    }
}
