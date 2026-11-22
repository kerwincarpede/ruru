use serde::Serialize;
use tauri::Manager;

mod frigate;
mod menu;
mod settings;
mod update;
mod webview;

/// The app's name and version, for the window footer.
///
/// Mirrored by `AppInfo` in `src/app/api.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

/// Ruru's name and the version this binary was built as, so the page shows
/// the version that is actually running. Not `pub`: a public command at the
/// crate root clashes with the macros `#[tauri::command]` exports (E0255).
#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "Ruru".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    }
}

/// Starts the app. Kept thin: each feature lives in its own module and only
/// its commands are registered here.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let full_screen = settings::manage(app);
            menu::install(app)?;
            if let Some(window) = app.get_webview_window("main") {
                webview::enable_webrtc(&window)?;
                settings::track_full_screen(&window);
                if full_screen {
                    window.set_fullscreen(true)?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            update::fake_update,
            settings::get_settings,
            settings::save_frigate_url,
            settings::set_full_screen,
            settings::save_layout,
            settings::save_wall_options,
            frigate::test_frigate,
            frigate::frigate_cameras,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ruru");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_names_ruru_and_its_crate_version() {
        let info = app_info();
        assert_eq!(info.name, "Ruru");
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn app_info_serialises_as_the_page_expects() {
        let json = serde_json::to_value(app_info()).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "name": "Ruru", "version": env!("CARGO_PKG_VERSION") })
        );
    }
}
