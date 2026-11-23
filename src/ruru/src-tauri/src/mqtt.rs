//! The connection to the MQTT broker in Home Assistant, turned on in
//! Settings › Home Assistant. Each install becomes one Home Assistant device,
//! found through MQTT discovery, with its availability, the wall's state and
//! a problem sensor per camera.
//!
//! The page reports the wall's state and each tile's problems; this module
//! keeps the latest and publishes it whenever it changes or the connection
//! comes back. The connection retries on its own, waiting longer after each
//! failure, and the broker marks the device offline through the last will
//! when Ruru goes away.

mod client;
mod discovery;
mod password;
mod topics;

use std::{
    collections::BTreeSet,
    fmt,
    sync::{Mutex, MutexGuard},
};

use rumqttc::{AsyncClient, Event, LastWill, Packet, QoS};
use serde::Deserialize;
use tauri::{AppHandle, Manager, State, async_runtime::JoinHandle};

use crate::settings::{
    self, MAX_TILES, MqttSettings, Settings, SettingsError, SharedSettings, valid_camera_name,
};
use client::Broker;
use discovery::{Device, Message, WallState};
use password::{Keychain, PasswordChange};
use topics::Topics;

/// The longest host name DNS allows.
const MAX_HOST: usize = 253;
/// The longest topic prefix Ruru accepts.
const MAX_PREFIX: usize = 100;
/// The longest username or password Ruru accepts.
const MAX_LOGIN: usize = 1024;

/// Why the broker could not be reached or the settings saved.
#[derive(Debug)]
pub enum MqttError {
    /// The page sent something that is not a valid setting.
    Invalid(String),
    /// No connection to the broker.
    Unreachable {
        address: String,
        message: String,
    },
    /// The broker said no.
    Refused(String),
    /// The broker, at this address, did not answer in time.
    Timeout(String),
    Tls(String),
    Settings(SettingsError),
}

impl fmt::Display for MqttError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(message) | Self::Refused(message) | Self::Tls(message) => {
                f.write_str(message)
            }
            Self::Unreachable { address, message } => {
                write!(f, "Could not reach the broker at {address}: {message}")
            }
            Self::Timeout(address) => write!(f, "The broker at {address} did not answer."),
            Self::Settings(err) => err.fmt(f),
        }
    }
}

impl std::error::Error for MqttError {}

/// The connection settings the page sends from Settings › Home Assistant.
/// The device id and password storage are Rust's to keep.
///
/// Mirrored by `MqttInput` in `src/app/api.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MqttInput {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub tls: bool,
    pub username: String,
    pub discovery_prefix: String,
    pub frigate_prefix: String,
}

/// A topic prefix as typed, without spaces, wildcards or outer slashes.
fn clean_prefix(input: &str, what: &str) -> Result<String, MqttError> {
    let prefix = input.trim().trim_matches('/');
    let bad = prefix.is_empty()
        || prefix.len() > MAX_PREFIX
        || prefix
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '+' | '#'));
    if bad {
        return Err(MqttError::Invalid(format!(
            "Enter a {what} prefix without spaces, + or #."
        )));
    }
    Ok(prefix.to_string())
}

/// A broker host as typed: a host name or IP address, without a scheme or
/// port. Brackets around an IPv6 address are dropped.
fn clean_host(input: &str) -> Result<String, MqttError> {
    let host = input.trim();
    let host = host
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
        .unwrap_or(host);
    let bad = host.is_empty()
        || host.len() > MAX_HOST
        || host
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '/' | '@' | '?' | '#'));
    if bad {
        return Err(MqttError::Invalid(
            "Enter the broker's host name or IP address, such as homeassistant.local.".into(),
        ));
    }
    Ok(host.to_string())
}

impl MqttInput {
    /// The input made safe to save: trimmed and checked. A connection that
    /// is off may be saved without a host.
    pub fn validated(self, need_host: bool) -> Result<Self, MqttError> {
        let host = if need_host || !self.host.trim().is_empty() {
            clean_host(&self.host)?
        } else {
            String::new()
        };
        if self.port == 0 {
            return Err(MqttError::Invalid("Enter a port from 1 to 65535.".into()));
        }
        let username = self.username.trim().to_string();
        if username.len() > MAX_LOGIN {
            return Err(MqttError::Invalid("The username is too long.".into()));
        }
        Ok(Self {
            host,
            username,
            discovery_prefix: clean_prefix(&self.discovery_prefix, "discovery")?,
            frigate_prefix: clean_prefix(&self.frigate_prefix, "Frigate")?,
            ..self
        })
    }

