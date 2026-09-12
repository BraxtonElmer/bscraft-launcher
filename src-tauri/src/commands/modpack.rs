// ============================================================
// commands/modpack.rs — Modpack manifest, sync, verify, repair
// ============================================================

use crate::commands::install::{download_file_quiet, find_java_exe, get_mc_dir};
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

    let manifest: ModpackManifest = client
        .get(&modpack_manifest_url())
        .send()
        .await
        .map_err(|e| format!("Failed to fetch manifest: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse manifest: {}", e))?;

    // Cache manifest on disk so apply_performance_mode works offline
    save_manifest_cache(&manifest);

    Ok(manifest)
}

// ── Manifest cache ─────────────────────────────────────────────────────────

fn get_manifest_cache_path() -> Result<std::path::PathBuf, String> {
    crate::commands::settings::get_data_dir().map(|d| d.join("cached_manifest.json"))
}

fn save_manifest_cache(manifest: &ModpackManifest) {
    if let Ok(path) = get_manifest_cache_path() {
        if let Ok(json) = serde_json::to_string(manifest) {
            std::fs::write(path, json).ok();
        }
    }
}

fn load_manifest_cache() -> Option<ModpackManifest> {
    let path = get_manifest_cache_path().ok()?;
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Enables or disables Performance Mode by moving flagged modpack files
/// to/from a backup folder.  Works offline once the manifest has been cached.
#[tauri::command]
pub async fn apply_performance_mode(enabled: bool) -> Result<String, String> {
    let mc_dir = get_mc_dir()?;
    let data_dir = crate::commands::settings::get_data_dir()?;
    let backup_dir = data_dir.join("performance_backup");

    let manifest = load_manifest_cache().ok_or(
        "Manifest not cached yet. Open the launcher online first so it can cache the manifest.",
    )?;

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
#[tauri::command]
pub async fn sync_modpack(app: tauri::AppHandle, remove_deleted: bool) -> Result<SyncResult, String> {
    let mc_dir = get_mc_dir()?;
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
    let mut errors: Vec<String> = Vec::new();

    for mf in &manifest.files {
        files_done += 1;
        let local_path = mc_dir.join(&mf.path);

        let needs_download = if local_path.exists() {
            // Check SHA-256
            match sha256_file(&local_path) {
                Ok(hash) if hash == mf.sha256 => false,
                Ok(_) => {
                    files_updated += 1;
                    true
                }
                Err(e) => {
                    errors.push(format!("Hash check failed for {}: {}", mf.path, e));
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
                errors.push(format!("Failed to download {}: {}", mf.path, e));
            }
        }
    }

    // Optional: remove files present locally but not in manifest
    let files_removed = if remove_deleted {
        remove_unlisted_files(&mc_dir, &manifest.files)
    } else {
        0
    };

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
        errors,
    })
}

/// Verifies the SHA-256 of every file listed in the manifest against the local copy.
/// Does not download anything — only reports what is wrong.
#[tauri::command]
pub async fn verify_files(app: tauri::AppHandle) -> Result<VerifyResult, String> {
    let mc_dir = get_mc_dir()?;
    let manifest = fetch_manifest().await?;

    let total = manifest.files.len() as u32;
    let mut passed: u32 = 0;
    let mut failed: Vec<String> = Vec::new();

    for (i, mf) in manifest.files.iter().enumerate() {
        let local_path = mc_dir.join(&mf.path);

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

    let mc_dir = get_mc_dir()?;
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

        let local_path = mc_dir.join(&mf.path);

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
    let jre_ok = find_java_exe().is_some();

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

        for (i, mf) in manifest.files.iter().enumerate() {
            let local_path = mc_dir.join(&mf.path);
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

/// Computes the SHA-256 hash of a file and returns it as a lowercase hex string.
pub fn sha256_file(path: &Path) -> Result<String, String> {
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    Ok(hex::encode(hasher.finalize()))
}

/// Removes files inside mc_dir/mods, mc_dir/config, etc. that are not in the manifest.
/// Returns the count of removed files.
fn remove_unlisted_files(mc_dir: &Path, manifest_files: &[ManifestFile]) -> u32 {
    let manifest_paths: std::collections::HashSet<_> =
        manifest_files.iter().map(|f| f.path.as_str()).collect();

    // Only scan directories managed by the modpack
    let managed_dirs = ["mods", "config", "resourcepacks", "shaderpacks"];
    let mut removed = 0u32;

    for dir in &managed_dirs {
        let dir_path = mc_dir.join(dir);
        if !dir_path.exists() {
            continue;
        }
        if let Ok(entries) = walkdir_flat(&dir_path, mc_dir) {
            for (rel, abs) in entries {
                if !manifest_paths.contains(rel.as_str()) {
                    std::fs::remove_file(&abs).ok();
                    removed += 1;
                }
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
