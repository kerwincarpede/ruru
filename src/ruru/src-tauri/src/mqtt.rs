//! The connection to the MQTT broker in Home Assistant, turned on in
//! Settings › Home Assistant. Each install becomes one Home Assistant device,
//! found through MQTT discovery, with its availability, the wall's state and
//! a problem sensor per camera. It also follows Frigate's topics on the same
//! broker, so each tile can show its camera's motion, objects and alerts.
//!
//! Home Assistant controls the wall through the device's select, buttons and
//! switch: each command is checked here and handed to the page, which
//! carries it out. The device's update entity offers the update a check of
//! the saved channel finds, every six hours while connected, and installs it
//! when asked, restarting Ruru full screen. Where this computer can turn its
//! screen off, the device also has a Display switch, carried out here.
//!
//! The page reports the wall's state and each tile's problems; this module
//! keeps the latest and publishes it whenever it changes or the connection
//! comes back. The connection retries on its own, waiting longer after each
//! failure, and the broker marks the device offline through the last will
//! when Ruru goes away.

mod activity;
mod client;
mod commands;
mod discovery;
mod password;
mod topics;

use std::{
    collections::BTreeSet,
    fmt,
    sync::{Mutex, MutexGuard},
    time::{Duration, Instant},
};

use rumqttc::{AsyncClient, Event, LastWill, Packet, QoS};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, State, async_runtime::JoinHandle};

use crate::display::{self, Method};
use crate::settings::{
    self, MAX_TILES, MqttSettings, Settings, SettingsError, SharedSettings, valid_camera_name,
};
use crate::update::{self, Installed};
use activity::{Activity, FrigateTopics};
use client::Broker;
use commands::Command;
use discovery::{Device, Message, UpdateInfo, WallState};
use password::{Keychain, PasswordChange};
use topics::Topics;

/// The longest host name DNS allows.
const MAX_HOST: usize = 253;
/// The longest topic prefix Ruru accepts.
const MAX_PREFIX: usize = 100;
/// The longest username or password Ruru accepts.
const MAX_LOGIN: usize = 1024;
/// The problem sensors' discovery component and object id suffix.
const PROBLEM: (&str, &str) = ("binary_sensor", discovery::PROBLEM_SUFFIX);
/// The Reconnect buttons' discovery component and object id suffix.
const RECONNECT: (&str, &str) = ("button", discovery::RECONNECT_SUFFIX);
/// How often the update entity checks for a newer version while connected.
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
/// How often Ruru looks whether a check is due.
const CHECK_TICK: Duration = Duration::from_secs(10 * 60);

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

/// The wall as the page last reported it, and what the update check found.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Wall {
    state: WallState,
    /// Every camera on the Frigate server, in Frigate's order.
    cameras: Vec<String>,
    /// Cameras whose tile has a problem now.
    problems: BTreeSet<String>,
    /// The page has reported the cameras at least once, so a problem sensor
    /// for a camera not in `cameras` is really stale.
    reported: bool,
    update: UpdateInfo,
    /// Ruru turned the display off and has not turned it back on.
    display_off: bool,
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
    /// The cameras whose problem sensor and Reconnect button have been
    /// announced.
    announced: BTreeSet<String>,
    /// The problem sensors and Reconnect buttons the broker holds a config
    /// for, from this or an earlier run, as (component, object id).
    on_broker: BTreeSet<(String, String)>,
    /// The cameras the Maximise select offers, in order, once announced.
    options: Option<Vec<String>>,
    /// How this computer turns its screen off, if it can: only then is the
    /// Display switch offered.
    display: Option<Method>,
}

impl Session {
    fn new(topics: Topics, device: Device, display: Option<Method>) -> Self {
        Self {
            topics,
            device,
            connected: false,
            announced: BTreeSet::new(),
            on_broker: BTreeSet::new(),
            options: None,
            display,
        }
    }

