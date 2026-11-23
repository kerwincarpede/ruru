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

    fn own(&self, rest: &str) -> String {
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

    /// Where one entity's discovery config is retained.
    pub fn discovery(&self, component: &str, object: &str) -> String {
        format!(
            "{}/{component}/{}/{}/config",
            self.discovery_prefix,
            self.device_id,
            object_id(object)
        )
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
    fn names_are_made_safe_for_topics_and_object_ids() {
        assert_eq!(object_id("Front_Door-2"), "front_door-2");
        assert_eq!(object_id("a/b+c#d e"), "a_b_c_d_e");
        assert_eq!(object_id("café"), "caf_");
        assert_eq!(object_id(""), "_");
        let topics = Topics::new("x", "homeassistant");
        assert_eq!(topics.problem("yard/#"), "ruru/x/problem/yard__");
    }
}
