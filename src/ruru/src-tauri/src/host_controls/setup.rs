use std::{
    env, fs,
    fs::File,
    io::{self, Write},
    os::unix::{fs::OpenOptionsExt, fs::symlink, process::CommandExt},
    path::{Path, PathBuf},
    process::{self, Command},
    time::Duration,
};

use serde::{Deserialize, Serialize};

use super::{HostControlsCredentials, HostControlsStatus, agent, system};
use crate::{mqtt::client::Broker, settings::MqttSettings};

const DESKTOP_ID: &str = "com.kerwincarpede.ruru";
const PACKAGE: &str = "/usr/share/ruru/host-controls/ruru.service";
const ACTIVE: &str = "agent.json";
const PREPARING: &str = "migration.json";
const DISABLING: &str = "disabling.json";
const DISABLED: &str = "disabled.json";
const UBUNTU_AGENT: &str = "/usr/lib/systemd/user/ruru-host-agent.service";

#[derive(Serialize, Deserialize)]
pub(super) struct Config {
    pub host: String,
    pub port: u16,
    pub tls: bool,
    pub username: String,
    pub password: String,
    pub device_id: String,
    pub discovery_prefix: String,
    migrations: Vec<Migration>,
}

impl Config {
    pub(super) fn broker(&self) -> Broker {
        Broker {
            host: self.host.clone(),
            port: self.port,
            tls: self.tls,
            username: self.username.clone(),
            password: Some(self.password.clone()),
        }
    }
}

fn config_root() -> Result<PathBuf, String> {
    env::var_os("XDG_CONFIG_HOME")
        .filter(|p| Path::new(p).is_absolute())
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
        .ok_or_else(|| "Could not locate the user configuration directory.".into())
}

fn directory() -> Result<PathBuf, String> {
    Ok(config_root()?.join(DESKTOP_ID).join("host-controls"))
}

pub(super) fn installed() -> bool {
    env::current_exe().is_ok_and(|exe| exe == Path::new("/usr/bin/ruru"))
        && Path::new(PACKAGE).is_file()
        && Path::new(UBUNTU_AGENT).is_file()
        && fs::read_to_string("/etc/os-release").is_ok_and(|release| {
            release
                .lines()
                .any(|line| matches!(line, "ID=ubuntu" | "ID=\"ubuntu\""))
        })
}

pub(super) fn enabled() -> bool {
    directory().is_ok_and(|dir| dir.join(ACTIVE).is_file())
}

pub(super) fn read_config() -> Result<Config, String> {
    let bytes = fs::read(directory()?.join(ACTIVE)).map_err(|err| err.to_string())?;
    serde_json::from_slice(&bytes).map_err(|err| err.to_string())
}

fn write_private(path: &Path, contents: &[u8]) -> io::Result<()> {
    let temporary = path.with_extension("new");
    match fs::remove_file(&temporary) {
        Ok(()) => {}
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        Err(err) => return Err(err),
    }
    let mut file = fs::OpenOptions::new()
        .mode(0o600)
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    if let Err(error) = file
        .write_all(contents)
        .and_then(|()| file.sync_all())
        .and_then(|()| fs::rename(&temporary, path))
    {
        let _ = fs::remove_file(temporary);
        return Err(error);
    }
    Ok(())
}

fn ruru_autostart(text: &str) -> bool {
    text.lines()
        .filter_map(|line| line.strip_prefix("Exec="))
        .any(|exec| {
            matches!(
                exec.split_whitespace().next(),
                Some("ruru" | "/usr/bin/ruru" | "\"/usr/bin/ruru\"")
            )
        })
}

const HIDDEN: &[u8] = b"[Desktop Entry]\nType=Application\nName=Ruru\nHidden=true\n";

#[derive(Serialize, Deserialize)]
enum Replacement {
    Service,
    HiddenAutostart,
    None,
}

#[derive(Serialize, Deserialize)]
struct Migration {
    path: PathBuf,
    replacement: Replacement,
    had_original: bool,
}

impl Migration {
    fn new(path: PathBuf, replacement: Replacement) -> Self {
        let had_original = fs::symlink_metadata(&path).is_ok();
        Self {
            path,
            replacement,
            had_original,
        }
    }

    fn apply(&self) -> io::Result<()> {
        match self.replacement {
            Replacement::Service => symlink(PACKAGE, &self.path),
            Replacement::HiddenAutostart => write_private(&self.path, HIDDEN),
            Replacement::None => Ok(()),
        }
    }

