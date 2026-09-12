// ============================================================
// state.rs — Shared application state managed by Tauri
// ============================================================

use std::sync::Mutex;

/// Holds the spawned Minecraft process child handle.
/// Stored in a Mutex so it can be accessed from both the
/// launch command (write) and kill command (write).
pub struct AppState {
    /// The running Minecraft process, or None if not running.
    pub game_process: Mutex<Option<tokio::process::Child>>,

    /// Ring buffer of log lines captured from Minecraft stdout/stderr.
    /// Capped at 5000 lines to avoid unbounded memory growth.
    pub log_lines: Mutex<Vec<String>>,

    /// Prevents multiple concurrent install/download operations.
    #[allow(dead_code)]
    pub operation_in_progress: Mutex<bool>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            game_process: Mutex::new(None),
            log_lines: Mutex::new(Vec::with_capacity(512)),
            operation_in_progress: Mutex::new(false),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