    /// Everything Home Assistant needs on connecting, or when it restarts:
    /// online, the device's sensors and controls, each camera's problem
    /// sensor and Reconnect button, removals for cameras that are gone, the
    /// Display switch or its removal, and the current state.
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
        messages.extend(discovery::control_configs(&self.topics, &self.device));
        match self.display {
            Some(_) => messages.push(discovery::display_config(&self.topics, &self.device)),
            None => messages.extend(discovery::display_removal(&self.topics)),
        }
        messages.extend(self.cameras_changed(wall, true));
        messages.push(discovery::state(&self.topics, &self.device, &wall.state));
        messages.push(discovery::update_state(
            &self.topics,
            &self.device,
            &wall.update,
        ));
        messages.extend(self.display(wall));
        messages
    }

    /// The Maximise select when its cameras changed, the problem sensors and
    /// Reconnect buttons for cameras that are new, with their state, and
    /// removals for cameras that are gone. With `all`, every camera counts
    /// as new.
    fn cameras_changed(&mut self, wall: &Wall, all: bool) -> Vec<Message> {
        if !self.connected {
            return Vec::new();
        }
        let current: BTreeSet<String> = wall.cameras.iter().cloned().collect();
        let mut messages = Vec::new();
        if all || self.options.as_ref() != Some(&wall.cameras) {
            messages.push(discovery::maximise_config(
                &self.topics,
                &self.device,
                &wall.cameras,
            ));
            self.options = Some(wall.cameras.clone());
        }
        for camera in self.announced.difference(&current) {
            messages.extend(discovery::camera_removal(&self.topics, camera));
            messages.push(discovery::reconnect_removal(&self.topics, camera));
            self.on_broker
                .remove(&(PROBLEM.0.to_string(), discovery::problem_object(camera)));
            self.on_broker
                .remove(&(RECONNECT.0.to_string(), discovery::reconnect_object(camera)));
        }
        for camera in &wall.cameras {
            if all || !self.announced.contains(camera) {
                messages.push(discovery::camera_config(&self.topics, &self.device, camera));
                messages.push(discovery::problem(
                    &self.topics,
                    camera,
                    wall.problem(camera),
                ));
                messages.push(discovery::reconnect_config(
                    &self.topics,
                    &self.device,
                    camera,
                ));
            }
        }
        self.announced = current;
        messages
    }

    /// Notes a discovery config the broker sent, and removes it if it is a
    /// problem sensor or Reconnect button for a camera no longer on the wall.
    fn config_seen(&mut self, topic: &str, payload: &[u8], wall: &Wall) -> Vec<Message> {
        let Some((component, object)) =
            [PROBLEM, RECONNECT]
                .into_iter()
                .find_map(|(component, suffix)| {
                    self.topics
                        .config_object(topic, component)
                        .filter(|object| object.ends_with(suffix))
                        .map(|object| (component, object))
                })
        else {
            return Vec::new();
        };
        let key = (component.to_string(), object.to_string());
        if payload.is_empty() {
            self.on_broker.remove(&key);
        } else {
            self.on_broker.insert(key);
        }
        self.prune(wall)
    }

    /// Removes problem sensors and Reconnect buttons the broker still holds
    /// for cameras that are not on the wall, such as one hidden while Ruru
    /// was disconnected.
    fn prune(&mut self, wall: &Wall) -> Vec<Message> {
        if !self.connected || !wall.reported {
            return Vec::new();
        }
        let wanted: BTreeSet<(String, String)> = wall
            .cameras
            .iter()
            .flat_map(|camera| {
                [
                    (PROBLEM.0.to_string(), discovery::problem_object(camera)),
                    (RECONNECT.0.to_string(), discovery::reconnect_object(camera)),
                ]
            })
            .collect();
        let stale: Vec<(String, String)> = self.on_broker.difference(&wanted).cloned().collect();
        let mut messages = Vec::new();
        for key in stale {
            let (component, object) = &key;
            if component == PROBLEM.0 {
                messages.extend(discovery::stale_problem(&self.topics, object));
            } else {
                messages.push(discovery::stale_reconnect(&self.topics, object));
            }
            self.on_broker.remove(&key);
        }
        messages
    }

    fn update(&self, wall: &Wall) -> Vec<Message> {
        if !self.connected {
            return Vec::new();
        }
        vec![discovery::update_state(
            &self.topics,
            &self.device,
            &wall.update,
        )]
    }

    /// The Display switch's state, where it is offered.
    fn display(&self, wall: &Wall) -> Vec<Message> {
        if !self.connected || self.display.is_none() {
            return Vec::new();
        }
        vec![discovery::display_state(&self.topics, !wall.display_off)]
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

/// Display commands waiting to run, one at a time in the order they came.
/// Only the latest wanted state is kept: a command that has not started yet
/// is overtaken by a newer one, so the screen and the switch end up as the
/// last command asked.
#[derive(Debug, Default)]
struct DisplayQueue {
    /// The latest command not started yet.
    wanted: Option<(Method, bool)>,
    /// A worker is running commands now.
    running: bool,
}

impl DisplayQueue {
    /// Queues a command. True when no worker is running, so the caller
    /// starts one.
    fn push(&mut self, method: Method, on: bool) -> bool {
        self.wanted = Some((method, on));
        !std::mem::replace(&mut self.running, true)
    }

    /// The next command for the worker, or `None` once there is none, which
    /// stops the worker.
    fn next(&mut self) -> Option<(Method, bool)> {
        let next = self.wanted.take();
        self.running = next.is_some();
        next
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
    /// Display commands from Home Assistant, kept across connections.
    display: DisplayQueue,
    /// Bumped on every restart, so a connection that was replaced stops
    /// touching the state.
    generation: u64,
    task: Option<JoinHandle<()>>,
    /// Looks every so often whether an update check is due.
    ticker: Option<JoinHandle<()>>,
    link: Option<Link>,
    /// When the update entity last checked, kept across connections.
    last_check: Option<Instant>,
    /// A check is running now.
    checking: bool,
    /// What Frigate last said about each camera, while connected.
    activity: Activity,
}

impl Inner {
    /// The link of connection `generation`, if it is still the current one.
    fn current(&self, generation: u64) -> bool {
        self.generation == generation
    }

    fn link(&mut self, generation: u64) -> Option<(&mut Link, &Wall)> {
        if self.generation != generation {
            return None;
        }
        self.link.as_mut().map(|link| (link, &self.wall))
    }

    /// Connected to the broker now.
    fn connected(&self) -> bool {
        self.link
            .as_ref()
            .is_some_and(|link| link.session.connected)
    }

    /// Takes in how an install from Home Assistant ended, returning whether
    /// to check for updates again. A failed or refused install makes a check
    /// due now, so the update entity offers only what can be installed, such
    /// as nothing once the channel changed.
    fn install_ended(&mut self, installed: Result<Installed, String>) -> bool {
        self.wall.update.installing = false;
        match installed {
            Ok(Installed::Faked) => {
                self.wall.update.latest = None;
                false
            }
            Ok(Installed::Restarting) => false,
            Err(err) => {
                eprintln!("Ruru: {err}");
                self.last_check = None;
                true
            }
        }
    }

    /// Records that the display was turned on, or off, and tells Home
    /// Assistant on the current connection.
    fn display_done(&mut self, on: bool) {
        self.wall.display_off = !on;
        let generation = self.generation;
        if let Some((link, wall)) = self.link(generation) {
            let messages = link.session.display(wall);
            link.send(messages);
        }
    }

    /// Publishes the update entity's state on the current connection.
    fn publish_update(&mut self) {
        let generation = self.generation;
        if let Some((link, wall)) = self.link(generation) {
            let messages = link.session.update(wall);
            link.send(messages);
        }
    }
}

/// Whether the update entity should check again: never checked, or
/// `CHECK_EVERY` has passed since the last check at `now`.
fn check_due(last_check: Option<Instant>, now: Instant) -> bool {
    last_check.is_none_or(|last| now.saturating_duration_since(last) >= CHECK_EVERY)
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

/// Tells the page every camera's activity.
fn emit_activity(app: &AppHandle, activity: &Activity) {
    if let Err(err) = app.emit(activity::EVENT, activity) {
        eprintln!("Ruru: camera activity could not reach the page: {err}");
    }
}

/// Forgets Frigate's activity, if connection `generation` is still the
/// current one, and tells the page if there was any.
fn forget_activity(app: &AppHandle, generation: u64) {
    let state = app.state::<MqttState>();
    let cleared = {
        let mut inner = state.lock();
        inner.current(generation) && inner.activity.clear()
    };
    if cleared {
        emit_activity(app, &Activity::default());
    }
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
    for task in [inner.task.take(), inner.ticker.take()]
        .into_iter()
        .flatten()
    {
        task.abort();
    }
    inner.link = None;
    // What the old connection heard is gone with it.
    if inner.activity.clear() {
        emit_activity(app, &Activity::default());
    }
    if !mqtt.enabled || mqtt.host.is_empty() || mqtt.device_id.is_empty() {
        return;
    }
    let generation = inner.generation;
    let app = app.clone();
    let ticking = app.clone();
    inner.ticker = Some(tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(CHECK_TICK).await;
            check_if_due(&ticking);
        }
    }));
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
        let frigate = FrigateTopics::new(&mqtt.frigate_prefix);
        run(app, generation, broker, topics, frigate).await;
    }));
}

