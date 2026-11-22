//! Ruru's settings, stored as `settings.json` in the app config folder: the
//! Frigate URL, whether the window is full screen, and one wall layout per
//! Frigate server.
//!
//! Missing keys fall back to their defaults and unknown keys are ignored, so
//! settings files from other versions still load.

use std::{
    collections::BTreeMap,
    fmt, fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State, WebviewWindow};

/// The settings file's name inside the app config folder.
pub const SETTINGS_FILE: &str = "settings.json";

/// The most tiles a saved layout may hold.
pub const MAX_TILES: usize = 256;
/// The widest or tallest a tile may be, in grid units.
pub const MAX_TILE_SPAN: u32 = 48;
/// The furthest a tile may sit from the grid's origin, in grid units.
pub const MAX_TILE_OFFSET: u32 = 10_000;
/// The longest camera name a layout may name.
const MAX_CAMERA_NAME: usize = 200;

/// A feed selected explicitly instead of the wall and maximised defaults.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StreamChoice {
    Main,
    Sub,
}

/// One tile's place on the wall, in grid units.
///
/// Mirrored by `TilePlacement` in `src/app/api.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TilePlacement {
    pub camera: String,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream: Option<StreamChoice>,
}

/// The wall layout saved for one Frigate server: where each tile sits and
/// which cameras the user hid.
///
/// Mirrored by `SavedLayout` in `src/app/api.ts`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SavedLayout {
    pub tiles: Vec<TilePlacement>,
    pub hidden: Vec<String>,
}

/// Everything Ruru remembers between launches.
///
/// Mirrored by `Settings` in `src/app/api.ts`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// The Frigate server's address, normalised by [`normalise_frigate_url`].
    /// None until the user saves one.
    pub frigate_url: Option<String>,
    /// The window was full screen when Ruru last changed it.
    pub full_screen: bool,
    /// Layouts by normalised Frigate URL.
    pub layouts: BTreeMap<String, SavedLayout>,
}

/// Why settings could not be read, written or changed.
#[derive(Debug)]
pub enum SettingsError {
    Io(io::Error),
    Parse(serde_json::Error),
    Invalid(String),
}

impl fmt::Display for SettingsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(err) => write!(f, "The settings could not be saved: {err}"),
            Self::Parse(err) => write!(f, "The settings file is not valid: {err}"),
            Self::Invalid(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for SettingsError {}

impl From<io::Error> for SettingsError {
    fn from(err: io::Error) -> Self {
        Self::Io(err)
    }
}

impl From<serde_json::Error> for SettingsError {
    fn from(err: serde_json::Error) -> Self {
        Self::Parse(err)
    }
}

/// A Frigate URL as typed, made into the one form Ruru stores and requests
/// from: trimmed, `http` or `https` with a host, without a query, fragment
/// or trailing slash. The same server always gets the same layout key.
pub fn normalise_frigate_url(input: &str) -> Result<String, SettingsError> {
    let invalid =
        || SettingsError::Invalid("Enter a Frigate URL starting with http:// or https://.".into());
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(invalid());
    }
    let mut url = url::Url::parse(trimmed).map_err(|_| invalid())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none_or(str::is_empty) {
        return Err(invalid());
    }
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.as_str().trim_end_matches('/').to_string())
}

/// Checks a layout sent by the page before it is saved.
pub fn validate_layout(layout: &SavedLayout) -> Result<(), SettingsError> {
    if layout.tiles.len() > MAX_TILES || layout.hidden.len() > MAX_TILES {
        return Err(SettingsError::Invalid(format!(
            "A layout can hold at most {MAX_TILES} cameras."
        )));
    }
    let bad_name = |name: &str| name.trim().is_empty() || name.len() > MAX_CAMERA_NAME;
    if layout.hidden.iter().any(|name| bad_name(name)) {
        return Err(SettingsError::Invalid(
            "The layout names a camera that is not valid.".into(),
        ));
    }
    for tile in &layout.tiles {
        if bad_name(&tile.camera) {
            return Err(SettingsError::Invalid(
                "The layout names a camera that is not valid.".into(),
            ));
        }
        let span = 1..=MAX_TILE_SPAN;
        if !span.contains(&tile.w)
            || !span.contains(&tile.h)
            || tile.x > MAX_TILE_OFFSET
            || tile.y > MAX_TILE_OFFSET
        {
            return Err(SettingsError::Invalid(format!(
                "The tile for {} is outside the wall.",
                tile.camera
            )));
        }
    }
    Ok(())
}