    /// The saved connection, changed to this input.
    fn apply_to(self, mqtt: MqttSettings) -> MqttSettings {
        MqttSettings {
            enabled: self.enabled,
            host: self.host,
            port: self.port,
            tls: self.tls,
            username: self.username,
            discovery_prefix: self.discovery_prefix,
            frigate_prefix: self.frigate_prefix,
            ..mqtt
        }
    }
}

/// Checks a password the page sent.
fn checked_password(password: Option<String>) -> Result<Option<String>, MqttError> {
    match password {
        Some(password) if password.len() > MAX_LOGIN => {
            Err(MqttError::Invalid("The password is too long.".into()))
        }
        password => Ok(password),
    }
}

/// The wall as the page last reported it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Wall {
    state: WallState,
    /// Every camera on the Frigate server, in Frigate's order.
    cameras: Vec<String>,
    /// Cameras whose tile has a problem now.
    problems: BTreeSet<String>,
}

impl Wall {
    fn problem(&self, camera: &str) -> bool {
        self.problems.contains(camera)
    }
}

/// One connection's view of what Home Assistant has been told.
#[derive(Debug)]
struct Session {
    topics: Topics,
    device: Device,
    /// Connected to the broker now. Nothing is queued while it is not:
    /// everything is published again on connecting.
    connected: bool,
    /// The cameras whose problem sensor has been announced.
    announced: BTreeSet<String>,
}

impl Session {
    fn new(topics: Topics, device: Device) -> Self {
        Self {
            topics,
            device,
            connected: false,
            announced: BTreeSet::new(),
        }
    }

    /// Everything Home Assistant needs on connecting, or when it restarts:
    /// online, the device's sensors, each camera's problem sensor, removals
    /// for cameras that are gone, and the current state.
    fn announce(&mut self, wall: &Wall) -> Vec<Message> {
        if !self.connected {
            return Vec::new();
        }
        let mut messages = vec![Message {
            topic: self.topics.availability(),
            payload: "online".into(),
            retain: true,
        }];
        messages.extend(discovery::device_configs(&self.topics, &self.device));
        messages.extend(self.cameras_changed(wall, true));
        messages.push(discovery::state(&self.topics, &self.device, &wall.state));
        messages
    }

    /// The problem sensors for cameras that are new, with their state, and
    /// removals for cameras that are gone. With `all`, every camera counts
    /// as new.
    fn cameras_changed(&mut self, wall: &Wall, all: bool) -> Vec<Message> {
        if !self.connected {
            return Vec::new();
        }
        let current: BTreeSet<String> = wall.cameras.iter().cloned().collect();
        let mut messages = Vec::new();
        for camera in self.announced.difference(&current) {
            messages.push(discovery::camera_removal(&self.topics, camera));
        }
        for camera in &wall.cameras {
            if all || !self.announced.contains(camera) {
                messages.push(discovery::camera_config(&self.topics, &self.device, camera));
                messages.push(discovery::problem(
                    &self.topics,
                    camera,
                    wall.problem(camera),
                ));
            }
        }
        self.announced = current;
        messages
    }

    fn state(&self, wall: &Wall) -> Vec<Message> {
        if !self.connected {
            return Vec::new();
        }
        vec![discovery::state(&self.topics, &self.device, &wall.state)]
    }

    fn problem(&self, camera: &str, problem: bool) -> Vec<Message> {
        if !self.connected || !self.announced.contains(camera) {
            return Vec::new();
        }
        vec![discovery::problem(&self.topics, camera, problem)]
    }
}

/// The running connection.
struct Link {
    client: AsyncClient,
    session: Session,
}

impl Link {
    fn send(&self, messages: Vec<Message>) {
        for message in messages {
            let sent = self.client.try_publish(
                message.topic,
                QoS::AtLeastOnce,
                message.retain,
                message.payload,
            );
            if let Err(err) = sent {
                eprintln!("Ruru: an MQTT message was dropped: {err}");
            }
        }
    }
}