/// Keeps one connection up until it is replaced, publishing everything
/// again on each connect and following Frigate's activity.
async fn run(
    app: AppHandle,
    generation: u64,
    broker: Broker,
    topics: Topics,
    frigate: FrigateTopics,
) {
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
    let problem_configs = topics.configs(PROBLEM.0);
    let reconnect_configs = topics.configs(RECONNECT.0);
    let own = topics.clone();
    let display = match tauri::async_runtime::spawn_blocking(display::support).await {
        Ok(Ok(method)) => Some(method),
        Ok(Err(reason)) => {
            eprintln!("Ruru: Home Assistant gets no Display switch: {reason}");
            None
        }
        Err(err) => {
            eprintln!("Ruru: could not tell whether the display can be turned off: {err}");
            None
        }
    };
    {
        let state = app.state::<MqttState>();
        let mut inner = state.lock();
        if inner.generation != generation {
            return;
        }
        let session = Session::new(topics, Device::this_install(), display);
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
                // The retained configs show sensors and buttons left from
                // earlier runs.
                for configs in [&problem_configs, &reconnect_configs] {
                    if let Err(err) = client.try_subscribe(configs.clone(), QoS::AtLeastOnce) {
                        eprintln!("Ruru: could not read the device's discovery configs: {err}");
                    }
                }
                if let Err(err) = client.try_subscribe(own.commands(), QoS::AtLeastOnce) {
                    eprintln!("Ruru: could not follow Home Assistant's commands: {err}");
                }
                follow_frigate(&client, &frigate);
                check_if_due(&app);
            }
            // Home Assistant restarted and forgot its devices.
            Ok(Event::Incoming(Packet::Publish(publish)))
                if publish.topic == home_assistant && &publish.payload[..] == b"online" =>
            {
                announce(true);
            }
            Ok(Event::Incoming(Packet::Publish(publish))) => {
                if let Some(name) = own.command_name(&publish.topic) {
                    // A retained command would run again on every connect.
                    if !publish.retain {
                        take_command(&app, generation, name, &publish.payload);
                    }
                    continue;
                }
                if let Some(update) = frigate.parse(&publish.topic, &publish.payload) {
                    take_activity(&app, generation, update);
                    continue;
                }
                let state = app.state::<MqttState>();
                let mut inner = state.lock();
                if let Some((link, wall)) = inner.link(generation) {
                    let wall = wall.clone();
                    let messages =
                        link.session
                            .config_seen(&publish.topic, &publish.payload, &wall);
                    link.send(messages);
                }
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
                // Nothing Frigate said can be trusted until it says it again.
                forget_activity(&app, generation);
                eprintln!("Ruru: MQTT: {}", client::describe(&broker, &err));
                tokio::time::sleep(client::backoff(attempt)).await;
                attempt = attempt.saturating_add(1);
            }
        }
    }
}