/// Reads settings from `path`. A missing file gives the defaults.
pub fn load(path: &Path) -> Result<Settings, SettingsError> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Settings::default()),
        Err(err) => return Err(err.into()),
    };
    Ok(serde_json::from_str(&text)?)
}

/// Writes settings to `path`, creating its folder. The file is replaced in
/// one step, so a crash never leaves it half written.
pub fn save(path: &Path, settings: &Settings) -> Result<(), SettingsError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut json = serde_json::to_string_pretty(settings)?;
    json.push('\n');
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

/// The current settings and the file they live in. Without a file (no config
/// folder could be found) changes last until Ruru quits.
#[derive(Debug, Default)]
pub struct SettingsStore {
    path: Option<PathBuf>,
    current: Settings,
}

impl SettingsStore {
    /// Loads settings from `path`. An unreadable file is reported and the
    /// defaults are used; the file is only overwritten on the next change.
    pub fn open(path: Option<PathBuf>) -> Self {
        let current = match &path {
            Some(path) => load(path).unwrap_or_else(|err| {
                eprintln!(
                    "Ruru: using default settings, could not read {}: {err}",
                    path.display()
                );
                Settings::default()
            }),
            None => Settings::default(),
        };
        Self { path, current }
    }

    /// The settings as they are now.
    pub fn current(&self) -> &Settings {
        &self.current
    }

    /// Applies `change` and saves the result. A failed save keeps the old
    /// settings, so memory and the file never disagree.
    fn update(&mut self, change: impl FnOnce(&mut Settings)) -> Result<&Settings, SettingsError> {
        let mut next = self.current.clone();
        change(&mut next);
        if let Some(path) = &self.path {
            save(path, &next)?;
        }
        self.current = next;
        Ok(&self.current)
    }

    /// Saves the Frigate URL, normalised.
    pub fn set_frigate_url(&mut self, input: &str) -> Result<&Settings, SettingsError> {
        let url = normalise_frigate_url(input)?;
        self.update(|settings| settings.frigate_url = Some(url))
    }

    /// Saves whether the window is full screen.
    pub fn set_full_screen(&mut self, full_screen: bool) -> Result<&Settings, SettingsError> {
        self.update(|settings| settings.full_screen = full_screen)
    }

    /// Records the window's real full-screen state, which also changes
    /// outside Ruru's own toggle (the macOS green button, View > Enter Full
    /// Screen). Returns whether it differed from what was saved.
    pub fn follow_full_screen(&mut self, full_screen: bool) -> Result<bool, SettingsError> {
        if self.current.full_screen == full_screen {
            return Ok(false);
        }
        self.set_full_screen(full_screen)?;
        Ok(true)
    }

    /// Saves the layout for the Frigate server at `server`.
    pub fn set_layout(
        &mut self,
        server: &str,
        layout: SavedLayout,
    ) -> Result<&Settings, SettingsError> {
        let server = normalise_frigate_url(server)?;
        validate_layout(&layout)?;
        self.update(|settings| {
            settings.layouts.insert(server, layout);
        })
    }
}

/// The store as the app manages it.
pub type SharedSettings = Mutex<SettingsStore>;

/// Opens `settings.json` in the app config folder and hands the store to the
/// app, returning whether the window should start full screen.
pub fn manage(app: &tauri::App) -> bool {
    let path = app
        .path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(SETTINGS_FILE));
    let store = SettingsStore::open(path);
    let full_screen = store.current().full_screen;
    app.manage(Mutex::new(store));
    full_screen
}

/// The event the page hears, with the new state, when the window enters or
/// leaves full screen.
pub const FULL_SCREEN_EVENT: &str = "full-screen-changed";

/// Keeps the saved full-screen setting, and the page, in step with the
/// window however full screen changes. The window resizes on every change.
pub fn track_full_screen(window: &WebviewWindow) {
    let tracked = window.clone();
    window.on_window_event(move |event| {
        if !matches!(event, tauri::WindowEvent::Resized(_)) {
            return;
        }
        let Ok(full_screen) = tracked.is_fullscreen() else {
            return;
        };
        let state = tracked.state::<SharedSettings>();
        let changed = lock(&state).follow_full_screen(full_screen);
        if let Ok(true) = changed {
            let _ = tracked.emit(FULL_SCREEN_EVENT, full_screen);
        }
    });
}

fn lock(state: &SharedSettings) -> std::sync::MutexGuard<'_, SettingsStore> {
    // A panic while holding the lock leaves the settings as they were.
    state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The saved settings.
#[tauri::command]
pub fn get_settings(state: State<'_, SharedSettings>) -> Settings {
    lock(&state).current().clone()
}