#[derive(Default)]
struct Inner {
    wall: Wall,
    /// Bumped on every restart, so a connection that was replaced stops
    /// touching the state.
    generation: u64,
    task: Option<JoinHandle<()>>,
    link: Option<Link>,
}

impl Inner {
    /// The link of connection `generation`, if it is still the current one.
    fn link(&mut self, generation: u64) -> Option<(&mut Link, &Wall)> {
        if self.generation != generation {
            return None;
        }
        self.link.as_mut().map(|link| (link, &self.wall))
    }
}

/// The wall's latest state and the connection, as the app manages them.
#[derive(Default)]
pub struct MqttState(Mutex<Inner>);

impl MqttState {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        // A panic while holding the lock leaves the state as it was.
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Hands the state to the app and connects if the connection is on.
pub fn manage(app: &tauri::App) {
    app.manage(MqttState::default());
    restart(app.handle());
}

/// Drops the connection and, if Settings › Home Assistant has it on,
/// connects again with the saved settings.
pub fn restart(app: &AppHandle) {
    let mqtt = settings::lock(&app.state::<SharedSettings>())
        .current()
        .mqtt
        .clone();
    let state = app.state::<MqttState>();
    let mut inner = state.lock();
    inner.generation += 1;
    if let Some(task) = inner.task.take() {
        task.abort();
    }
    inner.link = None;
    if !mqtt.enabled || mqtt.host.is_empty() || mqtt.device_id.is_empty() {
        return;
    }
    let generation = inner.generation;
    let app = app.clone();
    inner.task = Some(tauri::async_runtime::spawn(async move {
        let saved = mqtt.clone();
        let password =
            tauri::async_runtime::spawn_blocking(move || password::load(&Keychain, &saved)).await;
        let password = match password {
            Ok(Ok(password)) => password,
            Ok(Err(err)) => {
                // Connect anyway: the broker says whether it needed one.
                eprintln!("Ruru: {err}");
                None
            }
            Err(err) => {
                eprintln!("Ruru: the MQTT password could not be read: {err}");
                None
            }
        };
        let broker = Broker {
            host: mqtt.host,
            port: mqtt.port,
            tls: mqtt.tls,
            username: mqtt.username,
            password,
        };
        let topics = Topics::new(&mqtt.device_id, &mqtt.discovery_prefix);
        run(app, generation, broker, topics).await;
    }));
}

/// Keeps one connection up until it is replaced, publishing everything
/// again on each connect.
async fn run(app: AppHandle, generation: u64, broker: Broker, topics: Topics) {
    let will = LastWill::new(topics.availability(), "offline", QoS::AtLeastOnce, true);
    let client_id = format!("{}-{}", topics::ROOT, topics.device_id());
    let options = match client::options(&broker, &client_id, Some(will)) {
        Ok(options) => options,
        Err(err) => {
            eprintln!("Ruru: MQTT is off: {err}");
            return;
        }
    };
    let (client, mut events) = AsyncClient::new(options, client::QUEUE);
    let home_assistant = topics.home_assistant_status();
    {
        let state = app.state::<MqttState>();
        let mut inner = state.lock();
        if inner.generation != generation {
            return;
        }
        let session = Session::new(topics, Device::this_install());
        inner.link = Some(Link {
            client: client.clone(),
            session,
        });
    }
    let announce = |connected: bool| {
        let state = app.state::<MqttState>();
        let mut inner = state.lock();
        if let Some((link, wall)) = inner.link(generation) {
            let wall = wall.clone();
            link.session.connected = connected;
            let messages = link.session.announce(&wall);
            link.send(messages);
        }
    };
    let mut attempt = 0;
    loop {
        match events.poll().await {
            Ok(Event::Incoming(Packet::ConnAck(_))) => {
                attempt = 0;
                announce(true);
                if let Err(err) = client.try_subscribe(home_assistant.clone(), QoS::AtLeastOnce) {
                    eprintln!("Ruru: could not follow Home Assistant's status: {err}");
                }
            }
            // Home Assistant restarted and forgot its devices.
            Ok(Event::Incoming(Packet::Publish(publish)))
                if publish.topic == home_assistant && &publish.payload[..] == b"online" =>
            {
                announce(true);
            }
            Ok(_) => {}
            Err(err) => {
                {
                    let state = app.state::<MqttState>();
                    let mut inner = state.lock();
                    if let Some((link, _)) = inner.link(generation) {
                        link.session.connected = false;
                    }
                }
                eprintln!("Ruru: MQTT: {}", client::describe(&broker, &err));
                tokio::time::sleep(client::backoff(attempt)).await;
                attempt = attempt.saturating_add(1);
            }
        }
    }
}

/// What the page reports about the wall.
///
/// Mirrored by `WallReport` in `src/app/api.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallReport {
    /// The camera filling the window, if any.
    pub maximised: Option<String>,
    pub full_screen: bool,
    pub window_shown: bool,
    /// Every camera on the Frigate server, in Frigate's order.
    pub cameras: Vec<String>,
}