/// Follows Frigate's activity topics and asks Frigate for every camera's
/// activity now. Subscribing first means the answer is not missed.
fn follow_frigate(client: &AsyncClient, frigate: &FrigateTopics) {
    for topic in frigate.subscriptions() {
        if let Err(err) = client.try_subscribe(topic, QoS::AtMostOnce) {
            eprintln!("Ruru: could not follow Frigate's activity: {err}");
        }
    }
    if let Err(err) = client.try_publish(frigate.on_connect(), QoS::AtMostOnce, false, "") {
        eprintln!("Ruru: could not ask Frigate for its activity: {err}");
    }
}

/// Takes in one message from Frigate and tells the page if anything changed.
fn take_activity(app: &AppHandle, generation: u64, update: activity::Update) {
    let state = app.state::<MqttState>();
    let changed = {
        let mut inner = state.lock();
        (inner.current(generation) && inner.activity.apply(update)).then(|| inner.activity.clone())
    };
    if let Some(activity) = changed {
        emit_activity(app, &activity);
    }
}

/// Carries out one command from Home Assistant, if it is valid: a change to
/// the wall goes to the page, Install starts installing the update, and the
/// Display switch turns the screen off or on where it is offered.
fn take_command(app: &AppHandle, generation: u64, name: &str, payload: &[u8]) {
    let (parsed, display) = {
        let state = app.state::<MqttState>();
        let inner = state.lock();
        if !inner.current(generation) {
            return;
        }
        let display = inner.link.as_ref().and_then(|link| link.session.display);
        (commands::parse(name, payload, &inner.wall.cameras), display)
    };
    match parsed {
        Ok(Command::Wall(command)) => {
            if let Err(err) = app.emit(commands::EVENT, command) {
                eprintln!("Ruru: a Home Assistant command could not reach the page: {err}");
            }
        }
        Ok(Command::Install) => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { install_from_home_assistant(app).await });
        }
        Ok(Command::Display { on }) => match display {
            Some(method) => {
                let start = app.state::<MqttState>().lock().display.push(method, on);
                if start {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move { run_display_commands(app).await });
                }
            }
            None => eprintln!("Ruru: the display can't be turned off or on here"),
        },
        Err(err) => eprintln!("Ruru: a Home Assistant command was ignored: {err}"),
    }
}

