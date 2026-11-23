//! Turning the screen off and on, for Home Assistant's Display switch. Each
//! platform has its own way: a system message on Windows, `pmset` and
//! `caffeinate` on macOS, `xset` on Linux X11 and `wlopm` on wlroots Wayland
//! compositors such as labwc and Sway. Anywhere else, and where the tool is
//! missing or the display server can't do it, the switch is not offered.
//!
//! Every call here may start a process and wait for it, so callers run them
//! off the main thread.

use std::{fmt, process::Command};

/// How this computer turns its screen off and on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    /// `SC_MONITORPOWER` through `WM_SYSCOMMAND`.
    Windows,
    /// `pmset displaysleepnow` to sleep, `caffeinate -u` to wake.
    MacOs,
    /// DPMS through `xset`.
    X11,
    /// The wlr output power protocol through `wlopm`.
    Wlroots,
}

/// The kind of Linux desktop session Ruru runs in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinuxSession {
    X11,
    Wayland,
    /// No display server Ruru can tell, such as a console.
    Unknown,
}

/// The Linux session from its environment. Wayland wins over X11: under
/// Wayland `DISPLAY` points at Xwayland, whose DPMS does not reach the
/// screen.
pub fn linux_session(
    session_type: Option<&str>,
    wayland_display: Option<&str>,
    display: Option<&str>,
) -> LinuxSession {
    let set = |value: Option<&str>| value.is_some_and(|value| !value.trim().is_empty());
    match session_type.map(|kind| kind.trim().to_ascii_lowercase()) {
        Some(kind) if kind == "wayland" => return LinuxSession::Wayland,
        Some(kind) if kind == "x11" => return LinuxSession::X11,
        _ => {}
    }
    if set(wayland_display) {
        LinuxSession::Wayland
    } else if set(display) {
        LinuxSession::X11
    } else {
        LinuxSession::Unknown
    }
}

/// The method for operating system `os`, as `std::env::consts::OS` names
/// it, in Linux session `session`.
pub fn method_for(os: &str, session: LinuxSession) -> Option<Method> {
    match os {
        "windows" => Some(Method::Windows),
        "macos" => Some(Method::MacOs),
        "linux" => match session {
            LinuxSession::X11 => Some(Method::X11),
            LinuxSession::Wayland => Some(Method::Wlroots),
            LinuxSession::Unknown => None,
        },
        _ => None,
    }
}

/// One program to run, with its arguments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Program {
    pub name: &'static str,
    pub args: &'static [&'static str],
}

impl Program {
    const fn new(name: &'static str, args: &'static [&'static str]) -> Self {
        Self { name, args }
    }
}

impl fmt::Display for Program {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name)?;
        for arg in self.args {
            write!(f, " {arg}")?;
        }
        Ok(())
    }
}

impl Method {
    /// The programs that turn the screen on, or off, in order. Windows needs
    /// none: it uses a system message.
    pub fn programs(self, on: bool) -> Vec<Program> {
        match (self, on) {
            (Self::Windows, _) => Vec::new(),
            (Self::MacOs, false) => vec![Program::new("pmset", &["displaysleepnow"])],
            // Declares the user active for a second, which wakes the screen.
            (Self::MacOs, true) => vec![Program::new("caffeinate", &["-u", "-t", "1"])],
            (Self::X11, false) => vec![Program::new("xset", &["dpms", "force", "off"])],
            (Self::X11, true) => vec![Program::new("xset", &["dpms", "force", "on"])],
            (Self::Wlroots, false) => vec![Program::new("wlopm", &["--off", "*"])],
            (Self::Wlroots, true) => vec![Program::new("wlopm", &["--on", "*"])],
        }
    }

    /// The program that shows whether the method works here, if it needs
    /// one. `xset q` lists DPMS only when the X server has it; `wlopm` alone
    /// lists the outputs, and fails when the compositor lacks the protocol.
    pub fn probe(self) -> Option<Program> {
        match self {
            Self::Windows | Self::MacOs => None,
            Self::X11 => Some(Program::new("xset", &["q"])),
            Self::Wlroots => Some(Program::new("wlopm", &[])),
        }
    }

    /// Whether the probe's result says the method works.
    pub fn probe_passed(self, succeeded: bool, stdout: &str) -> bool {
        match self {
            Self::Windows | Self::MacOs => true,
            Self::X11 => succeeded && stdout.contains("DPMS (Energy Star)"),
            Self::Wlroots => succeeded && !stdout.trim().is_empty(),
        }
    }
}

