use std::{fs, os::unix::fs::OpenOptionsExt, path::Path, process::Command};

pub(super) const WALL: &str = "ruru.service";
pub(super) const AGENT: &str = "ruru-host-agent.service";

pub(super) fn ctl(args: &[&str]) -> Result<String, String> {
    let output = Command::new("/usr/bin/systemctl")
        .args(["--user", "--no-pager", "--no-ask-password"])
        .args(args)
        .output()
        .map_err(|err| format!("Could not run systemctl: {err}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(format!(
            "systemctl {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Phase {
    Running,
    Stopped,
    Changing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Wall {
    pub phase: Phase,
    pub invocation: String,
    pub cpu: Option<u64>,
    pub memory: Option<u64>,
    pub failure: Option<String>,
}

impl Wall {
    fn parse(result: &str) -> Result<Self, String> {
        let property = |name| {
            result
                .lines()
                .filter_map(|line| line.split_once('='))
                .find_map(|(key, value)| (key == name).then_some(value))
                .unwrap_or_default()
        };
        let counter = |name| {
            property(name)
                .parse::<u64>()
                .ok()
                .filter(|n| *n != u64::MAX)
        };
        let result = property("Result");
        let phase = match (property("ActiveState"), counter("MainPID")) {
            ("active", Some(pid)) if pid > 0 => Phase::Running,
            ("inactive" | "failed", _) => Phase::Stopped,
            ("active" | "activating" | "deactivating" | "reloading" | "refreshing", _) => {
                Phase::Changing
            }
            (state, _) => return Err(format!("Unknown Ruru service state: {state}")),
        };
        Ok(Self {
            phase,
            invocation: property("InvocationID").into(),
            cpu: counter("CPUUsageNSec"),
            memory: counter("MemoryCurrent"),
            failure: (!matches!(result, "" | "success")).then(|| format!("Ruru service: {result}")),
        })
    }
}

pub(super) fn wall() -> Result<Wall, String> {
    let output = ctl(&[
        "show",
        "--property=ActiveState,MainPID,InvocationID,CPUUsageNSec,MemoryCurrent,Result",
        WALL,
    ])?;
    Wall::parse(&output)
}

/// Waits for systemd's job and confirms the requested state by reading it back.
pub(super) fn change_wall(on: bool) -> Result<(), String> {
    let goal = if on { Phase::Running } else { Phase::Stopped };
    if wall()?.phase == goal {
        return Ok(());
    }
    // Share this lock with the updater through the entire systemd stop job.
    // The updater fails before invoking the package manager if Stop won.
    let _stop = if on {
        None
    } else {
        Some(lock_wall_operation()?)
    };
    // Fail instead of replacing an already queued update restart.
    ctl(&["--job-mode=fail", if on { "start" } else { "stop" }, WALL])?;
    let observed = wall()?;
    if observed.phase == goal {
        Ok(())
    } else {
        Err(observed.failure.unwrap_or_else(|| {
            format!(
                "Ruru service did not reach the requested state ({:?}).",
                observed.phase
            )
        }))
    }
}

pub(super) fn notify_ready() -> Result<(), String> {
    if std::env::var_os("NOTIFY_SOCKET").is_none() {
        return Err("Start the managed Ruru wall through its user service.".into());
    }
    let output = Command::new("/usr/bin/systemd-notify")
        .arg("--ready")
        .output()
        .map_err(|err| format!("Could not notify systemd that Ruru is ready: {err}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Could not notify systemd that Ruru is ready: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

// Forward a local open to the same session endpoint as Tauri's installed
// single-instance plugin. Starting a separate client process with the whole
// Tauri app would race with a simultaneous Home Assistant Stop command.
pub(super) fn open_wall() -> Result<(), String> {
    ctl(&["start", WALL])?;
    let output = Command::new("/usr/bin/busctl")
        .args([
            "--user",
            "--timeout=2s",
            "call",
            "com.kerwincarpede.ruru.SingleInstance",
            "/com/kerwincarpede/ruru/SingleInstance",
            "org.SingleInstance.DBus",
            "ExecuteCallback",
            "ass",
            "0",
            "",
        ])
        .output()
        .map_err(|err| format!("Could not open the Ruru window: {err}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Could not open the Ruru window: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

pub(super) fn check_managed_wall(packaged_unit: &std::path::Path) -> Result<(), String> {
    let output = ctl(&[
        "show",
        "--property=LoadState,FragmentPath,DropInPaths",
        WALL,
    ])?;
    let fragment = output
        .lines()
        .find_map(|line| line.strip_prefix("FragmentPath="));
    let loaded = output.lines().any(|line| line == "LoadState=loaded");
    let overrides = output
        .lines()
        .any(|line| line.starts_with("DropInPaths=") && line != "DropInPaths=");
    if !loaded
        || overrides
        || fragment
            .and_then(|path| std::fs::canonicalize(path).ok())
            .as_deref()
            != Some(packaged_unit)
    {
        return Err("A systemd override is preventing Ruru from adopting its service. Check systemctl --user cat ruru.service.".into());
    }
    Ok(())
}

pub(super) fn agent_pid() -> Option<u32> {
    ctl(&["show", "--property=MainPID", "--value", AGENT])
        .ok()?
        .trim()
        .parse()
        .ok()
        .filter(|pid| *pid != 0)
}

pub(super) fn lock_wall_operation() -> Result<fs::File, String> {
    let dir = std::env::var_os("XDG_RUNTIME_DIR")
        .ok_or("Could not locate the session runtime directory.")?;
    lock_path(&Path::new(&dir).join("ruru-wall-operation.lock"))
}

fn lock_path(path: &Path) -> Result<fs::File, String> {
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .open(path)
        .map_err(|err| err.to_string())?;
    match file.try_lock() {
        Ok(()) => Ok(file),
        Err(fs::TryLockError::WouldBlock) => {
            Err("Ruru is installing an update or stopping. Try again when it finishes.".into())
        }
        Err(fs::TryLockError::Error(err)) => Err(err.to_string()),
    }
}

pub(super) fn in_wall_service() -> bool {
    std::fs::read_to_string("/proc/self/cgroup").is_ok_and(|groups| {
        groups
            .lines()
            .any(|entry| entry.split('/').any(|part| part == WALL))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requires_a_main_pid_and_reports_service_failures() {
        assert_eq!(
            Wall::parse("ActiveState=active\nMainPID=12").unwrap().phase,
            Phase::Running
        );
        assert_eq!(
            Wall::parse("ActiveState=active\nMainPID=0").unwrap().phase,
            Phase::Changing
        );
        assert_eq!(
            Wall::parse("ActiveState=deactivating\nMainPID=12")
                .unwrap()
                .phase,
            Phase::Changing
        );
        let failed = Wall::parse("ActiveState=failed\nResult=exit-code").unwrap();
        assert_eq!(failed.phase, Phase::Stopped);
        assert_eq!(failed.failure.as_deref(), Some("Ruru service: exit-code"));
        assert!(Wall::parse("").is_err());
    }

    #[test]
    fn wall_install_and_stop_cannot_both_hold_the_operation_lock() {
        let path =
            std::env::temp_dir().join(format!("ruru-lock-{}", crate::settings::new_device_id()));
        let install = lock_path(&path).unwrap();
        assert!(lock_path(&path).is_err());
        drop(install);
        let stop = lock_path(&path).unwrap();
        assert!(lock_path(&path).is_err());
        drop(stop);
        fs::remove_file(path).unwrap();
    }
}