/// Runs the queued display commands one after another until none is left,
/// so two commands never run at once and finish out of order.
async fn run_display_commands(app: AppHandle) {
    loop {
        let next = app.state::<MqttState>().lock().display.next();
        let Some((method, on)) = next else {
            return;
        };
        let done = tauri::async_runtime::spawn_blocking(move || display::set(method, on)).await;
        let state = app.state::<MqttState>();
        let mut inner = state.lock();
        match done {
            Ok(Ok(())) => inner.display_done(on),
            // A failure leaves the switch as it was.
            Ok(Err(err)) => eprintln!(
                "Ruru: the display could not be turned {}: {err}",
                discovery::on_off(on).to_ascii_lowercase()
            ),
            Err(err) => eprintln!("Ruru: the display could not be turned off or on: {err}"),
        }
    }
}

/// Starts an update check for the update entity when connected and one is
/// due, unless one is running.
fn check_if_due(app: &AppHandle) {
    {
        let state = app.state::<MqttState>();
        let mut inner = state.lock();
        if inner.checking || !inner.connected() || !check_due(inner.last_check, Instant::now()) {
            return;
        }
        inner.checking = true;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move { check_for_update(app).await });
}

/// Checks for a newer version and tells Home Assistant what was found. A
/// failed check keeps what the last one found.
async fn check_for_update(app: AppHandle) {
    let found = update::check_for_home_assistant(&app).await;
    let state = app.state::<MqttState>();
    let mut inner = state.lock();
    inner.checking = false;
    inner.last_check = Some(Instant::now());
    match found {
        Ok(latest) if latest != inner.wall.update.latest => {
            inner.wall.update.latest = latest;
            inner.publish_update();
        }
        Ok(_) => {}
        Err(err) => eprintln!("Ruru: {err}"),
    }
}

