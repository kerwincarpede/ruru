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
//! A debug build run with `RURU_FAKE_UPDATE` set offers a fake update
//! instead, so the prompt can be seen without a newer release.

use std::{
    sync::{Mutex, MutexGuard},
    time::Duration,
};

use semver::Version;
use serde::Deserialize;
use tauri::{AppHandle, State, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::settings::{self, SharedSettings, UpdateChannel};

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
/// it is installed or a later check replaces it.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<(UpdateChannel, Update)>>);

impl PendingUpdate {
    fn lock(&self) -> MutexGuard<'_, Option<(UpdateChannel, Update)>> {
        // A panic while holding the lock leaves the update as it was.
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// The channel saved in Settings.
fn saved_channel(state: &SharedSettings) -> UpdateChannel {
    settings::lock(state).current().update_channel
}

/// Checks the saved channel for a version newer than this copy. Returns its
/// version, or `None` when this copy is up to date.
#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    settings: State<'_, SharedSettings>,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<String>, String> {
    let channel = saved_channel(&settings);
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
    *pending.lock() = update.map(|update| (channel, update));
    Ok(version)
}

/// Downloads and installs the update the last check found, then restarts
/// Ruru on it. Refused when the channel changed since that check.
#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    settings: State<'_, SharedSettings>,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let found = pending.lock().take();
    let Some((channel, update)) = found else {
        return Err("There is no update to install. Check for updates again.".into());
    };
    if channel != saved_channel(&settings) {
        return Err("The update channel changed. Check for updates again.".into());
    }
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|err| format!("The update could not be installed: {err}"))?;
    app.restart()
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
    fn other_variables_fake_nothing() {
        assert_eq!(fake_update_from(env("FAKE_UPDATE", "1"), true), None);
        assert_eq!(fake_update_from(|_| None, true), None);
    }
}