/// Checks a wall report from the page.
fn validate_report(report: &WallReport) -> Result<(), MqttError> {
    let bad = report.cameras.len() > MAX_TILES
        || report.cameras.iter().any(|name| !valid_camera_name(name))
        || report
            .maximised
            .as_deref()
            .is_some_and(|name| !valid_camera_name(name));
    if bad {
        return Err(MqttError::Invalid(
            "The wall report names a camera that is not valid.".into(),
        ));
    }
    Ok(())
}

impl Wall {
    /// Takes in a report, returning whether the cameras changed.
    fn report(&mut self, report: WallReport) -> bool {
        self.state = WallState {
            maximised: report.maximised,
            full_screen: report.full_screen,
            window_shown: report.window_shown,
        };
        let changed = self.cameras != report.cameras;
        if changed {
            let cameras: BTreeSet<&String> = report.cameras.iter().collect();
            self.problems.retain(|camera| cameras.contains(camera));
            self.cameras = report.cameras;
        }
        changed
    }

    /// Records a tile's problem, returning whether it changed.
    fn set_problem(&mut self, camera: &str, problem: bool) -> bool {
        if problem {
            self.problems.insert(camera.to_string())
        } else {
            self.problems.remove(camera)
        }
    }
}

/// Connects to the broker once with what the user entered, for Test
/// connection. Without a new password, the saved one is used.
#[tauri::command]
pub async fn test_mqtt(
    store: State<'_, SharedSettings>,
    input: MqttInput,
    password: Option<String>,
) -> Result<(), String> {
    let input = input.validated(true).map_err(|err| err.to_string())?;
    let password = checked_password(password).map_err(|err| err.to_string())?;
    let password = match PasswordChange::from_page(&input.username, password) {
        PasswordChange::Set(password) => Some(password),
        PasswordChange::Remove => None,
        PasswordChange::Keep => {
            let saved = settings::lock(&store).current().mqtt.clone();
            tauri::async_runtime::spawn_blocking(move || password::load(&Keychain, &saved))
                .await
                .map_err(|err| err.to_string())??
        }
    };
    let broker = Broker {
        host: input.host,
        port: input.port,
        tls: input.tls,
        username: input.username,
        password,
    };
    client::test(&broker).await.map_err(|err| err.to_string())
}

/// Saves the Home Assistant connection and connects with it, or
/// disconnects when it is off. Returns the settings with it.
#[tauri::command]
pub async fn save_mqtt(
    app: AppHandle,
    store: State<'_, SharedSettings>,
    input: MqttInput,
    password: Option<String>,
) -> Result<Settings, String> {
    let enabled = input.enabled;
    let input = input.validated(enabled).map_err(|err| err.to_string())?;
    let password = checked_password(password).map_err(|err| err.to_string())?;
    let change = PasswordChange::from_page(&input.username, password);
    let current = settings::lock(&store).current().mqtt.clone();
    let next = input.apply_to(current);
    let next =
        tauri::async_runtime::spawn_blocking(move || password::apply(&Keychain, next, change))
            .await
            .map_err(|err| err.to_string())?;
    let saved = settings::lock(&store)
        .set_mqtt(next)
        .map(Settings::for_page)
        .map_err(|err| MqttError::Settings(err).to_string())?;
    restart(&app);
    Ok(saved)
}

