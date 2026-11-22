//! The in-app update check's one backend piece: the debug-only fake update.
//!
//! The page checks for, downloads and installs updates itself through the
//! updater plugin, against the Stable channel's `latest.json` (see
//! `plugins.updater` in tauri.conf.json), and restarts through the process
//! plugin. A debug build run with `RURU_FAKE_UPDATE` set offers a fake update
//! instead, so the prompt can be seen without a newer release.

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

/// The fake update's version, or `None` to check for a real one. Always
/// `None` in a release build, whatever the environment says.
#[tauri::command]
pub fn fake_update() -> Option<String> {
    fake_update_version(
        std::env::var(FAKE_UPDATE_VAR).ok().as_deref(),
        cfg!(debug_assertions),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn the_command_reads_the_environment() {
        // The test binary is a debug build; the variable is unset in CI.
        let expected = fake_update_version(
            std::env::var(FAKE_UPDATE_VAR).ok().as_deref(),
            cfg!(debug_assertions),
        );
        assert_eq!(fake_update(), expected);
    }
}
