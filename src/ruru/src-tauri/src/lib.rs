use serde::Serialize;

mod update;

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
        .invoke_handler(tauri::generate_handler![app_info, update::fake_update])
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
