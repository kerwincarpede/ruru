//! Checking for, and installing, updates from the channel picked in
//! Settings › Updates.
//!
//! Stable reads the `latest.json` of the release GitHub marks as latest (the
//! endpoint in `plugins.updater` in tauri.conf.json). Edge asks GitHub's
//! releases API for the highest published version with a `latest.json`,
//! Stable ones included, and reads that release's manifest. Each manifest's
//! packages are signed with the key in tauri.conf.json, and the updater
//! refuses anything else. Only a newer version counts as an update, so a copy
//! moved from Edge back to Stable keeps its version until Stable passes it.
//!
//! With Install updates automatically turned on, a background thread checks
//! at startup, every [`AUTO_CHECK_INTERVAL`] and whenever the setting is
//! turned on, then installs what it finds and restarts Ruru without asking.
//!
//! A debug build run with `RURU_FAKE_UPDATE` set offers a fake update
//! instead, so the prompt and Home Assistant's update entity can be seen
//! without a newer release.

use std::{
    sync::{
        Mutex, MutexGuard,
        mpsc::{self, RecvTimeoutError},
    },
    time::Duration,
};

use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::settings::{self, Settings, SharedSettings, UpdateChannel};

/// Stable's manifest: the one on the release GitHub marks as latest.
pub const STABLE_ENDPOINT: &str =
    "https://github.com/kerwincarpede/ruru/releases/latest/download/latest.json";
/// Every release, newest first, for finding the newest Edge version.
const RELEASES_API: &str = "https://api.github.com/repos/kerwincarpede/ruru/releases";
/// Where a release's assets download from, by tag.
const RELEASE_DOWNLOADS: &str = "https://github.com/kerwincarpede/ruru/releases/download";
/// Releases asked for per page, GitHub's most.
const RELEASE_PAGE_SIZE: usize = 100;
/// The most pages read, so a runaway listing still ends.
const MAX_RELEASE_PAGES: usize = 10;
/// How long one request to GitHub may take.
const TIMEOUT: Duration = Duration::from_secs(30);

/// One release in GitHub's listing, with only what Edge needs.
#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
}

/// The highest version among published `v<version>` releases that carry a
/// `latest.json`. Drafts, other tags (such as an old rolling `edge`) and
/// pre-release versions are skipped. Listing order does not matter, so a
/// build that finishes late never moves Edge backwards.
fn edge_candidate(releases: &[GithubRelease]) -> Option<Version> {
    releases
        .iter()
        .filter(|release| {
            !release.draft
                && release
                    .assets
                    .iter()
                    .any(|asset| asset.name == "latest.json")
        })
        .filter_map(|release| release.tag_name.strip_prefix('v'))
        .filter_map(|version| Version::parse(version).ok())
        .filter(|version| version.pre.is_empty() && version.build.is_empty())
        .max()
}

/// The manifest of the release tagged `v<version>`.
fn release_manifest(version: &Version) -> String {
    format!("{RELEASE_DOWNLOADS}/v{version}/latest.json")
}

/// Edge's manifest: the newest published version's, found through GitHub's
/// releases API.
async fn edge_endpoint() -> Result<String, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        // Another thread may install it first; either provider is the same.
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent(concat!("Ruru/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|err| format!("Could not find Edge releases: {err}"))?;
    let mut newest = None;
    for page in 1..=MAX_RELEASE_PAGES {
        let response = client
            .get(format!(
                "{RELEASES_API}?per_page={RELEASE_PAGE_SIZE}&page={page}"
            ))
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|err| format!("Could not find Edge releases: {err}"))?;
        let text = response
            .text()
            .await
            .map_err(|err| format!("Could not find Edge releases: {err}"))?;
        let releases: Vec<GithubRelease> = serde_json::from_str(&text)
            .map_err(|err| format!("GitHub's list of releases was not understood: {err}"))?;
        newest = newest.max(edge_candidate(&releases));
        if releases.len() < RELEASE_PAGE_SIZE {
            break;
        }
    }
    let version = newest.ok_or("There is no Edge release yet.")?;
    Ok(release_manifest(&version))
}