/// Why the screen can't be turned off and on here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Unsupported {
    /// Not Windows, macOS, or a Linux X11 or Wayland session.
    Platform,
    /// The tool is not installed.
    Missing(&'static str),
    /// The display server can't do it: no DPMS on X11, or a Wayland
    /// compositor without wlroots' output power protocol.
    Server(Method),
}

impl fmt::Display for Unsupported {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Platform => f.write_str(
                "turning the display off needs Windows, macOS, or Linux with X11 or a wlroots compositor",
            ),
            Self::Missing(tool) => write!(f, "{tool} is not installed"),
            Self::Server(Method::Wlroots) => {
                f.write_str("the Wayland compositor can't turn its outputs off through wlopm")
            }
            Self::Server(_) => f.write_str("the X server has no DPMS"),
        }
    }
}

/// Why turning the screen off or on failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DisplayError {
    /// The program could not be started.
    Start(String, String),
    /// The program ran and failed.
    Failed(String, String),
}

impl fmt::Display for DisplayError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Start(program, err) => write!(f, "{program} could not start: {err}"),
            Self::Failed(program, err) if err.is_empty() => write!(f, "{program} failed"),
            Self::Failed(program, err) => write!(f, "{program} failed: {err}"),
        }
    }
}

/// The method for this computer, or why there is none. It may run a probe,
/// so it blocks.
pub fn support() -> Result<Method, Unsupported> {
    let var = |key: &str| std::env::var(key).ok();
    let session = linux_session(
        var("XDG_SESSION_TYPE").as_deref(),
        var("WAYLAND_DISPLAY").as_deref(),
        var("DISPLAY").as_deref(),
    );
    let method = method_for(std::env::consts::OS, session).ok_or(Unsupported::Platform)?;
    let Some(probe) = method.probe() else {
        return Ok(method);
    };
    match Command::new(probe.name).args(probe.args).output() {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            Err(Unsupported::Missing(probe.name))
        }
        Err(_) => Err(Unsupported::Server(method)),
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if method.probe_passed(output.status.success(), &stdout) {
                Ok(method)
            } else {
                Err(Unsupported::Server(method))
            }
        }
    }
}

