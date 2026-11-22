//! The macOS app menu's **Settings…** item. Other platforms have no menu
//! bar: there the page opens Settings from its toolbar, right-click menu and
//! `Ctrl+,`.

/// The event the main window gets when the user picks **Settings…**.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const OPEN_SETTINGS_EVENT: &str = "open-settings";

/// The menu item's id.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const SETTINGS_ITEM: &str = "settings";

/// Whether a menu event is the **Settings…** item.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn is_settings(id: &str) -> bool {
    id == SETTINGS_ITEM
}

/// Adds **Settings…** (`⌘ ,`) to the app menu, under **About Ruru**, and
/// tells the main window when it is picked.
#[cfg(target_os = "macos")]
pub fn install(app: &tauri::App) -> tauri::Result<()> {
    use tauri::{
        Emitter,
        menu::{IsMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem},
    };

    let handle = app.handle();
    let menu = Menu::default(handle)?;
    let settings = MenuItem::with_id(
        handle,
        SETTINGS_ITEM,
        "Settings…",
        true,
        Some("CmdOrCtrl+,"),
    )?;
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        let separator = PredefinedMenuItem::separator(handle)?;
        // Position 0 is About Ruru.
        let items: [&dyn IsMenuItem<_>; 2] = [&separator, &settings];
        app_menu.insert_items(&items, 1)?;
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if is_settings(event.id().as_ref()) {
            let _ = app.emit_to("main", OPEN_SETTINGS_EVENT, ());
        }
    });
    Ok(())
}

/// No menu bar to change outside macOS.
#[cfg(not(target_os = "macos"))]
pub fn install(_app: &tauri::App) -> tauri::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_settings_item_opens_settings() {
        assert!(is_settings("settings"));
        assert!(!is_settings("quit"));
        assert_eq!(OPEN_SETTINGS_EVENT, "open-settings");
    }
}