/// Where `channel`'s `latest.json` is.
async fn endpoint(channel: UpdateChannel) -> Result<String, String> {
    match channel {
        UpdateChannel::Stable => Ok(STABLE_ENDPOINT.into()),
        UpdateChannel::Edge => edge_endpoint().await,
    }
}

/// The update the last check found, and the channel it came from, kept until
/// it is installed or a later check replaces it. The page's checks and Home
/// Assistant's share it.
pub struct Pending<T>(Mutex<Option<(UpdateChannel, T)>>);

impl<T> Default for Pending<T> {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

impl<T> Pending<T> {
    fn lock(&self) -> MutexGuard<'_, Option<(UpdateChannel, T)>> {
        // A panic while holding the lock leaves the update as it was.
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Keeps what a check of `channel` found, or forgets the last one.
    fn keep(&self, channel: UpdateChannel, found: Option<T>) {
        *self.lock() = found.map(|update| (channel, update));
    }

    /// Takes the update to install. Refused when there is none, or when the
    /// channel is no longer `channel`, the one saved now.
    fn take(&self, channel: UpdateChannel) -> Result<T, String> {
        let found = self.lock().take();
        let Some((checked, update)) = found else {
            return Err("There is no update to install. Check for updates again.".into());
        };
        if checked != channel {
            return Err("The update channel changed. Check for updates again.".into());
        }
        Ok(update)
    }

    /// Puts back an update whose download failed, so it can be tried again.
    fn put_back(&self, channel: UpdateChannel, update: T) {
        let mut pending = self.lock();
        if pending.is_none() {
            *pending = Some((channel, update));
        }
    }
}

/// The pending update as the app manages it.
pub type PendingUpdate = Pending<Update>;

/// The channel saved in Settings.
fn saved_channel(state: &SharedSettings) -> UpdateChannel {
    settings::lock(state).current().update_channel
}

/// Checks the saved channel for a version newer than this copy and keeps it
/// as the pending update. Returns its version, or `None` when this copy is up
/// to date.
pub async fn check(app: &AppHandle) -> Result<Option<String>, String> {
    let channel = saved_channel(&app.state::<SharedSettings>());
    let failed = |err: tauri_plugin_updater::Error| format!("Could not check for updates: {err}");
    let url = Url::parse(&endpoint(channel).await?).map_err(|err| err.to_string())?;
    let update = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(failed)?
        .build()
        .map_err(failed)?
        .check()
        .await
        .map_err(failed)?;
    let version = update.as_ref().map(|update| update.version.clone());
    app.state::<PendingUpdate>().keep(channel, update);
    Ok(version)
}

/// Takes the pending update, if the channel has not changed since it was
/// found, and downloads it, returning the channel too. The page hears how
/// far the download is, then that the update is installing. A failed
/// download keeps it pending, and the page hears why.
async fn download(
    app: &AppHandle,
    automatic: bool,
) -> Result<(UpdateChannel, Update, Vec<u8>, Announcer<'_>), String> {
    let channel = saved_channel(&app.state::<SharedSettings>());
    let pending = app.state::<PendingUpdate>();
    let update = pending.take(channel)?;
    let announcer = Announcer {
        app,
        version: update.version.clone(),
        automatic,
    };
    announcer.downloading(None);
    let mut progress = Progress::default();
    let downloaded = update
        .download(
            |chunk, total| {
                if let Some(percent) = progress.add(chunk, total) {
                    announcer.downloading(Some(percent));
                }
            },
            || {},
        )
        .await;
    match downloaded {
        Ok(bytes) => {
            announcer.installing();
            Ok((channel, update, bytes, announcer))
        }
        Err(err) => {
            pending.put_back(channel, update);
            let message = format!("The update could not be downloaded: {err}");
            announcer.failed(&message);
            Err(message)
        }
    }
}

/// How much of a download has arrived, as a whole percentage.
#[derive(Debug, Default)]
struct Progress {
    received: u64,
    percent: Option<u8>,
}

impl Progress {
    /// Counts a chunk of `chunk` bytes out of `total`, returning the new
    /// percentage when it moved on. Without a total there is none.
    fn add(&mut self, chunk: usize, total: Option<u64>) -> Option<u8> {
        self.received = self
            .received
            .saturating_add(u64::try_from(chunk).unwrap_or(u64::MAX));
        let total = total.filter(|total| *total > 0)?;
        let percent = u8::try_from((self.received.min(total) * 100) / total).unwrap_or(100);
        if self.percent == Some(percent) {
            return None;
        }
        self.percent = Some(percent);
        Some(percent)
    }
}

/// Tells the page what one install of `version` is doing, whoever started
/// it.
struct Announcer<'a> {
    app: &'a AppHandle,
    version: String,
    automatic: bool,
}

