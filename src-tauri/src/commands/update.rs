// ============================================================
// commands/update.rs — Launcher self-update via Tauri updater plugin
// ============================================================

use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tauri_plugin_updater::UpdaterExt;

// ── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct UpdateCheckResult {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
    pub percent: f32,
}

// ── Tauri commands ─────────────────────────────────────────────────────────

/// Checks the server for a newer launcher version using the Tauri updater plugin.
/// Returns immediately with update status — does not download anything.
#[tauri::command]
pub async fn check_launcher_update(app: tauri::AppHandle) -> Result<UpdateCheckResult, String> {
    let current = app.package_info().version.to_string();

    let updater = app
        .updater_builder()
        .build()
        .map_err(|e| format!("Updater init failed: {}", e))?;

    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateCheckResult {
            has_update: true,
            current_version: current,
            latest_version: update.version.clone(),
            notes: update.body.clone(),
        }),
        Ok(None) => Ok(no_update(current)),
        // version.json has no build for this platform (e.g. a Windows-only release): nothing to
        // install here. The plugin checks this before comparing versions, so without it every
        // check on a Mac would fail whenever the release doesn't include macOS.
        Err(tauri_plugin_updater::Error::TargetNotFound(_) | tauri_plugin_updater::Error::TargetsNotFound(_)) => {
            Ok(no_update(current))
        }
        Err(e) => Err(format!("Update check failed: {}", e)),
    }
}

fn no_update(current: String) -> UpdateCheckResult {
    UpdateCheckResult { has_update: false, current_version: current.clone(), latest_version: current, notes: None }
}

/// macOS replaces the whole app, which it can't do while the app runs straight from the disk
/// image or from the read-only copy macOS makes of an app that was never moved (App Translocation)
#[cfg(target_os = "macos")]
fn check_app_can_update() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let path = exe.to_string_lossy();
    if path.starts_with("/Volumes/") || path.contains("/AppTranslocation/") {
        return Err("Move BSCraft Launcher to your Applications folder, open it from there, then update.".into());
    }
    Ok(())
}

/// Downloads the new launcher version (emitting progress events), checks its
/// signature, and hands over to its installer, which restarts the launcher.
///
/// Emits: `launcher-update-progress` → UpdateProgress
///
/// Doesn't return on success: the launcher closes for the installer. If the
/// installer can't start (Windows' Smart App Control blocks new unsigned
/// programs until Microsoft has looked them up), it returns an error and the
/// launcher stays open, instead of closing with nothing taking its place.
#[tauri::command]
pub async fn apply_launcher_update(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    check_app_can_update()?;

    let updater = app
        .updater_builder()
        .build()
        .map_err(|e| format!("Updater init failed: {}", e))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("Update check failed: {}", e))?
        .ok_or_else(|| "No update available".to_string())?;

    // Track cumulative downloaded bytes across chunks
    let downloaded = Arc::new(AtomicU64::new(0));
    let downloaded_clone = downloaded.clone();
    let app_clone = app.clone();

    let bytes = update
        .download(
            move |chunk_len, content_length| {
                let total_dl =
                    downloaded_clone.fetch_add(chunk_len as u64, Ordering::SeqCst) + chunk_len as u64;
                let percent = content_length
                    .map(|t| (total_dl as f32 / t as f32 * 100.0).min(100.0))
                    .unwrap_or(0.0);

                app_clone
                    .emit(
                        "launcher-update-progress",
                        UpdateProgress {
                            downloaded: total_dl,
                            total: content_length,
                            percent,
                        },
                    )
                    .ok();
            },
            || {},
        )
        .await
        .map_err(|e| format!("Update download failed: {}", e))?;

    #[cfg(windows)]
    {
        run_installer(&bytes, &update.version).await?;
        // The installer takes it from here, and opens the new version when it's done
        app.exit(0);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        // macOS: the signed .app.tar.gz replaces the app in place (asking for an administrator
        // password if its folder needs one), then the new version starts
        update
            .install(bytes)
            .map_err(|e| format!("Update installation failed: {}", e))?;
        app.restart();
    }
}

/// Saves the (already verified) NSIS installer and starts it the way the updater plugin
/// would (`/P` passive, `/R` restart the launcher after, `/UPDATE`), but checks that it
/// actually started, and gives Smart App Control a few seconds to finish its lookup
/// before trying again.
#[cfg(windows)]
async fn run_installer(bytes: &[u8], version: &str) -> Result<(), String> {
    // We only publish NSIS installers (see README), which are plain Windows programs
    if !bytes.starts_with(b"MZ") {
        return Err("The downloaded update isn't a Windows installer.".into());
    }
    let dir = std::env::temp_dir().join(format!("BSCraft Launcher-{}-update", version));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't save the update: {}", e))?;
    let path = dir.join(format!("BSCraft Launcher-{}-setup.exe", version));
    std::fs::write(&path, bytes).map_err(|e| format!("Couldn't save the update: {}", e))?;

    /// Windows refused to run it: Smart App Control / an app control policy
    const BLOCKED_BY_POLICY: [i32; 2] = [4551, 1260];
    /// It wants to run as administrator, which only the shell can ask for
    const NEEDS_ELEVATION: i32 = 740;

    let mut blocked = false;
    for attempt in 0..4 {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_secs(4)).await;
        }
        match std::process::Command::new(&path).args(["/P", "/R", "/UPDATE"]).spawn() {
            Ok(_) => return Ok(()),
            Err(e) if e.raw_os_error() == Some(NEEDS_ELEVATION) => {
                // Let the shell show the admin prompt
                return crate::commands::install::hidden_command(std::path::Path::new("cmd"))
                    .args(["/C", "start", "\"\""])
                    .arg(&path)
                    .args(["/P", "/R", "/UPDATE"])
                    .spawn()
                    .map(|_| ())
                    .map_err(|e| format!("Couldn't start the update installer: {}", e));
            }
            Err(e) if e.raw_os_error().is_some_and(|c| BLOCKED_BY_POLICY.contains(&c)) => {
                blocked = true;
                eprintln!("update installer blocked by Windows (attempt {}): {}", attempt + 1, e);
            }
            Err(e) => return Err(format!("Couldn't start the update installer: {}", e)),
        }
    }
    if blocked {
        Err("Windows blocked the update installer. This happens on PCs with Smart App Control              while a new version is still unknown to it. Wait a minute and press Update again."
            .into())
    } else {
        Err("Couldn't start the update installer.".into())
    }
}
