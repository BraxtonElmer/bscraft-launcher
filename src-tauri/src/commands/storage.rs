// ============================================================
// commands/storage.rs — What BSCraft keeps on this PC, clearing
// the caches, and uninstalling everything
//
// Everything lives in %APPDATA%\BSCraft (see README › Player data on
// disk). Windows' uninstaller only removes the launcher itself, so
// the launcher offers to take the game with it, keeping the player's
// worlds and screenshots if they like.
// ============================================================

use crate::commands::settings::get_data_dir;
use crate::state::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Debug, Serialize, Clone)]
pub struct StorageGroup {
    pub key: String,
    pub bytes: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct StorageUsage {
    pub path: String,
    pub total: u64,
    /// java, game (Minecraft + Forge), modpack, worlds (the player's own), caches (safe to clear)
    pub groups: Vec<StorageGroup>,
}

/// Folders in the game directory that are the player's own: kept on uninstall if they ask
const PLAYER_FOLDERS: &[&str] = &["saves", "screenshots", "schematics", "XaeroWaypoints", "xaero"];

/// Rebuilt as needed (logs, crash reports, downloaded skins, Distant Horizons' far terrain)
fn cache_paths(data: &Path) -> Vec<PathBuf> {
    let mc = data.join("minecraft");
    let mut paths = vec![
        mc.join("logs"),
        mc.join("crash-reports"),
        mc.join("Distant_Horizons_server_data"),
        mc.join("CustomSkinLoader").join("caches"),
        mc.join("lightspeed-cache"),
        data.join("logs"),
    ];
    // Java's crash dumps
    if let Ok(entries) = std::fs::read_dir(&mc) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with("hs_err_pid") && name.ends_with(".log") {
                paths.push(e.path());
            }
        }
    }
    paths
}

fn size_of(path: &Path) -> u64 {
    let Ok(meta) = std::fs::symlink_metadata(path) else { return 0 };
    if meta.is_file() {
        return meta.len();
    }
    if !meta.is_dir() {
        return 0;
    }
    std::fs::read_dir(path)
        .map(|entries| entries.flatten().map(|e| size_of(&e.path())).sum())
        .unwrap_or(0)
}

fn group_of(name: &str) -> &'static str {
    match name {
        "runtime" => "java",
        "versions" | "libraries" | "assets" => "game",
        n if PLAYER_FOLDERS.contains(&n) || n.starts_with("XaeroWaypoints") => "worlds",
        _ => "modpack",
    }
}

fn usage() -> Result<StorageUsage, String> {
    let data = get_data_dir()?;
    let mc = data.join("minecraft");
    let caches = cache_paths(&data);
    let mut totals: std::collections::BTreeMap<&str, u64> = Default::default();
    let cache_bytes: u64 = caches.iter().map(|p| size_of(p)).sum();
    totals.insert("caches", cache_bytes);

    if let Ok(entries) = std::fs::read_dir(&mc) {
        for e in entries.flatten() {
            let path = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            // Caches inside (skin cache in CustomSkinLoader) are counted as caches, not twice
            let inside: u64 = caches.iter().filter(|c| c.starts_with(&path)).map(|c| size_of(c)).sum();
            let bytes = size_of(&path).saturating_sub(inside);
            *totals.entry(group_of(&name)).or_default() += bytes;
        }
    }
    // The launcher's own files next to the game (settings, manifests, Performance Mode's backup)
    if let Ok(entries) = std::fs::read_dir(&data) {
        for e in entries.flatten() {
            let name = e.file_name();
            if name == "minecraft" || name == "logs" {
                continue;
            }
            *totals.entry("modpack").or_default() += size_of(&e.path());
        }
    }
    let order = ["game", "java", "modpack", "worlds", "caches"];
    let groups: Vec<StorageGroup> =
        order.iter().map(|k| StorageGroup { key: k.to_string(), bytes: totals.get(k).copied().unwrap_or(0) }).collect();
    Ok(StorageUsage {
        path: data.to_string_lossy().to_string(),
        total: groups.iter().map(|g| g.bytes).sum(),
        groups,
    })
}

fn game_running(state: &State<'_, AppState>) -> bool {
    state.game_process.lock().map(|p| p.is_some()).unwrap_or(false)
}

// ── Tauri commands ─────────────────────────────────────────────────────────

/// How much space BSCraft takes, by kind
#[tauri::command]
pub async fn storage_usage() -> Result<StorageUsage, String> {
    tokio::task::spawn_blocking(usage).await.map_err(|e| e.to_string())?
}

