//! The MQTT topics one install publishes and listens on. Everything Ruru
//! owns sits under `ruru/<device id>/`; discovery sits under Home
//! Assistant's prefix.

/// The first level of every topic Ruru owns.
pub const ROOT: &str = "ruru";

/// What a topic level may hold: no wildcards, separators or nulls, and no
/// spaces, so the same name works as a Home Assistant object id.
pub fn object_id(name: &str) -> String {
    let id: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();
    if id.is_empty() { "_".into() } else { id }
}

/// The topics for one install.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Topics {
    device_id: String,
    discovery_prefix: String,
}

impl Topics {
    pub fn new(device_id: &str, discovery_prefix: &str) -> Self {
        Self {
            device_id: object_id(device_id),
            discovery_prefix: discovery_prefix.trim_matches('/').to_string(),
        }
    }

    /// The id Home Assistant knows this install by.
    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    pub(crate) fn own(&self, rest: &str) -> String {
        format!("{ROOT}/{}/{rest}", self.device_id)
    }

    /// `online` while Ruru is connected; the broker sets `offline`, the last
    /// will, when the connection drops.
    pub fn availability(&self) -> String {
        self.own("availability")
    }

    /// The wall's state as one JSON object, read by every state sensor.
    pub fn state(&self) -> String {
        self.own("state")
    }

    /// `ON` while the camera's tile has a problem, `OFF` otherwise.
    pub fn problem(&self, camera: &str) -> String {
        self.own(&format!("problem/{}", object_id(camera)))
    }

    /// What the update check found, as one JSON object, read by the update
    /// entity.
    pub fn update(&self) -> String {
        self.own("update")
    }

    /// `ON` or `OFF`, as Ruru last turned the display, read by the Display
    /// switch.
    pub fn display(&self) -> String {
        self.own("display")
    }

    /// Where Home Assistant sends command `name`, such as `maximise`.
    pub fn command(&self, name: &str) -> String {
        self.own(&format!("command/{name}"))
    }

    /// Every command topic, to subscribe to.
    pub fn commands(&self) -> String {
        self.command("+")
    }

    /// The command a message on `topic` carries, if it is one of this
    /// install's command topics.
    pub fn command_name<'a>(&self, topic: &'a str) -> Option<&'a str> {
        topic
            .strip_prefix(ROOT)?
            .strip_prefix('/')?
            .strip_prefix(self.device_id.as_str())?
            .strip_prefix("/command/")
            .filter(|name| !name.is_empty() && !name.contains('/'))
    }

    /// Where one entity's discovery config is retained.
    pub fn discovery(&self, component: &str, object: &str) -> String {
        format!(
            "{}/{component}/{}/{}/config",
            self.discovery_prefix,
            self.device_id,
            object_id(object)
        )
    }

    /// Every discovery config of `component` for this device, as a
    /// subscription filter.
    pub fn configs(&self, component: &str) -> String {
        format!(
            "{}/{component}/{}/+/config",
            self.discovery_prefix, self.device_id
        )
    }

    /// The object id in one of this device's `component` discovery topics.
    pub fn config_object<'a>(&self, topic: &'a str, component: &str) -> Option<&'a str> {
        let object = topic
            .strip_prefix(self.discovery_prefix.as_str())?
            .strip_prefix('/')?
            .strip_prefix(component)?
            .strip_prefix('/')?
            .strip_prefix(self.device_id.as_str())?
            .strip_prefix('/')?
            .strip_suffix("/config")?;
        (!object.is_empty() && !object.contains('/')).then_some(object)
    }

    /// Home Assistant says `online` here when it starts, asking for
    /// discovery again.
    pub fn home_assistant_status(&self) -> String {
        format!("{}/status", self.discovery_prefix)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn topics_sit_under_ruru_and_the_device_id() {
        let topics = Topics::new("0123456789ab", "homeassistant");
        assert_eq!(topics.availability(), "ruru/0123456789ab/availability");
        assert_eq!(topics.state(), "ruru/0123456789ab/state");
        assert_eq!(
            topics.problem("front_door"),
            "ruru/0123456789ab/problem/front_door"
        );
        assert_eq!(topics.home_assistant_status(), "homeassistant/status");
        assert_eq!(topics.update(), "ruru/0123456789ab/update");
        assert_eq!(topics.display(), "ruru/0123456789ab/display");
        assert_eq!(
            topics.command("maximise"),
            "ruru/0123456789ab/command/maximise"
        );
        assert_eq!(topics.commands(), "ruru/0123456789ab/command/+");
    }

    #[test]
    fn only_this_install_s_command_topics_carry_commands() {
        let topics = Topics::new("0123456789ab", "homeassistant");
        assert_eq!(
            topics.command_name("ruru/0123456789ab/command/restore"),
            Some("restore")
        );
        for other in [
            "ruru/ba9876543210/command/restore",
            "ruru/0123456789ab/command/",
            "ruru/0123456789ab/command/a/b",
            "ruru/0123456789ab/state",
            "ruru/0123456789abc/command/restore",
            "frigate/garage/motion",
        ] {
            assert_eq!(topics.command_name(other), None, "{other}");
        }
    }

    #[test]
    fn discovery_sits_under_its_prefix_component_device_and_object() {
        let topics = Topics::new("0123456789ab", "/ha/");
        assert_eq!(
            topics.discovery("binary_sensor", "front_door_problem"),
            "ha/binary_sensor/0123456789ab/front_door_problem/config"
        );
    }

    #[test]
    fn config_topics_give_back_their_object() {
        let topics = Topics::new("0123456789ab", "homeassistant");
        assert_eq!(
            topics.configs("binary_sensor"),
            "homeassistant/binary_sensor/0123456789ab/+/config"
        );
        let topic = topics.discovery("binary_sensor", "garage_problem");
        assert_eq!(
            topics.config_object(&topic, "binary_sensor"),
            Some("garage_problem")
        );
        for other in [
            "homeassistant/sensor/0123456789ab/version/config",
            "homeassistant/binary_sensor/ffffffffffff/garage/config",
            "homeassistant/binary_sensor/0123456789ab/a/b/config",
            "homeassistant/binary_sensor/0123456789ab//config",
            "homeassistant/status",
        ] {
            assert_eq!(
                topics.config_object(other, "binary_sensor"),
                None,
                "{other}"
            );
        }
    }

    #[test]
    fn names_are_made_safe_for_topics_and_object_ids() {
        assert_eq!(object_id("Front_Door-2"), "front_door-2");
        assert_eq!(object_id("a/b+c#d e"), "a_b_c_d_e");
        assert_eq!(object_id("café"), "caf_");
        assert_eq!(object_id(""), "_");
        let topics = Topics::new("x", "homeassistant");
        assert_eq!(topics.problem("yard/#"), "ruru/x/problem/yard__");
    }
}