/// Turns the screen on, or off, with `method`. It blocks until done.
pub fn set(method: Method, on: bool) -> Result<(), DisplayError> {
    if method == Method::Windows {
        return windows::set(on);
    }
    for program in method.programs(on) {
        let output = Command::new(program.name)
            .args(program.args)
            .output()
            .map_err(|err| DisplayError::Start(program.to_string(), err.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(DisplayError::Failed(program.to_string(), stderr));
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
mod windows {
    use super::DisplayError;

    const HWND_BROADCAST: isize = 0xffff;
    const WM_SYSCOMMAND: u32 = 0x0112;
    const SC_MONITORPOWER: usize = 0xF170;
    /// `SC_MONITORPOWER`'s argument to turn the screen off.
    const POWER_OFF: isize = 2;
    /// `SC_MONITORPOWER`'s argument to turn the screen on.
    const POWER_ON: isize = -1;
    const MOUSEEVENTF_MOVE: u32 = 0x0001;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn PostMessageW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> i32;
        fn mouse_event(flags: u32, dx: i32, dy: i32, data: u32, extra: usize);
    }

    /// Posts rather than sends, since a broadcast send waits on every
    /// window and can hang on one that does not answer.
    pub fn set(on: bool) -> Result<(), DisplayError> {
        let power = if on { POWER_ON } else { POWER_OFF };
        // SAFETY: PostMessageW takes plain values and copies them; nothing
        // is borrowed past the call.
        let posted = unsafe { PostMessageW(HWND_BROADCAST, WM_SYSCOMMAND, SC_MONITORPOWER, power) };
        if posted == 0 {
            return Err(DisplayError::Failed(
                "SC_MONITORPOWER".into(),
                std::io::Error::last_os_error().to_string(),
            ));
        }
        if on {
            // Recent Windows ignores SC_MONITORPOWER's on; a mouse nudge
            // there and back wakes the screen instead.
            // SAFETY: mouse_event takes plain values and returns nothing.
            unsafe {
                mouse_event(MOUSEEVENTF_MOVE, 1, 0, 0, 0);
                mouse_event(MOUSEEVENTF_MOVE, -1, 0, 0, 0);
            }
        }
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
mod windows {
    use super::DisplayError;

    /// Never reached: `support` offers the Windows method only on Windows.
    pub fn set(_on: bool) -> Result<(), DisplayError> {
        Err(DisplayError::Failed(
            "SC_MONITORPOWER".into(),
            "only on Windows".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn commands(method: Method, on: bool) -> Vec<String> {
        method
            .programs(on)
            .iter()
            .map(ToString::to_string)
            .collect()
    }

    #[test]
    fn each_platform_has_its_method() {
        let any = LinuxSession::Unknown;
        assert_eq!(method_for("windows", any), Some(Method::Windows));
        assert_eq!(method_for("macos", any), Some(Method::MacOs));
        assert_eq!(method_for("linux", LinuxSession::X11), Some(Method::X11));
        assert_eq!(
            method_for("linux", LinuxSession::Wayland),
            Some(Method::Wlroots)
        );
        assert_eq!(method_for("linux", any), None);
        assert_eq!(method_for("freebsd", LinuxSession::X11), None);
        assert_eq!(method_for("ios", any), None);
    }

    #[test]
    fn the_linux_session_comes_from_the_environment() {
        assert_eq!(
            linux_session(Some("x11"), None, Some(":0")),
            LinuxSession::X11
        );
        assert_eq!(
            linux_session(Some("wayland"), Some("wayland-0"), Some(":0")),
            LinuxSession::Wayland
        );
        // Xwayland's DISPLAY does not make a Wayland session X11.
        assert_eq!(
            linux_session(None, Some("wayland-1"), Some(":0")),
            LinuxSession::Wayland
        );
        assert_eq!(
            linux_session(Some("tty"), None, Some(":1")),
            LinuxSession::X11
        );
        assert_eq!(linux_session(None, Some(" "), None), LinuxSession::Unknown);
        assert_eq!(
            linux_session(Some("tty"), None, None),
            LinuxSession::Unknown
        );
    }

    #[test]
    fn each_method_runs_its_platform_s_commands() {
        assert_eq!(commands(Method::MacOs, false), ["pmset displaysleepnow"]);
        assert_eq!(commands(Method::MacOs, true), ["caffeinate -u -t 1"]);
        assert_eq!(commands(Method::X11, false), ["xset dpms force off"]);
        assert_eq!(commands(Method::X11, true), ["xset dpms force on"]);
        assert_eq!(commands(Method::Wlroots, false), ["wlopm --off *"]);
        assert_eq!(commands(Method::Wlroots, true), ["wlopm --on *"]);
        assert!(commands(Method::Windows, false).is_empty());
        assert!(commands(Method::Windows, true).is_empty());
    }

    #[test]
    fn linux_methods_are_probed_before_they_are_offered() {
        assert_eq!(Method::Windows.probe(), None);
        assert_eq!(Method::MacOs.probe(), None);
        assert_eq!(Method::X11.probe().unwrap().to_string(), "xset q");
        assert_eq!(Method::Wlroots.probe().unwrap().to_string(), "wlopm");
    }

    #[test]
    fn the_probe_passes_only_when_the_server_can_do_it() {
        let dpms = "Screen Saver:\n  prefer blanking:  yes\nDPMS (Energy Star):\n  Standby: 600\n  DPMS is Enabled\n  Monitor is On\n";
        assert!(Method::X11.probe_passed(true, dpms));
        assert!(!Method::X11.probe_passed(true, "Server does not have the DPMS Extension\n"));
        assert!(!Method::X11.probe_passed(false, dpms));
        assert!(Method::Wlroots.probe_passed(true, "HDMI-A-1 on\n"));
        assert!(!Method::Wlroots.probe_passed(true, ""));
        assert!(!Method::Wlroots.probe_passed(false, "HDMI-A-1 on\n"));
        assert!(Method::MacOs.probe_passed(false, ""));
    }

    #[test]
    fn reasons_read_as_sentences() {
        assert_eq!(
            Unsupported::Missing("wlopm").to_string(),
            "wlopm is not installed"
        );
        assert!(
            Unsupported::Server(Method::X11)
                .to_string()
                .contains("DPMS")
        );
        assert!(
            Unsupported::Server(Method::Wlroots)
                .to_string()
                .contains("wlopm")
        );
        assert!(Unsupported::Platform.to_string().contains("wlroots"));
        assert_eq!(
            DisplayError::Failed("xset dpms force off".into(), String::new()).to_string(),
            "xset dpms force off failed"
        );
        assert_eq!(
            DisplayError::Failed("wlopm --on *".into(), "no outputs".into()).to_string(),
            "wlopm --on * failed: no outputs"
        );
    }
}