/// Takes the wall's state from the page and publishes what changed.
#[tauri::command]
pub fn report_wall_state(state: State<'_, MqttState>, report: WallReport) -> Result<(), String> {
    validate_report(&report).map_err(|err| err.to_string())?;
    let mut inner = state.lock();
    let cameras_changed = inner.wall.report(report);
    let generation = inner.generation;
    if let Some((link, wall)) = inner.link(generation) {
        let wall = wall.clone();
        let mut messages = Vec::new();
        if cameras_changed {
            messages.extend(link.session.cameras_changed(&wall, false));
        }
        messages.extend(link.session.state(&wall));
        link.send(messages);
    }
    Ok(())
}

/// Takes a tile's problem from the page: on when it can't play or has been
/// reconnecting for a while.
#[tauri::command]
pub fn report_tile_problem(
    state: State<'_, MqttState>,
    camera: String,
    problem: bool,
) -> Result<(), String> {
    if !valid_camera_name(&camera) {
        return Err("The camera name is not valid.".into());
    }
    let mut inner = state.lock();
    if !inner.wall.set_problem(&camera, problem) {
        return Ok(());
    }
    let generation = inner.generation;
    if let Some((link, _)) = inner.link(generation) {
        let messages = link.session.problem(&camera, problem);
        link.send(messages);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> MqttInput {
        MqttInput {
            enabled: true,
            host: " homeassistant.local ".into(),
            port: 1883,
            tls: false,
            username: " ruru ".into(),
            discovery_prefix: "homeassistant/".into(),
            frigate_prefix: " frigate".into(),
        }
    }

    fn session() -> Session {
        let mut session = Session::new(
            Topics::new("0123456789ab", "homeassistant"),
            Device {
                name: "Ruru".into(),
                version: "1.2.3".into(),
            },
        );
        session.connected = true;
        session
    }

    fn wall(cameras: &[&str]) -> Wall {
        Wall {
            cameras: cameras.iter().map(|name| name.to_string()).collect(),
            ..Wall::default()
        }
    }

    fn topics(messages: &[Message]) -> Vec<&str> {
        messages
            .iter()
            .map(|message| message.topic.as_str())
            .collect()
    }

    #[test]
    fn input_is_trimmed_and_checked() {
        let input = input().validated(true).unwrap();
        assert_eq!(input.host, "homeassistant.local");
        assert_eq!(input.username, "ruru");
        assert_eq!(input.discovery_prefix, "homeassistant");
        assert_eq!(input.frigate_prefix, "frigate");
        let v6 = MqttInput {
            host: "[fd00::1]".into(),
            ..self::input()
        };
        assert_eq!(v6.validated(true).unwrap().host, "fd00::1");
    }

    #[test]
    fn bad_input_is_refused() {
        for (bad, message) in [
            (
                MqttInput {
                    host: "mqtt://ha.local".into(),
                    ..input()
                },
                "host name",
            ),
            (
                MqttInput {
                    host: " ".into(),
                    ..input()
                },
                "host name",
            ),
            (MqttInput { port: 0, ..input() }, "port"),
            (
                MqttInput {
                    discovery_prefix: "home assistant".into(),
                    ..input()
                },
                "discovery prefix",
            ),
            (
                MqttInput {
                    frigate_prefix: "frigate/#".into(),
                    ..input()
                },
                "Frigate prefix",
            ),
            (
                MqttInput {
                    frigate_prefix: "/".into(),
                    ..input()
                },
                "Frigate prefix",
            ),
        ] {
            let err = bad.clone().validated(true).unwrap_err().to_string();
            assert!(err.contains(message), "{bad:?}: {err}");
        }
        assert!(checked_password(Some("x".repeat(MAX_LOGIN + 1))).is_err());
        assert_eq!(checked_password(None).unwrap(), None);
    }

    #[test]
    fn a_connection_that_is_off_saves_without_a_host() {
        let off = MqttInput {
            enabled: false,
            host: String::new(),
            ..input()
        };
        assert_eq!(off.clone().validated(false).unwrap().host, "");
        assert!(off.validated(true).is_err());
    }

    #[test]
    fn input_changes_the_connection_and_keeps_the_device_and_password() {
        let saved = MqttSettings {
            device_id: "0123456789ab".into(),
            password_storage: settings::PasswordStorage::Keychain,
            ..MqttSettings::default()
        };
        let next = input().validated(true).unwrap().apply_to(saved);
        assert!(next.enabled);
        assert_eq!(next.host, "homeassistant.local");
        assert_eq!(next.device_id, "0123456789ab");
        assert_eq!(next.password_storage, settings::PasswordStorage::Keychain);
    }

    #[test]
    fn connecting_announces_the_device_its_cameras_and_state() {
        let mut session = session();
        let mut wall = wall(&["front_door", "garage"]);
        wall.problems.insert("garage".into());
        let messages = session.announce(&wall);
        assert_eq!(
            topics(&messages),
            [
                "ruru/0123456789ab/availability",
                "homeassistant/sensor/0123456789ab/version/config",
                "homeassistant/sensor/0123456789ab/maximised/config",
                "homeassistant/binary_sensor/0123456789ab/full_screen/config",
                "homeassistant/binary_sensor/0123456789ab/window_shown/config",
                "homeassistant/binary_sensor/0123456789ab/front_door_problem/config",
                "ruru/0123456789ab/problem/front_door",
                "homeassistant/binary_sensor/0123456789ab/garage_problem/config",
                "ruru/0123456789ab/problem/garage",
                "ruru/0123456789ab/state",
            ]
        );
        assert_eq!(messages[0].payload, "online");
        assert_eq!(messages[6].payload, "OFF");
        assert_eq!(messages[8].payload, "ON");
        assert!(messages.iter().all(|message| message.retain));
    }

    #[test]
    fn nothing_is_sent_while_disconnected() {
        let mut session = session();
        session.connected = false;
        let wall = wall(&["front_door"]);
        assert!(session.announce(&wall).is_empty());
        assert!(session.cameras_changed(&wall, false).is_empty());
        assert!(session.state(&wall).is_empty());
        assert!(session.problem("front_door", true).is_empty());
    }

    #[test]
    fn new_cameras_are_announced_and_gone_ones_removed() {
        let mut session = session();
        session.announce(&wall(&["front_door", "garage"]));
        let messages = session.cameras_changed(&wall(&["garage", "yard"]), false);
        assert_eq!(
            topics(&messages),
            [
                "homeassistant/binary_sensor/0123456789ab/front_door_problem/config",
                "homeassistant/binary_sensor/0123456789ab/yard_problem/config",
                "ruru/0123456789ab/problem/yard",
            ]
        );
        assert!(messages[0].payload.is_empty());
        // A camera Home Assistant has not been told about gets no problem state.
        assert!(session.problem("front_door", true).is_empty());
        assert_eq!(session.problem("yard", true)[0].payload, "ON");
    }

    #[test]
    fn reports_update_the_wall_and_forget_problems_of_gone_cameras() {
        let mut wall = Wall::default();
        let report = WallReport {
            maximised: Some("garage".into()),
            full_screen: true,
            window_shown: false,
            cameras: vec!["garage".into(), "yard".into()],
        };
        assert!(wall.report(report.clone()));
        assert!(!wall.report(report.clone()));
        assert_eq!(wall.state.maximised.as_deref(), Some("garage"));
        assert!(wall.state.full_screen && !wall.state.window_shown);
        assert!(wall.set_problem("yard", true));
        assert!(!wall.set_problem("yard", true));
        assert!(wall.report(WallReport {
            cameras: vec!["garage".into()],
            ..report
        }));
        assert!(!wall.problem("yard"));
        assert!(!wall.set_problem("yard", false));
    }

    #[test]
    fn reports_with_bad_camera_names_are_refused() {
        let good = WallReport {
            maximised: None,
            full_screen: false,
            window_shown: true,
            cameras: vec!["garage".into()],
        };
        assert!(validate_report(&good).is_ok());
        assert!(
            validate_report(&WallReport {
                cameras: vec![" ".into()],
                ..good.clone()
            })
            .is_err()
        );
        assert!(
            validate_report(&WallReport {
                maximised: Some(String::new()),
                ..good.clone()
            })
            .is_err()
        );
        assert!(
            validate_report(&WallReport {
                cameras: vec!["c".into(); MAX_TILES + 1],
                ..good
            })
            .is_err()
        );
    }
}