impl Announcer<'_> {
    fn announce(&self, status: UpdateStatus) {
        // A page that is not listening misses nothing it can act on.
        let _ = self.app.emit(UPDATE_STATUS_EVENT, status);
    }

    fn downloading(&self, percent: Option<u8>) {
        self.announce(UpdateStatus::Downloading {
            version: self.version.clone(),
            percent,
        });
    }

    fn installing(&self) {
        self.announce(UpdateStatus::Installing {
            version: self.version.clone(),
        });
    }

    fn failed(&self, message: &str) {
        self.announce(UpdateStatus::Failed {
            version: self.version.clone(),
            message: message.into(),
            automatic: self.automatic,
        });
    }
}

/// Checks the saved channel for a version newer than this copy. Returns its
/// version, or `None` when this copy is up to date.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<String>, String> {
    check(&app).await
}

/// Downloads and installs the update the last check found, then restarts
/// Ruru on it. Refused when the channel changed since that check.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let (channel, update, bytes, announcer) = download(&app, false).await?;
    if let Err(err) = update.install(bytes) {
        app.state::<PendingUpdate>().put_back(channel, update);
        let message = format!("The update could not be installed: {err}");
        announcer.failed(&message);
        return Err(message);
    }
    app.restart()
}

/// The update Home Assistant's update entity offers: the fake update's
/// version in a debug build run with `RURU_FAKE_UPDATE`, or what a check of
/// the saved channel finds.
pub async fn check_for_home_assistant(app: &AppHandle) -> Result<Option<String>, String> {
    match fake_update() {
        Some(version) => Ok(Some(version)),
        None => check(app).await,
    }
}

/// How an install that Home Assistant asked for ended, when Ruru is still
/// running.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Installed {
    /// The fake update: full screen is saved, and nothing else changes.
    Faked,
    /// Installed; Ruru is restarting on the new version.
    Restarting,
}

/// What finishing an install needs from the app, so tests can stand in for it.
trait Relaunch {
    /// Saves whether the next launch starts full screen, returning what was
    /// saved before.
    fn save_full_screen(&mut self, full_screen: bool) -> Result<bool, String>;
    /// Installs the downloaded update.
    fn install(&mut self, bytes: Vec<u8>) -> Result<(), String>;
    /// Starts Ruru again on the installed version.
    fn restart(&mut self);
    /// Keeps the update pending after its install failed, so it can be
    /// tried again.
    fn keep_pending(&mut self);
}

/// Installs a downloaded update so that Ruru comes back full screen: full
/// screen is saved first, because some installers end Ruru themselves, and
/// put back if the install fails. A failed install, such as a cancelled
/// password prompt, leaves the update pending.
fn relaunch_full_screen(steps: &mut impl Relaunch, bytes: Vec<u8>) -> Result<Installed, String> {
    let before = match steps.save_full_screen(true) {
        Ok(before) => before,
        Err(err) => {
            steps.keep_pending();
            return Err(err);
        }
    };
    if let Err(err) = steps.install(bytes) {
        steps.keep_pending();
        if !before && let Err(undo) = steps.save_full_screen(false) {
            eprintln!("Ruru: full screen could not be put back: {undo}");
        }
        return Err(err);
    }
    steps.restart();
    Ok(Installed::Restarting)
}

/// The fake update's install: full screen is saved as a real one would save
/// it, and Ruru keeps running.
fn fake_install(steps: &mut impl Relaunch) -> Result<Installed, String> {
    steps.save_full_screen(true)?;
    Ok(Installed::Faked)
}

/// The running app, finishing an install.
struct AppRelaunch<'a> {
    app: &'a AppHandle,
    /// The update being installed, and the channel it came from.
    update: Option<(UpdateChannel, Update)>,
}

