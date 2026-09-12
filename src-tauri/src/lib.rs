// ============================================================
// lib.rs — Tauri application entry point
// Registers all plugins, shared state, and Tauri commands.
// ============================================================

mod commands;
mod constants;
mod state;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // ── Plugins ──────────────────────────────────────────
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // ── Shared state ─────────────────────────────────────
        .manage(state::AppState::new())
        // ── Window close guard ───────────────────────────────
        // If Minecraft is running, intercept the close request and ask
        // the user to confirm rather than silently killing the game.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<state::AppState>();
                let is_running = state.game_process.lock().unwrap().is_some();
                if is_running {
                    api.prevent_close();
                    window.emit("close-game-warning", ()).ok();
                }
            }
        })
        // ── Commands ─────────────────────────────────────────
        .invoke_handler(tauri::generate_handler![
            // Settings
            commands::settings::get_config,
            commands::settings::save_config,
            commands::settings::get_system_ram,
            commands::settings::get_gpus,
            commands::settings::write_error_report,
            // Launcher self-update
            commands::update::check_launcher_update,
            commands::update::apply_launcher_update,
            // Installation
            commands::install::get_install_status,
            commands::install::install_jre,
            commands::install::install_minecraft,
            commands::install::install_forge,
            // Modpack management
            commands::modpack::fetch_manifest,
            commands::modpack::sync_modpack,
            commands::modpack::verify_files,
            commands::modpack::repair_files,
            commands::modpack::verify_all,
            commands::modpack::apply_performance_mode,
            // Server account (SimpleLogin) and skins
            commands::account::get_account_status,
            commands::account::set_game_password,
            commands::account::reveal_game_password,
            commands::account::check_server_account,
            commands::account::upload_skin,
            commands::account::reset_skin,
            // Game control
            commands::launcher::launch_game,
            commands::launcher::kill_game,
            commands::launcher::get_game_status,
            commands::launcher::get_log_lines,
            commands::launcher::exit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running BSCraft Launcher");
}

