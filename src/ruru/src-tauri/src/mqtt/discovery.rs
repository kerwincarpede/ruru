//! Home Assistant MQTT discovery: the retained configs that make one install
//! a device with its state sensors, a problem sensor and Reconnect button per
//! camera, the wall's controls, an update entity and, where Ruru can turn the
//! screen off, a Display switch, and the state they read.

use serde_json::{Value, json};

use super::commands::{
    DISPLAY, FULL_SCREEN, INSTALL, INSTALL_PAYLOAD, MAXIMISE, NONE, PRESS, RECONNECT, RESTORE,
};
use super::topics::{Topics, object_id};

/// Where Home Assistant links the device's "Visit" button.
const SUPPORT_URL: &str = "https://kerwincarpede.github.io/ruru/";
/// Where the update entity links its release notes.
const RELEASES_URL: &str = "https://github.com/kerwincarpede/ruru/releases";

/// One message to publish.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    pub topic: String,
    pub payload: String,
    pub retain: bool,
}

impl Message {
    fn retained(topic: String, payload: impl Into<String>) -> Self {
        Self {
            topic,
            payload: payload.into(),
            retain: true,
        }
    }
}

/// The device as Home Assistant shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Device {
    /// "Ruru on <computer name>", or "Ruru" when the name is not known.
    pub name: String,
    pub version: String,
}

impl Device {
    /// This install, named after the computer it runs on.
    pub fn this_install() -> Self {
        Self {
            name: device_name(computer_name().as_deref()),
            version: env!("CARGO_PKG_VERSION").into(),
        }
    }
}

/// The device's name for a computer called `computer`.
pub fn device_name(computer: Option<&str>) -> String {
    match computer.map(str::trim).filter(|name| !name.is_empty()) {
        Some(name) => format!("Ruru on {name}"),
        None => "Ruru".into(),
    }
}

/// The computer's name, as the system reports it, without a `.local` or
/// other domain suffix.
fn computer_name() -> Option<String> {
    short_name(&gethostname::gethostname().to_string_lossy())
}

/// A host name up to its first dot, or `None` when it is blank.
fn short_name(host: &str) -> Option<String> {
    let name = host.trim().split('.').next().unwrap_or_default().trim();
    (!name.is_empty()).then(|| name.to_string())
}