    fn is_managed(&self) -> bool {
        match self.replacement {
            Replacement::Service => {
                fs::read_link(&self.path).is_ok_and(|target| target == Path::new(PACKAGE))
            }
            Replacement::HiddenAutostart => fs::read(&self.path).is_ok_and(|data| data == HIDDEN),
            Replacement::None => false,
        }
    }
}

fn migration_paths(root: &Path) -> Result<Vec<Migration>, String> {
    let units = root.join("systemd/user");
    let graphical = units.join("graphical-session.target.wants");
    let mut changes = vec![
        Migration::new(units.join(system::WALL), Replacement::Service),
        Migration::new(graphical.join(system::WALL), Replacement::Service),
        Migration::new(units.join("ruru.service.d"), Replacement::None),
    ];
    for entry in read_directory(&units)? {
        let dir = entry.path();
        if dir != graphical
            && dir
                .extension()
                .is_some_and(|ext| ext == "wants" || ext == "requires")
        {
            let link = dir.join(system::WALL);
            if fs::symlink_metadata(&link).is_ok() {
                changes.push(Migration::new(link, Replacement::None));
            }
        }
    }
    let user = root.join("autostart");
    let system = env::var_os("XDG_CONFIG_DIRS").unwrap_or_else(|| "/etc/xdg".into());
    for dir in std::iter::once(user.clone())
        .chain(env::split_paths(&system).map(|path| path.join("autostart")))
    {
        for entry in read_directory(&dir)? {
            let destination = user.join(entry.file_name());
            if entry.path().extension().is_some_and(|ext| ext == "desktop")
                && !changes.iter().any(|change| change.path == destination)
                && (dir == user || fs::symlink_metadata(&destination).is_err())
                && fs::read_to_string(entry.path()).is_ok_and(|text| ruru_autostart(&text))
            {
                changes.push(Migration::new(destination, Replacement::HiddenAutostart));
            }
        }
    }
    Ok(changes)
}