/// Opens %APPDATA%\BSCraft in Explorer
#[tauri::command]
pub async fn open_data_folder() -> Result<(), String> {
    let data = get_data_dir()?;
    std::fs::create_dir_all(&data).ok();
    #[cfg(windows)]
    let program = "explorer";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let program = "xdg-open";
    std::process::Command::new(program).arg(&data).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Deletes the caches (see `cache_paths`); returns the bytes freed
#[tauri::command]
pub async fn clear_caches(state: State<'_, AppState>) -> Result<u64, String> {
    if game_running(&state) {
        return Err("Close Minecraft first: it's using some of these files.".into());
    }
    tokio::task::spawn_blocking(|| {
        let data = get_data_dir()?;
        let mut freed = 0;
        for p in cache_paths(&data) {
            let bytes = size_of(&p);
            let gone = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
            if gone.is_ok() {
                freed += bytes;
            }
        }
        Ok(freed)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, Serialize, Clone)]
pub struct UninstallResult {
    /// Where the player's worlds were moved, if they were kept
    pub kept_in: Option<String>,
    /// Windows' uninstaller for the launcher is open; false when it couldn't be started
    pub uninstaller_started: bool,
}

/// Removes the game and everything the launcher downloaded, moving the player's own
/// folders to Documents\BSCraft worlds first if `keep_worlds`, then opens the launcher's
/// uninstaller and closes the launcher so it can be removed too.
#[tauri::command]
pub async fn uninstall_bscraft(app: tauri::AppHandle, state: State<'_, AppState>, keep_worlds: bool) -> Result<UninstallResult, String> {
    if game_running(&state) {
        return Err("Close Minecraft first.".into());
    }
    let kept_in = tokio::task::spawn_blocking(move || -> Result<Option<String>, String> {
        let data = get_data_dir()?;
        let kept_in = if keep_worlds {
            let docs = dirs::document_dir().or_else(dirs::home_dir).ok_or("Couldn't find your Documents folder")?;
            keep_player_folders(&data.join("minecraft"), &docs)?
        } else {
            None
        };
        if data.exists() {
            std::fs::remove_dir_all(&data).map_err(|e| {
                format!("Couldn't remove everything in {} ({}). Close anything using it and try again.", data.display(), e)
            })?;
        }
        Ok(kept_in)
    })
    .await
    .map_err(|e| e.to_string())??;

    // The uninstaller sits next to the launcher (installed builds only)
    let uninstaller = std::env::current_exe().ok().and_then(|exe| exe.parent().map(|d| d.join("uninstall.exe")));
    let uninstaller_started = match uninstaller {
        Some(path) if path.exists() => std::process::Command::new(&path).spawn().is_ok(),
        _ => false,
    };
    if uninstaller_started {
        // Give the page a moment to say goodbye, then get out of the uninstaller's way
        let app = app.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
            app.exit(0);
        });
    }
    Ok(UninstallResult { kept_in, uninstaller_started })
}

/// Moves worlds, screenshots, schematics and map waypoints to <docs>\BSCraft worlds
fn keep_player_folders(mc: &Path, docs: &Path) -> Result<Option<String>, String> {
    let present: Vec<PathBuf> = std::fs::read_dir(mc)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    (PLAYER_FOLDERS.contains(&name.as_str()) || name.starts_with("XaeroWaypoints")) && size_of(&e.path()) > 0
                })
                .map(|e| e.path())
                .collect()
        })
        .unwrap_or_default();
    if present.is_empty() {
        return Ok(None);
    }
    let mut dest = docs.join("BSCraft worlds");
    for n in 2.. {
        if !dest.exists() {
            break;
        }
        dest = docs.join(format!("BSCraft worlds ({})", n));
    }
    std::fs::create_dir_all(&dest).map_err(|e| format!("Couldn't create {}: {}", dest.display(), e))?;
    for src in present {
        let to = dest.join(src.file_name().unwrap_or_default());
        // A rename when it's the same drive; otherwise copy, then delete
        if std::fs::rename(&src, &to).is_err() {
            copy_dir(&src, &to).map_err(|e| format!("Couldn't keep {}: {}", src.display(), e))?;
        }
    }
    Ok(Some(dest.to_string_lossy().to_string()))
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from)? {
        let e = e?;
        let target = to.join(e.file_name());
        if e.file_type()?.is_dir() {
            copy_dir(&e.path(), &target)?;
        } else {
            std::fs::copy(e.path(), target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{group_of, keep_player_folders, usage};
    use std::fs;

    fn scratch(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("bsc-storage-test-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn keeps_only_the_players_own_folders() {
        let root = scratch("keep");
        let mc = root.join("minecraft");
        let docs = root.join("Documents");
        for (path, body) in [("saves/My World/level.dat", "w"), ("screenshots/a.png", "s"), ("mods/jei.jar", "m"), ("XaeroWaypoints/x.txt", "x"), ("schematics/empty", "")] {
            let p = mc.join(path);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, body).unwrap();
        }
        fs::create_dir_all(docs.join("BSCraft worlds")).unwrap(); // from an earlier uninstall
        let kept = keep_player_folders(&mc, &docs).unwrap().unwrap();
        let kept = std::path::Path::new(&kept);
        assert_eq!(kept, docs.join("BSCraft worlds (2)"));
        assert_eq!(fs::read_to_string(kept.join("saves/My World/level.dat")).unwrap(), "w");
        assert!(kept.join("screenshots/a.png").exists() && kept.join("XaeroWaypoints/x.txt").exists());
        // Empty folders aren't worth keeping, and the modpack stays behind to be deleted
        assert!(!kept.join("schematics").exists());
        assert!(!kept.join("mods").exists() && mc.join("mods/jei.jar").exists());
        assert!(!mc.join("saves").exists());
        // Nothing of the player's: nothing kept
        let empty = scratch("keep-none");
        assert!(keep_player_folders(&empty, &docs).unwrap().is_none());
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&empty);
    }

    /// Read-only look at this PC's real BSCraft folder: cargo test storage -- --ignored --nocapture
    #[test]
    #[ignore]
    fn shows_this_pcs_storage() {
        let u = usage().unwrap();
        for g in &u.groups {
            println!("{:>8}  {:>10.1} MB", g.key, g.bytes as f64 / 1048576.0);
        }
        println!("   total  {:>10.1} MB  in {}", u.total as f64 / 1048576.0, u.path);
    }

    #[test]
    fn sorts_the_game_folder_into_groups() {
        assert_eq!(group_of("runtime"), "java");
        assert_eq!(group_of("libraries"), "game");
        assert_eq!(group_of("saves"), "worlds");
        assert_eq!(group_of("XaeroWaypoints_BACKUP240807"), "worlds");
        assert_eq!(group_of("mods"), "modpack");
        assert_eq!(group_of("config"), "modpack");
    }
}
