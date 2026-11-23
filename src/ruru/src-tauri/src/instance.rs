//! One copy of Ruru at a time. Opening Ruru while it is already running,
//! such as while an update installs, brings the running copy to the front
//! instead of starting another. Two copies would share one Home Assistant
//! device: the broker allows one connection per client id, so each would
//! keep pushing the other off and Home Assistant's entities would flip
//! between them.
//!
//! The lock is freed as Ruru exits or restarts, so an update's restart
//! starts the new version normally.

use tauri::{AppHandle, Manager, Runtime, plugin::TauriPlugin};

/// The window brought back when Ruru is opened again.
const MAIN_WINDOW: &str = "main";

/// The plugin that stops a second copy. It must be the first plugin
/// registered, so a second copy exits before anything else starts.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_single_instance::init(|app, _args, _cwd| show_running(app))
}

/// Brings the running copy's window to the front: shown, restored and
/// focused.
fn show_running<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let shown = window
        .show()
        .and_then(|()| window.unminimize())
        .and_then(|()| window.set_focus());
    if let Err(err) = shown {
        eprintln!("Ruru: could not bring the running copy to the front: {err}");
    }
}