fn read_directory(path: &Path) -> Result<Vec<fs::DirEntry>, String> {
    match fs::read_dir(path) {
        Ok(entries) => entries
            .collect::<io::Result<_>>()
            .map_err(|err| err.to_string()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(err) => Err(err.to_string()),
    }
}

fn backup_path(dir: &Path, index: usize) -> PathBuf {
    dir.join(format!("prior-{index}"))
}

fn migrate(dir: &Path, changes: &[Migration]) -> Result<(), String> {
    for (index, change) in changes.iter().enumerate() {
        let backup = backup_path(dir, index);
        let result = (|| -> io::Result<()> {
            let path = &change.path;
            if !matches!(change.replacement, Replacement::None) {
                fs::create_dir_all(path.parent().expect("configuration path has a parent"))?;
            }
            match fs::symlink_metadata(path) {
                Ok(_) => fs::rename(path, &backup)?,
                Err(err) if err.kind() == io::ErrorKind::NotFound => {}
                Err(err) => return Err(err),
            }
            if let Err(error) = change.apply() {
                if fs::symlink_metadata(&backup).is_ok() {
                    fs::rename(&backup, path)?;
                }
                return Err(error);
            }
            Ok(())
        })();
        if let Err(error) = result {
            restore(dir, &changes[..index])?;
            return Err(error.to_string());
        }
    }
    Ok(())
}

fn check_restore(dir: &Path, changes: &[Migration]) -> Result<(), String> {
    for (index, change) in changes.iter().enumerate() {
        if fs::symlink_metadata(backup_path(dir, index)).is_ok()
            && fs::symlink_metadata(&change.path).is_ok()
            && !change.is_managed()
        {
            return Err(format!(
                "Move {} aside before restoring the previous setting.",
                change.path.display()
            ));
        }
    }
    Ok(())
}

fn restore(dir: &Path, changes: &[Migration]) -> Result<(), String> {
    check_restore(dir, changes)?;
    for (index, change) in changes.iter().enumerate().rev() {
        let path = &change.path;
        let backup = backup_path(dir, index);
        let has_backup = fs::symlink_metadata(&backup).is_ok();
        if (!change.had_original || has_backup) && change.is_managed() {
            fs::remove_file(path).map_err(|err| err.to_string())?;
        }
        if has_backup {
            if fs::symlink_metadata(path).is_ok() {
                return Err(format!(
                    "Move {} aside before restoring the previous setting.",
                    path.display()
                ));
            }
            fs::rename(backup, path).map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn install_wall(dir: &Path, changes: &[Migration]) -> Result<(), String> {
    migrate(dir, changes)?;
    system::ctl(&["daemon-reload"])?;
    system::check_managed_wall(Path::new(PACKAGE))?;
    system::ctl(&["enable", system::AGENT])?;
    Ok(())
}

fn remove_wall(dir: &Path, changes: &[Migration]) -> Result<(), String> {
    system::ctl(&["disable", system::AGENT])?;
    restore(dir, changes)?;
    system::ctl(&["daemon-reload"])?;
    Ok(())
}

fn lock_migration(dir: &Path) -> Result<Option<File>, String> {
    fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .open(dir.join("migration.lock"))
        .map_err(|err| err.to_string())?;
    match lock.try_lock() {
        Ok(()) => Ok(Some(lock)),
        Err(std::fs::TryLockError::WouldBlock) => Ok(None),
        Err(std::fs::TryLockError::Error(err)) => Err(err.to_string()),
    }
}

fn preparing(dir: &Path) -> Result<(), String> {
    let journal = dir.join(PREPARING);
    let bytes = match fs::read(&journal) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err.to_string()),
    };
    if !dir.join(ACTIVE).exists() {
        let changes: Vec<Migration> =
            serde_json::from_slice(&bytes).map_err(|err| err.to_string())?;
        remove_wall(dir, &changes)?;
    }
    fs::remove_file(journal).map_err(|err| err.to_string())
}

fn finish_disable(dir: &Path) -> Result<(), String> {
    let journal = dir.join(DISABLING);
    let bytes = match fs::read(&journal) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err.to_string()),
    };
    let config: Config = serde_json::from_slice(&bytes).map_err(|err| err.to_string())?;
    system::ctl(&["stop", system::AGENT])?;
    remove_wall(dir, &config.migrations)?;
    fs::rename(journal, dir.join(DISABLED)).map_err(|err| err.to_string())?;
    if let Ok(path) = status_path() {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

/// Resolves an interrupted migration before the local launcher decides whether
/// to delegate to the wall service. The journal can exist without credentials.
pub(super) fn recover_before_open() -> Result<bool, String> {
    let dir = directory()?;
    if !dir.join(PREPARING).exists() && !dir.join(DISABLING).exists() {
        return Ok(true);
    }
    let Some(_lock) = lock_migration(&dir)? else {
        return Ok(false);
    };
    // A failed restore must leave the ordinary launcher usable so Settings
    // can surface the journal and offer a retry.
    if let Err(error) = preparing(&dir).and_then(|()| finish_disable(&dir)) {
        eprintln!("Ruru host controls: {error}");
    }
    Ok(true)
}

pub(super) fn schedule_takeover() -> Result<(), String> {
    let pid = process::id().to_string();
    let output = Command::new("/usr/bin/systemd-run")
        .args([
            "--user",
            "--collect",
            &format!("--unit=ruru-host-activate-{pid}"),
            "--property=PartOf=graphical-session.target",
            "/usr/bin/ruru",
            "--host-activate",
        ])
        .arg(pid)
        .output()
        .map_err(|err| err.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_owned())
    }
}

pub(super) fn activate() -> Result<(), String> {
    let pid = env::args()
        .nth(2)
        .and_then(|pid| pid.parse::<u32>().ok())
        .ok_or("Missing original Ruru process ID.")?;
    for _ in 0..100 {
        if !Path::new(&format!("/proc/{pid}")).exists() {
            if enabled() {
                system::ctl(&["start", system::AGENT])?;
                return system::ctl(&["start", system::WALL]).map(|_| ());
            }
            return Err(Command::new("/usr/bin/ruru").exec().to_string());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err("The previous Ruru window did not exit. Reopen Ruru to activate the service.".into())
}

pub(super) fn status_path() -> Result<PathBuf, String> {
    let runtime =
        env::var_os("XDG_RUNTIME_DIR").ok_or("Could not locate the session runtime directory.")?;
    Ok(PathBuf::from(runtime).join("ruru-host-agent.status"))
}

pub(crate) static CHANGE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn supported() -> bool {
    installed()
        && env::var("XDG_SESSION_TYPE").is_ok_and(|kind| kind == "wayland")
        && env::var("XDG_CURRENT_DESKTOP").is_ok_and(|desktop| {
            desktop
                .split(':')
                .any(|name| name.eq_ignore_ascii_case("gnome"))
        })
}

fn check_platform() -> Result<(), String> {
    if supported() {
        Ok(())
    } else {
        Err("Host controls need Ruru’s Ubuntu .deb and a GNOME Wayland session.".into())
    }
}

pub(super) fn write_status(connected: bool, error: Option<&str>) {
    if let Ok(path) = status_path()
        && let Ok(bytes) = serde_json::to_vec(&(process::id(), connected, error))
    {
        let _ = write_private(&path, &bytes);
    }
}

fn read_agent_status(data: &[u8], active_pid: u32) -> Option<(bool, Option<String>)> {
    let (pid, connected, message): (u32, bool, Option<String>) =
        serde_json::from_slice(data).ok()?;
    (pid == active_pid).then_some((connected, message))
}

pub(super) fn status() -> HostControlsStatus {
    let enabled = enabled();
    let active_pid = enabled.then(system::agent_pid).flatten();
    let (connected, message) = if let Some(active_pid) = active_pid {
        status_path()
            .ok()
            .and_then(|path| fs::read(path).ok())
            .and_then(|data| read_agent_status(&data, active_pid))
            .unwrap_or_default()
    } else if enabled {
        (
            false,
            Some(
                "The host controls service is not running. Sign out and back in to start it."
                    .into(),
            ),
        )
    } else {
        (false, None)
    };
    HostControlsStatus {
        supported: supported(),
        enabled,
        connected,
        cleanup_pending: directory().is_ok_and(|dir| {
            [PREPARING, DISABLING, DISABLED]
                .iter()
                .any(|name| dir.join(name).exists())
        }),
        message,
    }
}

fn new_config(saved: MqttSettings, credentials: HostControlsCredentials) -> Result<Config, String> {
    let username = credentials.username.trim();
    if !saved.enabled || saved.host.is_empty() || saved.device_id.is_empty() {
        return Err("Save your Home Assistant connection before setting up host controls.".into());
    }
    if username.is_empty() || username == saved.username || username.len() > 1024 {
        return Err("Enter a separate MQTT username for host controls.".into());
    }
    if credentials.password.is_empty() || credentials.password.len() > 1024 {
        return Err("Enter the password for the host controls MQTT account.".into());
    }
    Ok(Config {
        host: saved.host,
        port: saved.port,
        tls: saved.tls,
        username: username.into(),
        password: credentials.password,
        device_id: saved.device_id,
        discovery_prefix: saved.discovery_prefix,
        migrations: Vec::new(),
    })
}

pub(super) async fn test(
    saved: MqttSettings,
    credentials: HostControlsCredentials,
) -> Result<(), String> {
    check_platform()?;
    agent::test(&new_config(saved, credentials)?).await
}

pub(super) async fn enable(
    saved: MqttSettings,
    credentials: HostControlsCredentials,
    consent: bool,
) -> Result<(), String> {
    check_platform()?;
    if !consent {
        return Err("Confirm the changes to how Ruru starts at sign-in.".into());
    }
    if enabled() {
        return Err("Host controls are already enabled.".into());
    }
    let mut config = new_config(saved, credentials)?;
    let dir = directory()?;
    agent::test(&config).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = lock_migration(&dir)?.ok_or("Another host controls migration is running.")?;
        preparing(&dir)?;
        finish_disable(&dir)?;
        if dir.join(DISABLED).exists() {
            return Err(
                "Finish removing the previous MQTT entities before enabling host controls again."
                    .into(),
            );
        }
        if dir.join(ACTIVE).exists() {
            return Err("Host controls are already enabled.".into());
        }
        if read_directory(&dir)?
            .iter()
            .any(|file| file.file_name().to_string_lossy().starts_with("prior-"))
        {
            return Err(
                "A previous setup left recovery files in the host-controls directory.".into(),
            );
        }
        config.migrations = migration_paths(&config_root()?)?;
        let changes = serde_json::to_vec(&config.migrations).map_err(|err| err.to_string())?;
        let data = serde_json::to_vec(&config).map_err(|err| err.to_string())?;
        let journal = dir.join(PREPARING);
        write_private(&journal, &changes).map_err(|err| err.to_string())?;
        let result = install_wall(&dir, &config.migrations)
            .and_then(|()| schedule_takeover())
            .and_then(|()| write_private(&dir.join(ACTIVE), &data).map_err(|err| err.to_string()));
        // An active file commits the setup. If the process is interrupted
        // before it exists, the journal instead describes what to restore.
        if result.is_ok() {
            let _ = fs::remove_file(journal);
        } else {
            preparing(&dir)?;
        }
        result
    })
    .await
    .map_err(|err| err.to_string())?
}

pub(super) async fn disable() -> Result<Option<String>, String> {
    let dir = directory()?;
    let disabled = dir.join(DISABLED);
    let work = dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let dir = work;
        let _lock = lock_migration(&dir)?.ok_or("Another host controls migration is running.")?;
        preparing(&dir)?;
        let active = dir.join(ACTIVE);
        if active.exists() {
            let config = read_config()?;
            check_restore(&dir, &config.migrations)?;
            // Commit to disable before stopping the agent. If restoration
            // subsequently fails, startup will not redirect into that service.
            fs::rename(active, dir.join(DISABLING)).map_err(|err| err.to_string())?;
        }
        finish_disable(&dir)
    })
    .await
    .map_err(|err| err.to_string())??;
    let bytes = match fs::read(&disabled) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let config = serde_json::from_slice(&bytes).map_err(|err| err.to_string())?;
    if let Err(error) = agent::cleanup(&config).await {
        return Ok(Some(format!(
            "Host controls are off. Broker cleanup is pending. {error}"
        )));
    }
    fs::remove_file(disabled).map_err(|err| err.to_string())?;
    Ok(None)
}