/// Saves the Frigate URL the user entered and returns the settings with it.
#[tauri::command]
pub async fn save_frigate_url(
    state: State<'_, SharedSettings>,
    url: String,
) -> Result<Settings, String> {
    lock(&state)
        .set_frigate_url(&url)
        .cloned()
        .map_err(|err| err.to_string())
}

/// Makes the window full screen, or not, and remembers it for next launch.
#[tauri::command]
pub async fn set_full_screen(
    window: WebviewWindow,
    state: State<'_, SharedSettings>,
    full_screen: bool,
) -> Result<(), String> {
    window
        .set_fullscreen(full_screen)
        .map_err(|err| format!("Full screen could not be changed: {err}"))?;
    lock(&state)
        .set_full_screen(full_screen)
        .map(|_| ())
        .map_err(|err| err.to_string())
}

/// Saves the wall layout for the Frigate server at `server`.
#[tauri::command]
pub async fn save_layout(
    state: State<'_, SharedSettings>,
    server: String,
    layout: SavedLayout,
) -> Result<(), String> {
    lock(&state)
        .set_layout(&server, layout)
        .map(|_| ())
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh folder for one test, removed when it is dropped.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            // Only path-safe characters: Windows refuses ':' and braces.
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let dir = std::env::temp_dir().join(format!(
                "ruru-settings-{name}-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn file(&self) -> PathBuf {
            self.0.join("config").join(SETTINGS_FILE)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn tile(camera: &str, x: u32, y: u32, w: u32, h: u32) -> TilePlacement {
        TilePlacement {
            camera: camera.into(),
            x,
            y,
            w,
            h,
            stream: None,
        }
    }

    #[test]
    fn following_full_screen_saves_only_a_change() {
        let mut store = SettingsStore::open(None);
        assert!(!store.follow_full_screen(false).unwrap());
        assert!(store.follow_full_screen(true).unwrap());
        assert!(store.current().full_screen);
        assert!(!store.follow_full_screen(true).unwrap());
        assert!(store.follow_full_screen(false).unwrap());
        assert!(!store.current().full_screen);
    }

    #[test]
    fn urls_are_normalised_to_one_form() {
        for (input, expected) in [
            (
                "  https://frigate.example.net/  ",
                "https://frigate.example.net",
            ),
            ("http://10.0.0.5:5000", "http://10.0.0.5:5000"),
            ("HTTP://Frigate.Local:5000//", "http://frigate.local:5000"),
            ("https://host/frigate/?a=1#top", "https://host/frigate"),
        ] {
            assert_eq!(normalise_frigate_url(input).unwrap(), expected, "{input}");
        }
    }

    #[test]
    fn urls_without_http_or_a_host_are_refused() {
        for input in [
            "",
            "   ",
            "frigate.local",
            "ftp://host",
            "file:///etc",
            "http://",
        ] {
            let err = normalise_frigate_url(input).unwrap_err();
            assert_eq!(
                err.to_string(),
                "Enter a Frigate URL starting with http:// or https://.",
                "{input}"
            );
        }
    }

    #[test]
    fn a_missing_file_gives_the_defaults() {
        let dir = TempDir::new("missing");
        assert_eq!(load(&dir.file()).unwrap(), Settings::default());
    }

    #[test]
    fn missing_keys_default_and_unknown_keys_are_ignored() {
        let dir = TempDir::new("lenient");
        fs::create_dir_all(dir.file().parent().unwrap()).unwrap();
        fs::write(
            dir.file(),
            r#"{"frigateUrl": "http://a", "somethingNew": 1, "layouts": {"http://a": {"hidden": ["x"]}}}"#,
        )
        .unwrap();
        let settings = load(&dir.file()).unwrap();
        assert_eq!(settings.frigate_url.as_deref(), Some("http://a"));
        assert!(!settings.full_screen);
        assert_eq!(settings.layouts["http://a"].hidden, vec!["x".to_string()]);
        assert!(settings.layouts["http://a"].tiles.is_empty());
    }

    #[test]
    fn a_broken_file_opens_with_defaults_and_is_replaced_on_the_next_change() {
        let dir = TempDir::new("broken");
        fs::create_dir_all(dir.file().parent().unwrap()).unwrap();
        fs::write(dir.file(), "{ not json").unwrap();
        assert!(matches!(load(&dir.file()), Err(SettingsError::Parse(_))));
        let mut store = SettingsStore::open(Some(dir.file()));
        assert_eq!(store.current(), &Settings::default());
        store.set_full_screen(true).unwrap();
        assert!(load(&dir.file()).unwrap().full_screen);
    }

    #[test]
    fn changes_are_saved_and_load_again() {
        let dir = TempDir::new("round-trip");
        let mut store = SettingsStore::open(Some(dir.file()));
        store
            .set_frigate_url(" https://frigate.example.net/ ")
            .unwrap();
        store.set_full_screen(true).unwrap();
        let layout = SavedLayout {
            tiles: vec![tile("front", 0, 0, 4, 3), tile("back", 4, 0, 2, 2)],
            hidden: vec!["garage".into()],
        };
        store
            .set_layout("https://frigate.example.net/", layout.clone())
            .unwrap();

        let reopened = SettingsStore::open(Some(dir.file()));
        let settings = reopened.current();
        assert_eq!(
            settings.frigate_url.as_deref(),
            Some("https://frigate.example.net")
        );
        assert!(settings.full_screen);
        assert_eq!(settings.layouts["https://frigate.example.net"], layout);
        assert!(!dir.file().with_extension("json.tmp").exists());
    }

    #[test]
    fn settings_serialise_as_the_page_expects() {
        let mut settings = Settings {
            frigate_url: Some("http://a".into()),
            full_screen: true,
            layouts: BTreeMap::new(),
        };
        settings.layouts.insert(
            "http://a".into(),
            SavedLayout {
                tiles: vec![tile("cam", 1, 2, 3, 4)],
                hidden: vec![],
            },
        );
        assert_eq!(
            serde_json::to_value(&settings).unwrap(),
            serde_json::json!({
                "frigateUrl": "http://a",
                "fullScreen": true,
                "layouts": {"http://a": {"tiles": [{"camera": "cam", "x": 1, "y": 2, "w": 3, "h": 4}], "hidden": []}}
            })
        );
    }

    #[test]
    fn an_invalid_url_or_layout_changes_nothing() {
        let dir = TempDir::new("invalid");
        let mut store = SettingsStore::open(Some(dir.file()));
        assert!(store.set_frigate_url("nope").is_err());
        assert!(
            store
                .set_layout("nope", SavedLayout::default())
                .unwrap_err()
                .to_string()
                .contains("http://")
        );
        let too_wide = SavedLayout {
            tiles: vec![tile("cam", 0, 0, MAX_TILE_SPAN + 1, 1)],
            hidden: vec![],
        };
        assert_eq!(
            store
                .set_layout("http://a", too_wide)
                .unwrap_err()
                .to_string(),
            "The tile for cam is outside the wall."
        );
        assert!(!dir.file().exists());
        assert_eq!(store.current(), &Settings::default());
    }

    #[test]
    fn layouts_are_checked() {
        let ok = SavedLayout {
            tiles: vec![tile("cam", 0, 0, 1, 1)],
            hidden: vec!["other".into()],
        };
        assert!(validate_layout(&ok).is_ok());

        let zero = SavedLayout {
            tiles: vec![tile("cam", 0, 0, 0, 1)],
            hidden: vec![],
        };
        assert!(validate_layout(&zero).is_err());

        let far = SavedLayout {
            tiles: vec![tile("cam", MAX_TILE_OFFSET + 1, 0, 1, 1)],
            hidden: vec![],
        };
        assert!(validate_layout(&far).is_err());

        let unnamed = SavedLayout {
            tiles: vec![tile(" ", 0, 0, 1, 1)],
            hidden: vec![],
        };
        assert!(validate_layout(&unnamed).is_err());

        let hidden_unnamed = SavedLayout {
            tiles: vec![],
            hidden: vec![String::new()],
        };
        assert!(validate_layout(&hidden_unnamed).is_err());

        let crowded = SavedLayout {
            tiles: (0..=MAX_TILES as u32)
                .map(|i| tile(&format!("c{i}"), 0, i, 1, 1))
                .collect(),
            hidden: vec![],
        };
        assert!(
            validate_layout(&crowded)
                .unwrap_err()
                .to_string()
                .contains("at most")
        );
    }

    #[test]
    fn a_store_without_a_file_keeps_changes_in_memory() {
        let mut store = SettingsStore::open(None);
        store.set_full_screen(true).unwrap();
        assert!(store.current().full_screen);
    }

    #[test]
    fn a_failed_save_keeps_the_old_settings() {
        let dir = TempDir::new("unwritable");
        // A folder where the file should be makes the rename fail.
        fs::create_dir_all(dir.file()).unwrap();
        let mut store = SettingsStore {
            path: Some(dir.file()),
            current: Settings::default(),
        };
        let err = store.set_full_screen(true).unwrap_err();
        assert!(matches!(err, SettingsError::Io(_)));
        assert!(
            err.to_string()
                .starts_with("The settings could not be saved")
        );
        assert!(!store.current().full_screen);
    }
}