impl Relaunch for AppRelaunch<'_> {
    fn save_full_screen(&mut self, full_screen: bool) -> Result<bool, String> {
        let state = self.app.state::<SharedSettings>();
        let mut store = settings::lock(&state);
        let before = store.current().full_screen;
        store
            .set_full_screen(full_screen)
            .map_err(|err| err.to_string())?;
        Ok(before)
    }

    fn install(&mut self, bytes: Vec<u8>) -> Result<(), String> {
        let (_, update) = self
            .update
            .as_ref()
            .ok_or("There is no update to install. Check for updates again.")?;
        update
            .install(bytes)
            .map_err(|err| format!("The update could not be installed: {err}"))
    }

    fn restart(&mut self) {
        self.app.restart()
    }

    fn keep_pending(&mut self) {
        if let Some((channel, update)) = self.update.take() {
            self.app.state::<PendingUpdate>().put_back(channel, update);
        }
    }
}

/// Installs the pending update because Home Assistant asked, and restarts
/// Ruru full screen on it. In a debug build run with `RURU_FAKE_UPDATE`, only
/// saves full screen.
pub async fn install_for_home_assistant(app: &AppHandle) -> Result<Installed, String> {
    if fake_update().is_some() {
        return fake_install(&mut AppRelaunch { app, update: None });
    }
    let (channel, update, bytes, announcer) = download(app, false).await?;
    let installed = relaunch_full_screen(
        &mut AppRelaunch {
            app,
            update: Some((channel, update)),
        },
        bytes,
    );
    if let Err(message) = &installed {
        announcer.failed(message);
    }
    installed
}

/// How often automatic updates check, after the check at startup.
pub const AUTO_CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

/// The event the page hears while an update downloads and installs, or
/// after one failed, whether the user, Home Assistant or Install updates
/// automatically started it.
pub const UPDATE_STATUS_EVENT: &str = "update-status";

/// What an install is doing, for the page's notice.
///
/// Mirrored by `UpdateStatus` in `src/app/updates.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum UpdateStatus {
    /// Downloading, `percent` of the way when the size is known.
    Downloading {
        version: String,
        percent: Option<u8>,
    },
    /// Downloaded and installing; Ruru restarts when it is done.
    Installing { version: String },
    /// The install failed and the update stays pending. An automatic one is
    /// tried again at the next check.
    Failed {
        version: String,
        message: String,
        automatic: bool,
    },
}

/// Wakes the automatic-update thread so it checks straight away, such as
/// when the setting is turned on.
pub struct AutoUpdater(Mutex<mpsc::Sender<()>>);

impl AutoUpdater {
    fn wake(&self) {
        let sender = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        // The thread only stops with the app, so a failed send changes nothing.
        let _ = sender.send(());
    }
}

