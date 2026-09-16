// ============================================================
// fit.rs — Keep the whole UI on screen at any display scaling
// ============================================================
//! The launcher's UI is laid out for a 960×580 window. Some screens can't hold that: a 720p
//! screen at 125% scaling has about 1024×530 to spare, so the bottom (the Play button) ends
//! up under the taskbar. And after a move between monitors with different scaling, the page
//! can be drawn bigger than its window. So the window takes the size the screen allows and
//! the page is zoomed to match: the same layout, just smaller, with text still sharp.

use std::sync::Mutex;
use tauri::{LogicalSize, Runtime, WebviewWindow};

/// The size the UI is laid out for, in CSS pixels
pub const DESIGN_WIDTH: f64 = 960.0;
pub const DESIGN_HEIGHT: f64 = 580.0;
/// How much of the screen's free area the window may take
const SCREEN_SHARE: f64 = 0.94;

/// The page zoom last set (1.0 = the design size)
static ZOOM: Mutex<f64> = Mutex::new(1.0);

/// Sizes the window and zooms the page for the monitor it's on. `center` puts it in the
/// middle: at startup, not when the player has moved it to another monitor.
pub fn fit_to_screen<R: Runtime>(window: &WebviewWindow<R>, center: bool) {
    let Ok(Some(monitor)) = window.current_monitor() else { return };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let zoom = zoom_for(area.size.width as f64 / scale, area.size.height as f64 / scale);
    window
        .set_size(LogicalSize::new((DESIGN_WIDTH * zoom).round(), (DESIGN_HEIGHT * zoom).round()))
        .ok();
    window.set_zoom(zoom).ok();
    *ZOOM.lock().unwrap() = zoom;
    if center {
        window.center().ok();
    }
}

/// The zoom that fits the UI into a free screen area of this many logical pixels: 1.0 when
/// it fits as designed, less on smaller screens
pub fn zoom_for(free_width: f64, free_height: f64) -> f64 {
    let fit = (free_width * SCREEN_SHARE / DESIGN_WIDTH).min(free_height * SCREEN_SHARE / DESIGN_HEIGHT);
    // Whole percents, so a pixel's difference doesn't resize the window
    ((fit.min(1.0) * 100.0).floor() / 100.0).max(0.5)
}

/// The page measured itself at `ratio` times the size its window leaves room for (the
/// webview picked up a scaling change late): zoom it by that much. The window keeps its size.
#[tauri::command]
pub fn fit_ui<R: Runtime>(window: WebviewWindow<R>, ratio: f64) {
    if !ratio.is_finite() || ratio <= 0.0 {
        return;
    }
    let mut zoom = ZOOM.lock().unwrap();
    *zoom = (*zoom * ratio).clamp(0.3, 2.0);
    window.set_zoom(*zoom).ok();
}

#[cfg(test)]
mod tests {
    use super::zoom_for;

    #[test]
    fn fits_the_ui_to_the_screen() {
        // Free area (screen minus taskbar) in logical pixels -> zoom
        assert_eq!(zoom_for(1536.0, 816.0), 1.0); // 1080p at 125%
        assert_eq!(zoom_for(1280.0, 672.0), 1.0); // 1080p at 150%
        assert_eq!(zoom_for(1920.0, 1032.0), 1.0); // 1080p at 100%
        assert_eq!(zoom_for(1024.0, 538.0), 0.87); // 720p at 125%: the Play button was under the taskbar
        assert_eq!(zoom_for(1366.0, 728.0), 1.0); // 768p at 100%
        assert_eq!(zoom_for(1097.0, 548.0), 0.88); // 768p at 125%
        assert_eq!(zoom_for(400.0, 300.0), 0.5); // never smaller than half
    }
}