pub(crate) fn check_wall_broker(input: &crate::mqtt::MqttInput) -> Result<(), String> {
    if enabled() {
        let config = read_config()?;
        if !input.enabled
            || input.host != config.host
            || input.port != config.port
            || input.tls != config.tls
            || input.discovery_prefix != config.discovery_prefix
            || input.username == config.username
        {
            return Err(
                "Turn off host controls before changing the shared Home Assistant connection."
                    .into(),
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_migrates_desktop_entries_that_launch_the_packaged_wall() {
        assert!(ruru_autostart(
            "[Desktop Entry]\nExec=/usr/bin/ruru --example\n"
        ));
        assert!(ruru_autostart("[Desktop Entry]\nExec=ruru\n"));
        assert!(!ruru_autostart(
            "[Desktop Entry]\nExec=/usr/bin/another-ruru\n"
        ));
        assert!(!ruru_autostart(
            "[Desktop Entry]\nExec=/usr/bin/gnome-terminal ruru\n"
        ));
    }

    #[test]
    fn setup_reuses_the_saved_broker_and_requires_dedicated_credentials() {
        let saved = MqttSettings {
            enabled: true,
            host: "broker.test".into(),
            port: 8883,
            tls: true,
            username: "wall".into(),
            discovery_prefix: "hass".into(),
            device_id: "device".into(),
            ..MqttSettings::default()
        };
        let credentials = |user: &str, password: &str| HostControlsCredentials {
            username: user.into(),
            password: password.into(),
        };
        assert!(new_config(saved.clone(), credentials("wall", "secret")).is_err());
        assert!(new_config(saved.clone(), credentials("agent", "")).is_err());
        let config = new_config(saved, credentials("agent", "secret")).unwrap();
        assert_eq!(config.broker().address(), "broker.test:8883");
        assert!(config.tls);
        assert_eq!(config.username, "agent");
        assert_eq!(config.discovery_prefix, "hass");
        assert_eq!(config.device_id, "device");
    }

    #[test]
    fn old_agent_status_never_marks_a_new_process_connected() {
        assert_eq!(
            read_agent_status(br#"[123,true,null]"#, 123),
            Some((true, None))
        );
        assert_eq!(read_agent_status(br#"[123,true,null]"#, 124), None);
    }

    #[test]
    fn interrupted_migration_rolls_back_and_restore_preflights_user_edits() {
        let root = env::temp_dir().join(format!(
            "ruru-migration-{}",
            crate::settings::new_device_id()
        ));
        fs::create_dir(&root).unwrap();
        let first = root.join("first.desktop");
        let second = root.join("second.desktop");
        fs::write(&first, b"original first").unwrap();
        fs::write(&second, b"original second").unwrap();
        let changes = [
            Migration::new(first.clone(), Replacement::HiddenAutostart),
            Migration::new(second.clone(), Replacement::HiddenAutostart),
        ];
        migrate(&root, &changes[..1]).unwrap();
        restore(&root, &changes).unwrap();
        assert_eq!(fs::read(&first).unwrap(), b"original first");
        assert_eq!(fs::read(&second).unwrap(), b"original second");
        migrate(&root, &changes).unwrap();
        fs::write(&first, b"edited replacement").unwrap();
        assert!(restore(&root, &changes).is_err());
        assert_eq!(fs::read(&second).unwrap(), HIDDEN);
        assert_eq!(fs::read(&first).unwrap(), b"edited replacement");
        fs::remove_file(&first).unwrap();
        restore(&root, &changes).unwrap();
        assert_eq!(fs::read(&first).unwrap(), b"original first");
        assert_eq!(fs::read(&second).unwrap(), b"original second");
        fs::remove_dir_all(&root).unwrap();
    }
}