/// A camera name as people read it: `front_yard` is "Front yard". The same
/// as `cameraLabel` in `src/app/frigate.ts`.
pub fn camera_label(name: &str) -> String {
    let words = name
        .split(['_', '-'])
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let mut chars = words.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// What every one of the device's entities shares.
fn base(
    topics: &Topics,
    device: &Device,
    object: &str,
    name: &str,
) -> serde_json::Map<String, Value> {
    let id = topics.device_id();
    let config = json!({
        "name": name,
        "unique_id": format!("ruru_{id}_{}", object_id(object)),
        "availability_topic": topics.availability(),
        "device": {
            "identifiers": [format!("ruru_{id}")],
            "name": device.name,
            "manufacturer": "Ruru",
            "model": "Ruru camera wall",
            "sw_version": device.version,
        },
        "origin": {
            "name": "Ruru",
            "sw_version": device.version,
            "support_url": SUPPORT_URL,
        },
    });
    match config {
        Value::Object(map) => map,
        _ => unreachable!("json! of an object is an object"),
    }
}

/// One entity reading a field of the state topic.
fn state_entity(
    topics: &Topics,
    device: &Device,
    component: &str,
    object: &str,
    name: &str,
    extra: Value,
) -> Message {
    let mut config = base(topics, device, object, name);
    config.insert("state_topic".into(), topics.state().into());
    config.insert(
        "value_template".into(),
        format!("{{{{ value_json.{object} }}}}").into(),
    );
    if let Value::Object(extra) = extra {
        config.extend(extra);
    }
    Message::retained(
        topics.discovery(component, object),
        Value::Object(config).to_string(),
    )
}

/// The device's own entities: its version, the maximised camera, and
/// whether the window is full screen and shown.
pub fn device_configs(topics: &Topics, device: &Device) -> Vec<Message> {
    vec![
        state_entity(
            topics,
            device,
            "sensor",
            "version",
            "Version",
            json!({ "entity_category": "diagnostic", "icon": "mdi:tag" }),
        ),
        state_entity(
            topics,
            device,
            "sensor",
            "maximised",
            "Maximised camera",
            json!({ "icon": "mdi:cctv" }),
        ),
        state_entity(
            topics,
            device,
            "binary_sensor",
            "full_screen",
            "Full screen",
            json!({ "payload_on": "ON", "payload_off": "OFF", "icon": "mdi:fullscreen" }),
        ),
        state_entity(
            topics,
            device,
            "binary_sensor",
            "window_shown",
            "Window shown",
            json!({ "payload_on": "ON", "payload_off": "OFF", "icon": "mdi:monitor" }),
        ),
    ]
}

/// What ends the discovery object id of every problem sensor.
pub const PROBLEM_SUFFIX: &str = "_problem";

/// The wall's controls that do not depend on the cameras: the Restore button,
/// the Full screen switch and the update entity.
pub fn control_configs(topics: &Topics, device: &Device) -> Vec<Message> {
    let mut restore = base(topics, device, RESTORE, "Restore");
    restore.insert("command_topic".into(), topics.command(RESTORE).into());
    restore.insert("payload_press".into(), PRESS.into());
    restore.insert("icon".into(), "mdi:view-grid".into());
    let mut update = base(topics, device, "update", "Update");
    update.insert("state_topic".into(), topics.update().into());
    update.insert("command_topic".into(), topics.command(INSTALL).into());
    update.insert("payload_install".into(), INSTALL_PAYLOAD.into());
    vec![
        Message::retained(
            topics.discovery("button", RESTORE),
            Value::Object(restore).to_string(),
        ),
        state_entity(
            topics,
            device,
            "switch",
            FULL_SCREEN,
            "Full screen",
            json!({
                "command_topic": topics.command(FULL_SCREEN),
                "payload_on": "ON",
                "payload_off": "OFF",
                "state_on": "ON",
                "state_off": "OFF",
                "icon": "mdi:fullscreen",
            }),
        ),
        Message::retained(
            topics.discovery("update", "update"),
            Value::Object(update).to_string(),
        ),
    ]
}

/// The switch that turns the display off and on. Offered only where Ruru
/// can do it; it reads the display topic.
pub fn display_config(topics: &Topics, device: &Device) -> Message {
    let mut config = base(topics, device, DISPLAY, "Display");
    config.insert("state_topic".into(), topics.display().into());
    config.insert("command_topic".into(), topics.command(DISPLAY).into());
    config.insert("payload_on".into(), "ON".into());
    config.insert("payload_off".into(), "OFF".into());
    config.insert("state_on".into(), "ON".into());
    config.insert("state_off".into(), "OFF".into());
    config.insert("icon".into(), "mdi:monitor-shimmer".into());
    Message::retained(
        topics.discovery("switch", DISPLAY),
        Value::Object(config).to_string(),
    )
}

/// Removes the Display switch from Home Assistant, where Ruru can't turn
/// the screen off, in case an earlier run offered it.
pub fn display_removal(topics: &Topics) -> Message {
    Message::retained(topics.discovery("switch", DISPLAY), "")
}

/// The retained message the Display switch reads.
pub fn display_state(topics: &Topics, on: bool) -> Message {
    Message::retained(topics.display(), on_off(on))
}

/// The select that maximises a camera: `none`, then each camera on the wall
/// in its order. It reads the maximised camera from the state topic.
pub fn maximise_config(topics: &Topics, device: &Device, cameras: &[String]) -> Message {
    let mut config = base(topics, device, MAXIMISE, "Maximise");
    let options: Vec<&str> = std::iter::once(NONE)
        .chain(cameras.iter().map(String::as_str))
        .collect();
    config.insert("state_topic".into(), topics.state().into());
    config.insert("value_template".into(), "{{ value_json.maximised }}".into());
    config.insert("command_topic".into(), topics.command(MAXIMISE).into());
    config.insert("options".into(), options.into());
    config.insert("icon".into(), "mdi:arrow-expand-all".into());
    Message::retained(
        topics.discovery("select", MAXIMISE),
        Value::Object(config).to_string(),
    )
}

/// What ends the discovery object id of every Reconnect button.
pub const RECONNECT_SUFFIX: &str = "_reconnect";

/// The discovery object of a camera's Reconnect button.
pub fn reconnect_object(camera: &str) -> String {
    format!("{}{RECONNECT_SUFFIX}", object_id(camera))
}

/// The button that reconnects one camera's tile. It sends the camera's
/// name on the shared reconnect topic.
pub fn reconnect_config(topics: &Topics, device: &Device, camera: &str) -> Message {
    let object = reconnect_object(camera);
    let mut config = base(
        topics,
        device,
        &object,
        &format!("Reconnect {}", camera_label(camera)),
    );
    config.insert("command_topic".into(), topics.command(RECONNECT).into());
    config.insert("payload_press".into(), camera.into());
    config.insert("icon".into(), "mdi:refresh".into());
    Message::retained(
        topics.discovery("button", &object),
        Value::Object(config).to_string(),
    )
}

/// Removes a camera's Reconnect button from Home Assistant.
pub fn reconnect_removal(topics: &Topics, camera: &str) -> Message {
    stale_reconnect(topics, &reconnect_object(camera))
}

/// Removes a Reconnect button known only by its object id, such as one left
/// on the broker by an earlier run.
pub fn stale_reconnect(topics: &Topics, object: &str) -> Message {
    Message::retained(topics.discovery("button", object), "")
}

/// The discovery object of a camera's problem sensor.
pub fn problem_object(camera: &str) -> String {
    format!("{}{PROBLEM_SUFFIX}", object_id(camera))
}

/// The problem sensor for one camera: on while its tile can't play or has
/// been reconnecting for a while.
pub fn camera_config(topics: &Topics, device: &Device, camera: &str) -> Message {
    let object = problem_object(camera);
    let mut config = base(
        topics,
        device,
        &object,
        &format!("{} problem", camera_label(camera)),
    );
    config.insert("state_topic".into(), topics.problem(camera).into());
    config.insert("device_class".into(), "problem".into());
    config.insert("payload_on".into(), "ON".into());
    config.insert("payload_off".into(), "OFF".into());
    Message::retained(
        topics.discovery("binary_sensor", &object),
        Value::Object(config).to_string(),
    )
}

/// Removes a camera's problem sensor from Home Assistant, and its retained
/// state from the broker.
pub fn camera_removal(topics: &Topics, camera: &str) -> Vec<Message> {
    stale_problem(topics, &problem_object(camera))
}

/// Removes a problem sensor known only by its object id, such as one left
/// on the broker by an earlier run: its config and its retained state.
pub fn stale_problem(topics: &Topics, object: &str) -> Vec<Message> {
    let camera = object.strip_suffix(PROBLEM_SUFFIX).unwrap_or(object);
    vec![
        Message::retained(topics.discovery("binary_sensor", object), ""),
        Message::retained(topics.problem(camera), ""),
    ]
}

/// `ON` or `OFF`, as the binary sensors read them.
pub fn on_off(on: bool) -> &'static str {
    if on { "ON" } else { "OFF" }
}

