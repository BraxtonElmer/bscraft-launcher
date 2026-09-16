// ============================================================
// lib.rs — Tauri application entry point
// Registers all plugins, shared state, and Tauri commands.
// ============================================================

mod commands;
mod constants;
mod fit;
mod platform;
mod servers_dat;
mod state;

use tauri::{Emitter, Manager};

/// The macOS menu's Quit item (see `mac_menu`)
#[cfg(target_os = "macos")]
const QUIT_MENU_ID: &str = "quit";

/// macOS's standard app menu, except that Quit (⌘Q) closes the window the way its close
/// button does, so the launcher still warns while Minecraft is running. The system's own
/// Quit ends the app on the spot, without a close request to intercept.
#[cfg(target_os = "macos")]
fn mac_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};

    let info = app.package_info();
    let about = AboutMetadata {
        name: Some(info.name.clone()),
        version: Some(info.version.to_string()),
        ..Default::default()
    };
    let app_menu = Submenu::with_items(
        app,
        &info.name,
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, QUIT_MENU_ID, format!("Quit {}", info.name), true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;
    // Text fields only get copy, paste and undo shortcuts through these
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::close_window(app, None)?],
    )?;
    Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(target_os = "macos")]
    let builder = builder.menu(mac_menu).on_menu_event(|app, event| {
        if event.id() == QUIT_MENU_ID {
            match app.get_webview_window("main") {
                Some(window) => {
                    window.close().ok();
                }
                None => app.exit(0),
            }
        }
    });

    builder
        // ── Plugins ──────────────────────────────────────────
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // ── Shared state ─────────────────────────────────────
        .manage(state::AppState::new())
        // ── Window size and placement ────────────────────────
        // Sized to fit the screen (fit.rs). On macOS it's centred here rather than with
        // `center` in the config, which leaves the window a pixel taller than 580 there;
        // it starts hidden so it doesn't jump into place.
        .setup(|app| {
            #[cfg(not(target_os = "macos"))]
            if let Some(window) = app.get_webview_window("main") {
                fit::fit_to_screen(&window, true);
            }
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                fit::fit_to_screen(&window, false);
                if let Ok(ns_window) = window.ns_window() {
                    // SAFETY: setup runs on the main thread, and the pointer is this live window's NSWindow
                    let ns_window = unsafe { &*(ns_window as *const objc2_app_kit::NSWindow) };
                    ns_window.center();
                }
                window.show().ok();
            }
            Ok(())
        })
        // ── Window close guard ───────────────────────────────
        // If Minecraft is running, intercept the close request and ask
        // the user to confirm rather than silently killing the game.
        .on_window_event(|window, event| {
            // Moved to a monitor with other scaling: fit that screen
            if let tauri::WindowEvent::ScaleFactorChanged { .. } = event {
                if let Some(webview) = window.get_webview_window(window.label()) {
                    fit::fit_to_screen(&webview, false);
                }
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<state::AppState>();
                let is_running = state.game_process.lock().unwrap().is_some();
                if is_running {
                    api.prevent_close();
                    // Bring the launcher up so the warning is seen (⌘Q or the taskbar can close it minimized)
                    window.unminimize().ok();
                    window.set_focus().ok();
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
            commands::settings::get_memory_plan,
            commands::storage::storage_usage,
            commands::storage::clear_caches,
            commands::storage::open_data_folder,
            commands::storage::uninstall_bscraft,
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
            commands::account::upload_texture,
            commands::account::remove_texture,
            commands::account::import_look,
            commands::account::get_skin_prefs,
            commands::account::set_skin_prefs,
            commands::server::server_status,
            // Game control
            commands::launcher::launch_game,
            commands::launcher::kill_game,
            commands::launcher::get_game_status,
            commands::launcher::get_log_lines,
            commands::launcher::exit_app,
            // Window size and zoom
            fit::fit_ui,
        ])
        .run(tauri::generate_context!())
        .expect("error while running BSCraft Launcher");
}

