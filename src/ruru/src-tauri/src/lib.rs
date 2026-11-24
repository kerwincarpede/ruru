use serde::Serialize;
use tauri::Manager;

mod display;
mod frigate;
/// Entry points for the packaged host controls.
pub mod host_controls;
mod instance;
mod menu;
mod mqtt;
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
fn app_info(app: tauri::AppHandle) -> AppInfo {
    AppInfo {
        name: "Ruru".into(),
        version: app_version(app.package_info()),
    }
}

/// The version this build is: `tauri.conf.json`'s, which a release stamps
/// and the updater compares. `Cargo.toml`'s stays at its placeholder.
pub fn app_version(package: &tauri::PackageInfo) -> String {
    package.version.to_string()
}

/// Starts the app. Kept thin: each feature lives in its own module and only
/// its commands are registered here.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(instance::plugin())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(update::PendingUpdate::default())
        .setup(|app| {
            let full_screen = settings::manage(app);
            mqtt::manage(app);
            app.manage(update::start_auto_updates(app.handle().clone()));
            menu::install(app)?;
            if let Some(window) = app.get_webview_window("main") {
                webview::enable_webrtc(&window)?;
                settings::track_full_screen(&window);
                if full_screen {
                    window.set_fullscreen(true)?;
                }
            }
            host_controls::app_ready()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            update::fake_update,
            update::check_update,
            update::install_update,
            update::set_auto_update,
            settings::get_settings,
            settings::save_frigate_url,
            settings::set_full_screen,
            settings::save_layout,
            settings::save_wall_options,
            settings::set_update_channel,
            frigate::test_frigate,
            frigate::frigate_cameras,
            host_controls::host_controls_status,
            host_controls::test_host_controls,
            host_controls::enable_host_controls,
            host_controls::disable_host_controls,
            host_controls::set_host_reboot,
            host_controls::authorise_host_reboot,
            mqtt::test_mqtt,
            mqtt::save_mqtt,
            mqtt::report_wall_state,
            mqtt::report_tile_problem,
            mqtt::camera_activity,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ruru");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn package(version: &str) -> tauri::PackageInfo {
        tauri::PackageInfo {
            name: "Ruru".into(),
            version: version.parse().unwrap(),
            authors: "",
            description: "",
            crate_name: "ruru",
        }
    }

    #[test]
    fn the_version_is_the_one_a_release_stamps_not_the_crate_s() {
        assert_eq!(app_version(&package("0.7.3")), "0.7.3");
        assert_eq!(app_version(&package("1.0.0-rc.1")), "1.0.0-rc.1");
    }

    #[test]
    fn app_info_serialises_as_the_page_expects() {
        let info = AppInfo {
            name: "Ruru".into(),
            version: app_version(&package("0.7.3")),
        };
        assert_eq!(
            serde_json::to_value(info).unwrap(),
            serde_json::json!({ "name": "Ruru", "version": "0.7.3" })
        );
    }
}