/// The wall as the state sensors read it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WallState {
    /// The camera filling the window, if any.
    pub maximised: Option<String>,
    pub full_screen: bool,
    /// The window is on screen: not minimised or hidden.
    pub window_shown: bool,
}

impl Default for WallState {
    fn default() -> Self {
        Self {
            maximised: None,
            full_screen: false,
            window_shown: true,
        }
    }
}

/// The retained state message every state sensor reads.
pub fn state(topics: &Topics, device: &Device, wall: &WallState) -> Message {
    let payload = json!({
        "version": device.version,
        "maximised": wall.maximised.as_deref().unwrap_or("none"),
        "full_screen": on_off(wall.full_screen),
        "window_shown": on_off(wall.window_shown),
    });
    Message::retained(topics.state(), payload.to_string())
}

/// What the update entity shows.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UpdateInfo {
    /// The newer version the last check found, if any.
    pub latest: Option<String>,
    /// Installing it now, as Home Assistant asked.
    pub installing: bool,
}

/// The retained message the update entity reads. Without a newer version,
/// the latest is the version running.
pub fn update_state(topics: &Topics, device: &Device, update: &UpdateInfo) -> Message {
    let latest = update.latest.as_deref().unwrap_or(&device.version);
    let release_url = match &update.latest {
        Some(version) => format!("{RELEASES_URL}/tag/v{version}"),
        None => RELEASES_URL.to_string(),
    };
    let payload = json!({
        "installed_version": device.version,
        "latest_version": latest,
        "title": "Ruru",
        "release_url": release_url,
        "in_progress": update.installing,
    });
    Message::retained(topics.update(), payload.to_string())
}

