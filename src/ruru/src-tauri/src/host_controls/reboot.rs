use std::{fs, io, path::Path, process::Command, sync::OnceLock};

use super::{setup, system};

const HELPER: &str = "/usr/share/ruru/host-controls/authorize-reboot";
const PKEXEC: &str = "/usr/bin/pkexec";
const LOGIND: &str = "org.freedesktop.login1";
const MANAGER: &str = "org.freedesktop.login1.Manager";
static SHUTDOWN_LOCK: OnceLock<fs::File> = OnceLock::new();

// Each opt-in has its own generation. A quick off/on still opens a
// fresh MQTT session, even if the agent did not observe the off setting.
#[derive(PartialEq, Eq)]
pub(super) enum Setting {
    Enabled(Vec<u8>),
    Cleanup(Vec<u8>),
}

pub(super) fn read_setting() -> Result<Option<Setting>, String> {
    match fs::read(setup::directory()?.join("reboot")) {
        Ok(value) if value == b"on" || value.starts_with(b"on:") => {
            Ok(Some(Setting::Enabled(value)))
        }
        Ok(value) if value == b"off" || value.starts_with(b"off:") => {
            Ok(Some(Setting::Cleanup(value)))
        }
        Ok(_) => Err("The host reboot setting is invalid.".into()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

pub(super) fn setting() -> Result<Option<bool>, String> {
    Ok(read_setting()?.map(|value| matches!(value, Setting::Enabled(_))))
}

pub(super) fn set(enabled: bool) -> Result<(), String> {
    let dir = setup::directory()?;
    let _settings = setup::lock_migration(&dir)?
        .ok_or("Host controls are changing. Try again when setup finishes.")?;
    if !setup::enabled() {
        return Err("Enable host controls before changing reboot.".into());
    }
    let current = setting()?;
    if current == Some(enabled) || (current.is_none() && !enabled) {
        return Ok(());
    }
    let state = if enabled { "on" } else { "off" };
    let value = format!("{state}:{}", crate::settings::new_device_id());
    setup::write_private(&dir.join("reboot"), value.as_bytes()).map_err(|err| err.to_string())
}

pub(super) fn finish_cleanup(value: Vec<u8>) -> Result<(), String> {
    let dir = setup::directory()?;
    let _settings = setup::lock_migration(&dir)?.ok_or("Host controls are changing.")?;
    if read_setting()? == Some(Setting::Cleanup(value)) {
        forget()?;
    }
    Ok(())
}

pub(super) fn forget() -> Result<(), String> {
    match fs::remove_file(setup::directory()?.join("reboot")) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum Capability {
    Ready,
    Challenge,
    Denied,
    Unsupported,
}

impl Capability {
    pub(super) fn ready(self) -> bool {
        self == Self::Ready
    }

    pub(super) fn may_authorise(self) -> bool {
        matches!(self, Self::Challenge | Self::Denied)
            && Path::new(PKEXEC).is_file()
            && Path::new(HELPER).is_file()
    }

    pub(super) fn message(self) -> Option<&'static str> {
        match self {
            Self::Ready => None,
            Self::Challenge => Some("Reboot requires authorisation or is currently blocked."),
            Self::Denied => Some("Ubuntu policy denied a reboot."),
            Self::Unsupported => Some("Ubuntu does not support reboot through logind."),
        }
    }
}

fn logind(method: &str, arguments: &[&str], json: bool) -> Result<String, String> {
    let output = Command::new("/usr/bin/busctl")
        .args([
            "--system",
            if json { "--json=short" } else { "--json=off" },
            "--timeout=5s",
            "--allow-interactive-authorization=no",
            "call",
            LOGIND,
            "/org/freedesktop/login1",
            MANAGER,
            method,
        ])
        .args(arguments)
        .output()
        .map_err(|err| format!("Could not contact Ubuntu logind: {err}"))?;
    if !output.status.success() {
        return Err(format!(
            "Ubuntu logind: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn decode_capability(result: &str) -> Result<Capability, String> {
    match result.trim() {
        r#"s "yes""# => Ok(Capability::Ready),
        r#"s "challenge""# => Ok(Capability::Challenge),
        r#"s "no""# => Ok(Capability::Denied),
        r#"s "na""# => Ok(Capability::Unsupported),
        _ => Err("Ubuntu logind returned an unknown reboot status.".into()),
    }
}

pub(super) fn capability() -> Result<Capability, String> {
    decode_capability(&logind("CanReboot", &[], false)?)
}

pub(super) fn authorise() -> Result<(), String> {
    if setting()? != Some(true) {
        return Err("Enable host reboot before authorising it.".into());
    }
    let capability = capability()?;
    if capability.ready() {
        return Ok(());
    }
    if !capability.may_authorise() {
        return Err("Local reboot authorisation is unavailable.".into());
    }
    let result = Command::new(PKEXEC)
        .args(["--disable-internal-agent", HELPER])
        .status()
        .map_err(|err| err.to_string())?;
    if result.success() {
        Ok(())
    } else {
        Err("Reboot was not authorised. If no prompt appeared, follow the terminal instructions in the Ruru guide.".into())
    }
}

fn check_request(
    enabled: Result<Option<bool>, String>,
    read_capability: impl FnOnce() -> Result<Capability, String>,
    reboot: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    if enabled? != Some(true) {
        return Err("Host reboot is disabled.".into());
    }
    if let Some(reason) = read_capability()?.message() {
        return Err(reason.into());
    }
    reboot()
}

fn check_inhibitors(reply: &str) -> Result<(), String> {
    type Inhibitor = (String, String, String, String, u32, u32);
    #[derive(serde::Deserialize)]
    struct Reply {
        data: (Vec<Inhibitor>,),
    }
    let reply: Reply =
        serde_json::from_str(reply).map_err(|_| "Could not read Ubuntu shutdown inhibitors.")?;
    if reply.data.0.iter().any(|(what, _, _, mode, _, _)| {
        what.split(':').any(|event| event == "shutdown")
            && matches!(mode.as_str(), "block" | "block-weak")
    }) {
        return Err("An application is blocking shutdown. Try again when it finishes.".into());
    }
    Ok(())
}

pub(super) fn request() -> Result<(), String> {
    let dir = setup::directory()?;
    let _settings = setup::lock_migration(&dir)?
        .ok_or("Host controls are changing. Try again when setup finishes.")?;
    check_request(
        if setup::enabled() {
            setting()
        } else {
            Ok(None)
        },
        capability,
        || {
            let operation = system::lock_wall_operation()?;
            check_inhibitors(&logind("ListInhibitors", &[], true)?)?;
            // Logind's final permission and inhibitor checks still apply.
            logind("RebootWithFlags", &["t", "1"], false)?;
            // Keep new installs out between accepting reboot and shutdown.
            let _ = SHUTDOWN_LOCK.set(operation);
            Ok(())
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logind_capabilities_are_fail_closed() {
        for (response, capability) in [
            (r#"s "yes""#, Capability::Ready),
            (r#"s "challenge""#, Capability::Challenge),
            (r#"s "no""#, Capability::Denied),
            (r#"s "na""#, Capability::Unsupported),
        ] {
            assert_eq!(decode_capability(response), Ok(capability));
            assert_eq!(capability.ready(), capability == Capability::Ready);
            assert_eq!(capability.message().is_none(), capability.ready());
        }
        assert!(decode_capability(r#"s "unknown""#).is_err());
    }

    #[test]
    fn a_disabled_or_unauthorised_request_cannot_reach_logind_reboot() {
        for setting in [None, Some(false)] {
            assert!(
                check_request(
                    Ok(setting),
                    || panic!("disabled requests need no permission check"),
                    || panic!("disabled requests must never reboot"),
                )
                .is_err()
            );
        }
        for capability in [
            Capability::Challenge,
            Capability::Denied,
            Capability::Unsupported,
        ] {
            assert!(
                check_request(
                    Ok(Some(true)),
                    || Ok(capability),
                    || panic!("unauthorised requests must never reboot"),
                )
                .is_err()
            );
        }
    }

    #[test]
    fn a_denial_or_inhibitor_from_the_final_call_is_reported() {
        assert_eq!(
            check_request(
                Ok(Some(true)),
                || Ok(Capability::Ready),
                || Err("Interactive authentication required or operation inhibited".into())
            ),
            Err("Interactive authentication required or operation inhibited".into())
        );
        assert_eq!(
            check_request(Ok(Some(true)), || Ok(Capability::Ready), || Ok(())),
            Ok(())
        );
    }
    #[test]
    fn checks_blocking_shutdown_inhibitors_including_the_desktop_users_weak_lock() {
        for mode in ["block", "block-weak"] {
            let reply = serde_json::json!({
                "data": [[["sleep:shutdown", "Editor", "Unsaved data", mode, 1000, 42]]]
            });
            assert!(check_inhibitors(&reply.to_string()).is_err());
        }
        for reply in [
            r#"{"data":[[]]}"#,
            r#"{"data":[[["sleep","Editor","","block-weak",1000,42],["shutdown","Editor","","delay",1000,42]]]}"#,
        ] {
            assert_eq!(check_inhibitors(reply), Ok(()));
        }
        assert!(check_inhibitors(r#"{"data":[]}"#).is_err());
    }
}