/// Installs the update because Home Assistant asked, showing it in progress
/// meanwhile. A real update restarts Ruru full screen; the fake one leaves
/// it running, as though it were up to date.
async fn install_from_home_assistant(app: AppHandle) {
    {
        let state = app.state::<MqttState>();
        let mut inner = state.lock();
        if inner.wall.update.installing {
            return;
        }
        inner.wall.update.installing = true;
        inner.publish_update();
    }
    let installed = update::install_for_home_assistant(&app).await;
    let check_again = {
        let state = app.state::<MqttState>();
        let mut inner = state.lock();
        let check_again = inner.install_ended(installed);
        inner.publish_update();
        check_again
    };
    if check_again {
        check_if_due(&app);
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
        self.reported = true;
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
        messages.extend(link.session.prune(&wall));
        messages.extend(link.session.state(&wall));
        link.send(messages);
    }
    Ok(())
}

/// Every camera's activity as Frigate last told it, for a page that has
/// just started listening for changes.
#[tauri::command]
pub fn camera_activity(state: State<'_, MqttState>) -> Activity {
    state.lock().activity.clone()
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
        session_with(None)
    }

    fn session_with(display: Option<Method>) -> Session {
        let mut session = Session::new(
            Topics::new("0123456789ab", "homeassistant"),
            Device {
                name: "Ruru".into(),
                version: "1.2.3".into(),
            },
            display,
        );
        session.connected = true;
        session
    }

    fn wall(cameras: &[&str]) -> Wall {
        Wall {
            cameras: cameras.iter().map(|name| name.to_string()).collect(),
            reported: true,
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
                "homeassistant/button/0123456789ab/restore/config",
                "homeassistant/switch/0123456789ab/full_screen/config",
                "homeassistant/update/0123456789ab/update/config",
                "homeassistant/switch/0123456789ab/display/config",
                "ruru/0123456789ab/display",
                "homeassistant/select/0123456789ab/maximise/config",
                "homeassistant/binary_sensor/0123456789ab/front_door_problem/config",
                "ruru/0123456789ab/problem/front_door",
                "homeassistant/button/0123456789ab/front_door_reconnect/config",
                "homeassistant/binary_sensor/0123456789ab/garage_problem/config",
                "ruru/0123456789ab/problem/garage",
                "homeassistant/button/0123456789ab/garage_reconnect/config",
                "ruru/0123456789ab/state",
                "ruru/0123456789ab/update",
            ]
        );
        assert_eq!(messages[0].payload, "online");
        assert_eq!(messages[12].payload, "OFF");
        assert_eq!(messages[15].payload, "ON");
        assert!(messages.iter().all(|message| message.retain));
        // Without a way to turn the screen off, the Display switch is
        // removed rather than offered, and its state an earlier run left
        // is cleared too.
        assert!(messages[8].payload.is_empty());
        assert!(messages[9].payload.is_empty());
    }

    #[test]
    fn display_commands_run_one_at_a_time_and_the_latest_wins() {
        let mut queue = DisplayQueue::default();
        assert!(queue.push(Method::X11, false), "the first starts a worker");
        assert_eq!(queue.next(), Some((Method::X11, false)));
        // OFF is running; ON and OFF and ON come in before it finishes.
        assert!(!queue.push(Method::X11, true), "one worker at a time");
        assert!(!queue.push(Method::X11, false));
        assert!(!queue.push(Method::X11, true));
        let mut inner = Inner::default();
        inner.display_done(false);
        assert!(inner.wall.display_off);
        // Only the last command runs next, so its state is what stays.
        assert_eq!(queue.next(), Some((Method::X11, true)));
        inner.display_done(true);
        assert!(!inner.wall.display_off);
        assert_eq!(queue.next(), None);
        assert!(queue.push(Method::X11, false), "an idle queue starts again");
    }

    #[test]
    fn the_display_switch_is_offered_where_the_screen_can_be_turned_off() {
        let mut session = session_with(Some(Method::X11));
        let mut wall = wall(&[]);
        let messages = session.announce(&wall);
        let config = messages
            .iter()
            .find(|message| message.topic == "homeassistant/switch/0123456789ab/display/config")
            .unwrap();
        assert!(!config.payload.is_empty());
        let state = messages.last().unwrap();
        assert_eq!(state.topic, "ruru/0123456789ab/display");
        assert_eq!(state.payload, "ON");
        wall.display_off = true;
        assert_eq!(
            topics(&session.display(&wall)),
            ["ruru/0123456789ab/display"]
        );
        assert_eq!(session.display(&wall)[0].payload, "OFF");
        assert!(session_with(None).display(&wall).is_empty());
        session.connected = false;
        assert!(session.display(&wall).is_empty());
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
        assert!(session.update(&wall).is_empty());
    }

    #[test]
    fn new_cameras_are_announced_and_gone_ones_removed() {
        let mut session = session();
        session.announce(&wall(&["front_door", "garage"]));
        let messages = session.cameras_changed(&wall(&["garage", "yard"]), false);
        assert_eq!(
            topics(&messages),
            [
                "homeassistant/select/0123456789ab/maximise/config",
                "homeassistant/binary_sensor/0123456789ab/front_door_problem/config",
                "ruru/0123456789ab/problem/front_door",
                "homeassistant/button/0123456789ab/front_door_reconnect/config",
                "homeassistant/binary_sensor/0123456789ab/yard_problem/config",
                "ruru/0123456789ab/problem/yard",
                "homeassistant/button/0123456789ab/yard_reconnect/config",
            ]
        );
        assert!(messages[0].payload.contains(r#"["none","garage","yard"]"#));
        // The hidden camera loses its config, its retained state and its button.
        assert!(messages[1..4].iter().all(|m| m.payload.is_empty()));
        // A camera Home Assistant has not been told about gets no problem state.
        assert!(session.problem("front_door", true).is_empty());
        assert_eq!(session.problem("yard", true)[0].payload, "ON");
    }

    #[test]
    fn sensors_left_from_an_earlier_run_are_removed_once_the_wall_is_known() {
        let mut session = session();
        let config = "homeassistant/binary_sensor/0123456789ab/garage_problem/config";
        // Before the page reports its cameras, nothing is judged stale.
        let unknown = Wall::default();
        session.announce(&unknown);
        assert!(session.config_seen(config, b"{}", &unknown).is_empty());
        // Once it has, a camera that is not on the wall loses its sensor and state.
        let shown = wall(&["front_door"]);
        let messages = session.prune(&shown);
        assert_eq!(
            topics(&messages),
            [config, "ruru/0123456789ab/problem/garage"]
        );
        assert!(messages.iter().all(|m| m.retain && m.payload.is_empty()));
        assert!(session.prune(&shown).is_empty());
        // A camera on the wall, other entities and other devices are left alone.
        let front = "homeassistant/binary_sensor/0123456789ab/front_door_problem/config";
        assert!(session.config_seen(front, b"{}", &shown).is_empty());
        let full = "homeassistant/binary_sensor/0123456789ab/full_screen/config";
        assert!(session.config_seen(full, b"{}", &shown).is_empty());
        let other = "homeassistant/binary_sensor/ffffffffffff/garage_problem/config";
        assert!(session.config_seen(other, b"{}", &shown).is_empty());
        // Hiding it later removes it, and its echoed removal is forgotten.
        let messages = session.prune(&wall(&[]));
        assert_eq!(topics(&messages)[0], front);
        assert!(session.config_seen(front, b"", &wall(&[])).is_empty());
    }

    #[test]
    fn reconnect_buttons_left_from_an_earlier_run_are_removed_too() {
        let mut session = session();
        let shown = wall(&["front_door"]);
        session.announce(&shown);
        let stale = "homeassistant/button/0123456789ab/garage_reconnect/config";
        let messages = session.config_seen(stale, b"{}", &shown);
        assert_eq!(topics(&messages), [stale]);
        assert!(messages[0].retain && messages[0].payload.is_empty());
        // The camera's own button and the Restore button stay.
        let front = "homeassistant/button/0123456789ab/front_door_reconnect/config";
        assert!(session.config_seen(front, b"{}", &shown).is_empty());
        let restore = "homeassistant/button/0123456789ab/restore/config";
        assert!(session.config_seen(restore, b"{}", &shown).is_empty());
        // Hiding the camera removes its button without pruning it twice.
        let messages = session.cameras_changed(&wall(&[]), false);
        assert!(topics(&messages).contains(&front));
        assert!(session.prune(&wall(&[])).is_empty());
    }

    #[test]
    fn the_maximise_select_follows_the_wall_s_order() {
        let mut session = session();
        session.announce(&wall(&["front_door", "garage"]));
        assert!(
            session
                .cameras_changed(&wall(&["front_door", "garage"]), false)
                .is_empty()
        );
        let messages = session.cameras_changed(&wall(&["garage", "front_door"]), false);
        assert_eq!(
            topics(&messages),
            ["homeassistant/select/0123456789ab/maximise/config"]
        );
        assert!(
            messages[0]
                .payload
                .contains(r#"["none","garage","front_door"]"#)
        );
    }

    #[test]
    fn the_update_entity_hears_what_the_check_found() {
        let session = session();
        let mut wall = wall(&[]);
        wall.update.latest = Some("9.9.9".into());
        let messages = session.update(&wall);
        assert_eq!(topics(&messages), ["ruru/0123456789ab/update"]);
        assert!(messages[0].payload.contains(r#""latest_version":"9.9.9""#));
    }

    #[test]
    fn a_failed_install_makes_a_check_due_and_keeps_the_offer_until_then() {
        let mut inner = Inner {
            last_check: Some(Instant::now()),
            ..Inner::default()
        };
        inner.wall.update = UpdateInfo {
            latest: Some("9.9.9".into()),
            installing: true,
        };
        assert!(inner.install_ended(Err("The update channel changed.".into())));
        assert!(!inner.wall.update.installing);
        assert!(check_due(inner.last_check, Instant::now()));
        // The check that follows decides what is offered.
        assert_eq!(inner.wall.update.latest.as_deref(), Some("9.9.9"));
    }

    #[test]
    fn a_fake_install_shows_the_wall_up_to_date() {
        let mut inner = Inner::default();
        inner.wall.update = UpdateInfo {
            latest: Some("9.9.9".into()),
            installing: true,
        };
        assert!(!inner.install_ended(Ok(Installed::Faked)));
        assert_eq!(inner.wall.update, UpdateInfo::default());
        assert!(!inner.install_ended(Ok(Installed::Restarting)));
    }

    #[test]
    fn the_update_check_is_due_every_six_hours() {
        let now = Instant::now();
        assert!(check_due(None, now));
        assert!(!check_due(Some(now), now));
        let later = now + CHECK_EVERY;
        assert!(check_due(Some(now), later));
        assert!(!check_due(Some(now), later - Duration::from_secs(1)));
        // A clock that seems to go backwards never makes a check due.
        assert!(!check_due(Some(later), now));
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