/// Calls `tick` at once, then each time `wake` is sent to or `interval`
/// passes, until every sender is gone.
fn every(interval: Duration, wake: &mpsc::Receiver<()>, mut tick: impl FnMut()) {
    loop {
        tick();
        match wake.recv_timeout(interval) {
            Ok(()) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

/// Starts the automatic-update thread and returns the handle that wakes it,
/// for the app to manage. Each check does nothing unless Install updates
/// automatically is on. Needs the settings and the pending update to be
/// managed first.
pub fn start_auto_updates(app: AppHandle) -> AutoUpdater {
    let (sender, wake) = mpsc::channel();
    std::thread::spawn(move || {
        every(AUTO_CHECK_INTERVAL, &wake, || {
            if !settings::lock(&app.state::<SharedSettings>())
                .current()
                .auto_update
            {
                return;
            }
            if let Err(err) = tauri::async_runtime::block_on(auto_update(&app)) {
                eprintln!("Ruru: automatic update: {err}");
            }
        });
    });
    AutoUpdater(Mutex::new(sender))
}

/// Checks the saved channel and installs what it offers, telling the page.
/// Restarts Ruru when the install succeeds; a failed one stays pending for
/// the next try. The pending update is taken to install it, so the user,
/// Home Assistant and this thread never install the same update twice.
async fn auto_update(app: &AppHandle) -> Result<(), String> {
    if let Some(version) = fake_update() {
        // Nothing to install: the notice shows and Ruru keeps running.
        let _ = app.emit(UPDATE_STATUS_EVENT, UpdateStatus::Installing { version });
        return Ok(());
    }
    if check(app).await?.is_none() {
        return Ok(());
    }
    let (channel, update, bytes, announcer) = download(app, true).await?;
    if let Err(err) = update.install(bytes) {
        app.state::<PendingUpdate>().put_back(channel, update);
        let message = format!("The update could not be installed: {err}");
        announcer.failed(&message);
        return Err(message);
    }
    app.restart()
}

/// Saves whether updates install by themselves and returns the settings with
/// it. Turning it on checks straight away.
#[tauri::command]
pub async fn set_auto_update(
    state: State<'_, SharedSettings>,
    updater: State<'_, AutoUpdater>,
    enabled: bool,
) -> Result<Settings, String> {
    let saved = settings::lock(&state)
        .set_auto_update(enabled)
        .cloned()
        .map_err(|err| err.to_string())?;
    if enabled {
        updater.wake();
    }
    Ok(saved)
}

/// The environment variable that fakes an update in a debug build.
pub const FAKE_UPDATE_VAR: &str = "RURU_FAKE_UPDATE";

/// The version offered when `RURU_FAKE_UPDATE` is `1` rather than a version.
pub const FAKE_UPDATE_VERSION: &str = "99.0.0";

/// The version a fake update offers, from the variable's value: `None` in a
/// release build or when unset or empty, `99.0.0` for `1`, and the value
/// itself otherwise (`RURU_FAKE_UPDATE=0.2.0`).
pub fn fake_update_version(value: Option<&str>, debug: bool) -> Option<String> {
    if !debug {
        return None;
    }
    match value.map(str::trim) {
        None | Some("") => None,
        Some("1") => Some(FAKE_UPDATE_VERSION.into()),
        Some(version) => Some(version.into()),
    }
}

/// The fake update's version, reading `RURU_FAKE_UPDATE` through `lookup`
/// (an environment lookup by name).
fn fake_update_from(lookup: impl Fn(&str) -> Option<String>, debug: bool) -> Option<String> {
    fake_update_version(lookup(FAKE_UPDATE_VAR).as_deref(), debug)
}

/// The fake update's version, or `None` to check for a real one. Always
/// `None` in a release build, whatever the environment says.
#[tauri::command]
pub fn fake_update() -> Option<String> {
    fake_update_from(|name| std::env::var(name).ok(), cfg!(debug_assertions))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_schedule_ticks_at_once_on_each_wake_and_stops_with_its_senders() {
        let (sender, wake) = mpsc::channel();
        sender.send(()).unwrap();
        sender.send(()).unwrap();
        drop(sender);
        let mut ticks = 0;
        every(Duration::from_secs(3600), &wake, || ticks += 1);
        assert_eq!(ticks, 3);
    }

    #[test]
    fn the_schedule_ticks_again_when_the_interval_passes() {
        let (sender, wake) = mpsc::channel::<()>();
        let mut sender = Some(sender);
        let mut ticks = 0;
        every(Duration::from_millis(1), &wake, || {
            ticks += 1;
            if ticks == 3 {
                // With no sender left, the schedule ends after this tick.
                sender.take();
            }
        });
        assert_eq!(ticks, 3);
    }

    #[test]
    fn update_status_serialises_as_the_page_expects() {
        assert_eq!(
            serde_json::to_value(UpdateStatus::Downloading {
                version: "0.4.1".into(),
                percent: Some(42)
            })
            .unwrap(),
            serde_json::json!({ "state": "downloading", "version": "0.4.1", "percent": 42 })
        );
        assert_eq!(
            serde_json::to_value(UpdateStatus::Downloading {
                version: "0.4.1".into(),
                percent: None
            })
            .unwrap(),
            serde_json::json!({ "state": "downloading", "version": "0.4.1", "percent": null })
        );
        assert_eq!(
            serde_json::to_value(UpdateStatus::Installing {
                version: "0.4.1".into()
            })
            .unwrap(),
            serde_json::json!({ "state": "installing", "version": "0.4.1" })
        );
        assert_eq!(
            serde_json::to_value(UpdateStatus::Failed {
                version: "0.4.1".into(),
                message: "No disk space".into(),
                automatic: true
            })
            .unwrap(),
            serde_json::json!({ "state": "failed", "version": "0.4.1", "message": "No disk space", "automatic": true })
        );
    }

    #[test]
    fn progress_moves_on_whole_percentages() {
        let mut progress = Progress::default();
        assert_eq!(progress.add(0, Some(1000)), Some(0));
        assert_eq!(progress.add(4, Some(1000)), None);
        assert_eq!(progress.add(6, Some(1000)), Some(1));
        assert_eq!(progress.add(490, Some(1000)), Some(50));
        assert_eq!(progress.add(600, Some(1000)), Some(100));
        assert_eq!(progress.add(10, Some(1000)), None);
    }

    #[test]
    fn progress_without_a_size_has_no_percentage() {
        let mut progress = Progress::default();
        assert_eq!(progress.add(500, None), None);
        assert_eq!(progress.add(500, Some(0)), None);
        assert_eq!(progress.add(0, Some(2000)), Some(50));
    }

    fn releases(json: &str) -> Vec<GithubRelease> {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn edge_is_the_highest_published_version_with_a_manifest() {
        let listed = releases(
            r#"[
                {"tag_name": "v0.2.0", "draft": false, "assets": [{"name": "latest.json"}]},
                {"tag_name": "v0.10.0", "draft": false, "assets": [{"name": "Ruru.dmg"}, {"name": "latest.json"}]},
                {"tag_name": "v0.11.0", "draft": true, "assets": [{"name": "latest.json"}]},
                {"tag_name": "v0.12.0", "draft": false, "assets": [{"name": "Ruru.dmg"}]},
                {"tag_name": "v1.0.0-rc.1", "draft": false, "assets": [{"name": "latest.json"}]},
                {"tag_name": "edge", "draft": false, "assets": [{"name": "latest.json"}]},
                {"tag_name": "vnext", "draft": false, "assets": [{"name": "latest.json"}]}
            ]"#,
        );
        assert_eq!(edge_candidate(&listed), Some(Version::new(0, 10, 0)));
        assert_eq!(edge_candidate(&[]), None);
    }

    #[test]
    fn a_release_without_assets_is_skipped() {
        let listed = releases(r#"[{"tag_name": "v0.3.0"}]"#);
        assert_eq!(edge_candidate(&listed), None);
    }

    #[test]
    fn edge_reads_the_chosen_release_manifest() {
        assert_eq!(
            release_manifest(&Version::new(0, 3, 1)),
            "https://github.com/kerwincarpede/ruru/releases/download/v0.3.1/latest.json"
        );
    }

    #[test]
    fn stable_is_the_endpoint_in_tauri_conf() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(
            config["plugins"]["updater"]["endpoints"][0],
            STABLE_ENDPOINT
        );
    }

    #[test]
    fn a_release_build_never_fakes_an_update() {
        assert_eq!(fake_update_version(Some("1"), false), None);
        assert_eq!(fake_update_version(Some("0.2.0"), false), None);
    }

    #[test]
    fn unset_or_empty_checks_for_a_real_update() {
        assert_eq!(fake_update_version(None, true), None);
        assert_eq!(fake_update_version(Some(""), true), None);
        assert_eq!(fake_update_version(Some("  "), true), None);
    }

    #[test]
    fn one_offers_the_fake_version_and_anything_else_is_the_version() {
        assert_eq!(
            fake_update_version(Some("1"), true).as_deref(),
            Some(FAKE_UPDATE_VERSION)
        );
        assert_eq!(
            fake_update_version(Some(" 0.2.0 "), true).as_deref(),
            Some("0.2.0")
        );
    }

    /// An environment holding only `name=value`.
    fn env(name: &'static str, value: &'static str) -> impl Fn(&str) -> Option<String> {
        move |asked| (asked == name).then(|| value.to_string())
    }

    #[test]
    fn the_command_reads_ruru_fake_update() {
        assert_eq!(
            fake_update_from(env("RURU_FAKE_UPDATE", "1"), true).as_deref(),
            Some("99.0.0")
        );
        assert_eq!(
            fake_update_from(env("RURU_FAKE_UPDATE", "0.2.0"), true).as_deref(),
            Some("0.2.0")
        );
        assert_eq!(fake_update_from(env("RURU_FAKE_UPDATE", "1"), false), None);
    }

    #[test]
    fn a_pending_update_is_taken_once_and_only_on_its_channel() {
        let pending = Pending::default();
        assert!(
            pending
                .take(UpdateChannel::Stable)
                .unwrap_err()
                .contains("no update")
        );
        pending.keep(UpdateChannel::Stable, Some("1.0.0"));
        assert_eq!(pending.take(UpdateChannel::Stable), Ok("1.0.0"));
        assert!(pending.take(UpdateChannel::Stable).is_err());
        pending.keep(UpdateChannel::Edge, Some("1.1.0"));
        assert!(
            pending
                .take(UpdateChannel::Stable)
                .unwrap_err()
                .contains("channel changed")
        );
        // A check that finds nothing forgets the last update.
        pending.keep(UpdateChannel::Stable, Some("1.0.0"));
        pending.keep(UpdateChannel::Stable, None);
        assert!(pending.take(UpdateChannel::Stable).is_err());
    }

    #[test]
    fn a_failed_download_keeps_the_update_unless_a_new_check_replaced_it() {
        let pending = Pending::default();
        pending.put_back(UpdateChannel::Stable, "1.0.0");
        assert_eq!(pending.take(UpdateChannel::Stable), Ok("1.0.0"));
        pending.keep(UpdateChannel::Edge, Some("1.1.0"));
        pending.put_back(UpdateChannel::Stable, "1.0.0");
        assert_eq!(pending.take(UpdateChannel::Edge), Ok("1.1.0"));
    }

    /// Records what an install did, in order.
    #[derive(Default)]
    struct Steps {
        full_screen: bool,
        fail_install: bool,
        done: Vec<String>,
    }

    impl Relaunch for Steps {
        fn save_full_screen(&mut self, full_screen: bool) -> Result<bool, String> {
            self.done.push(format!("full screen {full_screen}"));
            Ok(std::mem::replace(&mut self.full_screen, full_screen))
        }

        fn install(&mut self, bytes: Vec<u8>) -> Result<(), String> {
            self.done.push(format!("install {}", bytes.len()));
            if self.fail_install {
                Err("broken".into())
            } else {
                Ok(())
            }
        }

        fn restart(&mut self) {
            self.done.push("restart".into());
        }

        fn keep_pending(&mut self) {
            self.done.push("keep pending".into());
        }
    }

    #[test]
    fn a_real_install_saves_full_screen_then_installs_and_restarts() {
        let mut steps = Steps::default();
        assert_eq!(
            relaunch_full_screen(&mut steps, vec![0; 3]),
            Ok(Installed::Restarting)
        );
        assert_eq!(steps.done, ["full screen true", "install 3", "restart"]);
        assert!(steps.full_screen);
    }

    #[test]
    fn a_failed_install_keeps_the_update_puts_full_screen_back_and_does_not_restart() {
        let mut steps = Steps {
            fail_install: true,
            ..Steps::default()
        };
        assert_eq!(
            relaunch_full_screen(&mut steps, Vec::new()),
            Err("broken".into())
        );
        assert_eq!(
            steps.done,
            [
                "full screen true",
                "install 0",
                "keep pending",
                "full screen false"
            ]
        );
        assert!(!steps.full_screen);
        // Full screen that was already saved stays saved.
        let mut steps = Steps {
            full_screen: true,
            fail_install: true,
            ..Steps::default()
        };
        assert!(relaunch_full_screen(&mut steps, Vec::new()).is_err());
        assert_eq!(
            steps.done,
            ["full screen true", "install 0", "keep pending"]
        );
        assert!(steps.full_screen);
    }

    #[test]
    fn a_fake_install_only_saves_full_screen() {
        let mut steps = Steps::default();
        assert_eq!(fake_install(&mut steps), Ok(Installed::Faked));
        assert_eq!(steps.done, ["full screen true"]);
        assert!(steps.full_screen);
    }

    #[test]
    fn other_variables_fake_nothing() {
        assert_eq!(fake_update_from(env("FAKE_UPDATE", "1"), true), None);
        assert_eq!(fake_update_from(|_| None, true), None);
    }
}
