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
        Ok(None) => Ok(UpdateCheckResult {
            has_update: false,
            current_version: current.clone(),
            latest_version: current,
            notes: None,
        }),
        Err(e) => Err(format!("Update check failed: {}", e)),
    }
}

/// Downloads and installs the new launcher version, emitting progress events.
/// After installation completes, restarts the application automatically.
///
/// Emits: `launcher-update-progress` → UpdateProgress
///
/// IMPORTANT: This command does not return on success — the app restarts.
#[tauri::command]
pub async fn apply_launcher_update(app: tauri::AppHandle) -> Result<(), String> {
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

    update
        .download_and_install(
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
            || {
                // on_install callback — nothing extra needed, restart handles it
            },
        )
        .await
        .map_err(|e| format!("Update installation failed: {}", e))?;

    // Restart the launcher into the newly installed version
    app.restart();
}