/// The retained message for a camera's problem sensor.
pub fn problem(topics: &Topics, camera: &str, problem: bool) -> Message {
    Message::retained(topics.problem(camera), on_off(problem))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(text: &str) -> Value {
        serde_json::from_str(text).unwrap()
    }

    fn topics() -> Topics {
        Topics::new("0123456789ab", "homeassistant")
    }

    fn device() -> Device {
        Device {
            name: device_name(Some("wall")),
            version: "1.2.3".into(),
        }
    }

    fn payload(message: &Message) -> Value {
        serde_json::from_str(&message.payload).unwrap()
    }

    #[test]
    fn the_device_has_version_maximised_full_screen_and_window_sensors() {
        let configs = device_configs(&topics(), &device());
        let topics: Vec<&str> = configs.iter().map(|m| m.topic.as_str()).collect();
        assert_eq!(
            topics,
            [
                "homeassistant/sensor/0123456789ab/version/config",
                "homeassistant/sensor/0123456789ab/maximised/config",
                "homeassistant/binary_sensor/0123456789ab/full_screen/config",
                "homeassistant/binary_sensor/0123456789ab/window_shown/config",
            ]
        );
        assert!(configs.iter().all(|m| m.retain));
        assert_eq!(
            payload(&configs[2]),
            fixture(include_str!("fixtures/discovery-full-screen.json"))
        );
        // Every entity belongs to the one device and follows its availability.
        for config in &configs {
            let config = payload(config);
            assert_eq!(config["device"]["identifiers"][0], "ruru_0123456789ab");
            assert_eq!(
                config["availability_topic"],
                "ruru/0123456789ab/availability"
            );
            assert_eq!(config["state_topic"], "ruru/0123456789ab/state");
        }
    }

    #[test]
    fn each_camera_has_a_problem_sensor() {
        let config = camera_config(&topics(), &device(), "front_door");
        assert_eq!(
            config.topic,
            "homeassistant/binary_sensor/0123456789ab/front_door_problem/config"
        );
        assert!(config.retain);
        assert_eq!(
            payload(&config),
            fixture(include_str!("fixtures/discovery-problem.json"))
        );
        let removal = camera_removal(&topics(), "front_door");
        let removed: Vec<&str> = removal.iter().map(|m| m.topic.as_str()).collect();
        assert_eq!(
            removed,
            [
                config.topic.as_str(),
                "ruru/0123456789ab/problem/front_door"
            ]
        );
        assert!(removal.iter().all(|m| m.retain && m.payload.is_empty()));
    }

    #[test]
    fn the_wall_has_restore_full_screen_and_update_controls() {
        let configs = control_configs(&topics(), &device());
        let topics: Vec<&str> = configs.iter().map(|m| m.topic.as_str()).collect();
        assert_eq!(
            topics,
            [
                "homeassistant/button/0123456789ab/restore/config",
                "homeassistant/switch/0123456789ab/full_screen/config",
                "homeassistant/update/0123456789ab/update/config",
            ]
        );
        assert!(configs.iter().all(|m| m.retain));
        assert_eq!(
            payload(&configs[0]),
            fixture(include_str!("fixtures/discovery-restore.json"))
        );
        assert_eq!(
            payload(&configs[1]),
            fixture(include_str!("fixtures/discovery-full-screen-switch.json"))
        );
        assert_eq!(
            payload(&configs[2]),
            fixture(include_str!("fixtures/discovery-update.json"))
        );
    }

    #[test]
    fn the_display_switch_reads_and_sets_the_display() {
        let config = display_config(&topics(), &device());
        assert_eq!(
            config.topic,
            "homeassistant/switch/0123456789ab/display/config"
        );
        assert!(config.retain);
        assert_eq!(
            payload(&config),
            fixture(include_str!("fixtures/discovery-display.json"))
        );
        let removal = display_removal(&topics());
        assert_eq!(removal.topic, config.topic);
        assert!(removal.retain && removal.payload.is_empty());
        let off = display_state(&topics(), false);
        assert_eq!(off.topic, "ruru/0123456789ab/display");
        assert!(off.retain);
        assert_eq!(off.payload, "OFF");
        assert_eq!(display_state(&topics(), true).payload, "ON");
    }

    #[test]
    fn the_maximise_select_offers_none_and_each_camera() {
        let config = maximise_config(
            &topics(),
            &device(),
            &["front_door".into(), "garage".into()],
        );
        assert_eq!(
            config.topic,
            "homeassistant/select/0123456789ab/maximise/config"
        );
        assert!(config.retain);
        assert_eq!(
            payload(&config),
            fixture(include_str!("fixtures/discovery-maximise.json"))
        );
        let empty = maximise_config(&topics(), &device(), &[]);
        assert_eq!(payload(&empty)["options"], json!(["none"]));
    }

    #[test]
    fn each_camera_has_a_reconnect_button() {
        let config = reconnect_config(&topics(), &device(), "front_door");
        assert_eq!(
            config.topic,
            "homeassistant/button/0123456789ab/front_door_reconnect/config"
        );
        assert_eq!(
            payload(&config),
            fixture(include_str!("fixtures/discovery-reconnect.json"))
        );
        let removal = reconnect_removal(&topics(), "front_door");
        assert_eq!(removal.topic, config.topic);
        assert!(removal.retain && removal.payload.is_empty());
    }

    #[test]
    fn the_update_entity_reads_the_installed_and_latest_versions() {
        let topics = topics();
        let pending = UpdateInfo {
            latest: Some("1.3.0".into()),
            installing: true,
        };
        let message = update_state(&topics, &device(), &pending);
        assert_eq!(message.topic, "ruru/0123456789ab/update");
        assert!(message.retain);
        assert_eq!(
            payload(&message),
            json!({
                "installed_version": "1.2.3",
                "latest_version": "1.3.0",
                "title": "Ruru",
                "release_url": "https://github.com/kerwincarpede/ruru/releases/tag/v1.3.0",
                "in_progress": true,
            })
        );
        let current = payload(&update_state(&topics, &device(), &UpdateInfo::default()));
        assert_eq!(current["latest_version"], "1.2.3");
        assert_eq!(current["in_progress"], false);
        assert_eq!(current["release_url"], RELEASES_URL);
    }

    #[test]
    fn the_state_is_one_retained_json_object() {
        let topics = topics();
        let wall = WallState {
            maximised: Some("front_door".into()),
            full_screen: true,
            window_shown: false,
        };
        let message = state(&topics, &device(), &wall);
        assert_eq!(message.topic, "ruru/0123456789ab/state");
        assert!(message.retain);
        assert_eq!(
            payload(&message),
            json!({"version": "1.2.3", "maximised": "front_door", "full_screen": "ON", "window_shown": "OFF"})
        );
        let idle = state(&topics, &device(), &WallState::default());
        assert_eq!(payload(&idle)["maximised"], "none");
        assert_eq!(payload(&idle)["window_shown"], "ON");
    }

    #[test]
    fn problems_are_on_or_off() {
        let on = problem(&topics(), "front_door", true);
        assert_eq!(on.topic, "ruru/0123456789ab/problem/front_door");
        assert_eq!(on.payload, "ON");
        assert_eq!(problem(&topics(), "front_door", false).payload, "OFF");
    }

    #[test]
    fn the_device_is_named_after_the_computer() {
        assert_eq!(device_name(Some(" kitchen-pi\n")), "Ruru on kitchen-pi");
        assert_eq!(device_name(Some("")), "Ruru");
        assert_eq!(device_name(None), "Ruru");
        assert_eq!(Device::this_install().version, env!("CARGO_PKG_VERSION"));
        assert_eq!(
            short_name("Kerwins-Mac.local").as_deref(),
            Some("Kerwins-Mac")
        );
        assert_eq!(short_name(" kitchen-pi\n").as_deref(), Some("kitchen-pi"));
        assert_eq!(short_name(""), None);
        assert_eq!(short_name(".local"), None);
    }

    #[test]
    fn camera_labels_read_like_frigate_s() {
        assert_eq!(camera_label("front_yard"), "Front yard");
        assert_eq!(camera_label("back-door_2"), "Back door 2");
        assert_eq!(camera_label("__"), "");
    }
}
