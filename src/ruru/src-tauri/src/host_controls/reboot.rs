use std::{fs, io, path::Path, process::Command};

use super::{setup, system};

const HELPER: &str = "/usr/share/ruru/host-controls/authorize-reboot";
const PKEXEC: &str = "/usr/bin/pkexec";
const LOGIND: &str = "org.freedesktop.login1";
const MANAGER: &str = "org.freedesktop.login1.Manager";

// Keep the setting separate from the broker credentials. Off also means the
// broker may still have an entity to clear after a disconnected opt-out.
pub(super) fn setting() -> Result<Option<bool>, String> {
    match fs::read(setup::directory()?.join("reboot")) {
        Ok(value) if value == b"on" => Ok(Some(true)),
        Ok(value) if value == b"off" => Ok(Some(false)),
        Ok(_) => Err("The host reboot setting is invalid.".into()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

pub(super) fn set(enabled: bool) -> Result<(), String> {
    let current = setting()?;
    if current == Some(enabled) || (current.is_none() && !enabled) {
        return Ok(());
    }
    let value: &[u8] = if enabled { b"on" } else { b"off" };
    setup::write_private(&setup::directory()?.join("reboot"), value)
        .map_err(|err| err.to_string())?;
    system::ctl(&["restart", system::AGENT]).map(|_| ())
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

fn logind(method: &str, arguments: &[&str]) -> Result<String, String> {
    let output = Command::new("/usr/bin/busctl")
        .args([
            "--system",
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
    decode_capability(&logind("CanReboot", &[])?)
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

pub(super) fn request() -> Result<(), String> {
    check_request(setting(), capability, || {
        // A normal reboot. The flag requires logind to honour weak inhibitors
        // too. No interactive authorisation or inhibitor bypass is requested.
        logind("RebootWithFlags", &["t", "1"]).map(|_| ())
    })
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
}
