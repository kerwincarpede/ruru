//! What Frigate says is happening on each camera, read from its MQTT topics:
//! motion, the objects moving in view and the camera's review status.
//!
//! On connecting Ruru publishes `<frigate>/onConnect`, and Frigate answers
//! with every camera's activity on `<frigate>/camera_activity`. After that
//! each change arrives on its own topic: `<camera>/motion`,
//! `<camera>/<label>/active` and `<camera>/review_status`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::settings::{MAX_TILES, valid_camera_name};

/// The event the page hears, with every camera's activity, whenever any of
/// it changes.
pub const EVENT: &str = "camera-activity";
/// The event the page hears when the connection that brought the activity
/// drops or is replaced, so it can tell that apart from every camera going
/// quiet.
pub const LOST_EVENT: &str = "camera-activity-lost";
/// The most object labels kept for one camera.
const MAX_LABELS: usize = 32;
/// The longest object label Ruru keeps.
const MAX_LABEL: usize = 64;

/// How far Frigate's review of what the camera sees has got.
///
/// Mirrored by `ReviewStatus` in `src/app/api.ts`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Review {
    #[default]
    None,
    /// Something Frigate tracks is in view.
    Detection,
    /// Something the user asked to be alerted about is in view.
    Alert,
}

impl Review {
    fn parse(payload: &str) -> Option<Self> {
        match payload.trim().to_ascii_uppercase().as_str() {
            "NONE" => Some(Self::None),
            "DETECTION" => Some(Self::Detection),
            "ALERT" => Some(Self::Alert),
            _ => None,
        }
    }
}

/// One camera's activity.
///
/// Mirrored by `CameraActivity` in `src/app/api.ts`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraActivity {
    pub motion: bool,
    /// How many objects of each label are moving in view. Labels with none
    /// are left out.
    pub objects: BTreeMap<String, u32>,
    pub review: Review,
}

impl CameraActivity {
    fn is_quiet(&self) -> bool {
        *self == Self::default()
    }
}

/// Every camera's activity, by camera name. Cameras with nothing going on
/// are left out.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct Activity(BTreeMap<String, CameraActivity>);

/// A camera as `camera_activity` describes it. Other fields are ignored.
#[derive(Debug, Deserialize)]
struct SeenCamera {
    #[serde(default)]
    motion: bool,
    #[serde(default)]
    objects: Vec<SeenObject>,
}

/// One tracked object in `camera_activity`.
#[derive(Debug, Deserialize)]
struct SeenObject {
    label: String,
    /// A stationary object is not counted as active, as Frigate's own
    /// `<label>/active` topics do.
    #[serde(default)]
    stationary: bool,
}

/// One message from Frigate, read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Update {
    /// Every camera's motion and active objects, in answer to `onConnect`.
    All(BTreeMap<String, (bool, BTreeMap<String, u32>)>),
    Motion {
        camera: String,
        on: bool,
    },
    Active {
        camera: String,
        label: String,
        count: u32,
    },
    Review {
        camera: String,
        review: Review,
    },
}

fn valid_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= MAX_LABEL
        && label != "all"
        && !label.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// Counts the active objects in one camera's `camera_activity` entry.
fn active_objects(objects: &[SeenObject]) -> BTreeMap<String, u32> {
    let mut counts = BTreeMap::new();
    for object in objects.iter().filter(|object| !object.stationary) {
        if !valid_label(&object.label) {
            continue;
        }
        if counts.len() < MAX_LABELS || counts.contains_key(&object.label) {
            *counts.entry(object.label.clone()).or_insert(0u32) += 1;
        }
    }
    counts
}

/// Frigate's topics under its prefix.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrigateTopics {
    prefix: String,
}

impl FrigateTopics {
    pub fn new(prefix: &str) -> Self {
        Self {
            prefix: prefix.trim_matches('/').to_string(),
        }
    }

    /// Publishing here asks Frigate for `camera_activity`.
    pub fn on_connect(&self) -> String {
        format!("{}/onConnect", self.prefix)
    }

    /// The topics Ruru follows. Snapshots, on `<camera>/<label>/snapshot`,
    /// are left out.
    pub fn subscriptions(&self) -> [String; 4] {
        let prefix = &self.prefix;
        [
            format!("{prefix}/camera_activity"),
            format!("{prefix}/+/motion"),
            format!("{prefix}/+/+/active"),
            format!("{prefix}/+/review_status"),
        ]
    }

    /// Reads a message on one of Frigate's topics. Anything else, or a
    /// payload that makes no sense, gives None.
    pub fn parse(&self, topic: &str, payload: &[u8]) -> Option<Update> {
        let rest = topic.strip_prefix(&self.prefix)?.strip_prefix('/')?;
        let levels: Vec<&str> = rest.split('/').collect();
        let text = || std::str::from_utf8(payload).ok().map(str::trim);
        let camera = |name: &str| valid_camera_name(name).then(|| name.to_string());
        match levels[..] {
            ["camera_activity"] => {
                let seen: BTreeMap<String, SeenCamera> = serde_json::from_slice(payload).ok()?;
                let all = seen
                    .into_iter()
                    .filter(|(name, _)| valid_camera_name(name))
                    .take(MAX_TILES)
                    .map(|(name, seen)| (name, (seen.motion, active_objects(&seen.objects))))
                    .collect();
                Some(Update::All(all))
            }
            [name, "motion"] => {
                let on = match text()? {
                    "ON" => true,
                    "OFF" => false,
                    _ => return None,
                };
                Some(Update::Motion {
                    camera: camera(name)?,
                    on,
                })
            }
            [name, "review_status"] => Some(Update::Review {
                camera: camera(name)?,
                review: Review::parse(text()?)?,
            }),
            [name, label, "active"] if valid_label(label) => Some(Update::Active {
                camera: camera(name)?,
                label: label.to_string(),
                count: text()?.parse().ok()?,
            }),
            _ => None,
        }
    }
}

impl Activity {
    /// One camera's activity, to change. None when the camera is new and
    /// Ruru already follows as many as it can.
    fn camera(&mut self, camera: String) -> Option<&mut CameraActivity> {
        if !self.0.contains_key(&camera) && self.0.len() >= MAX_TILES {
            return None;
        }
        Some(self.0.entry(camera).or_default())
    }

    /// Takes in one message from Frigate, returning whether anything changed.
    pub fn apply(&mut self, update: Update) -> bool {
        let before = self.clone();
        match update {
            Update::All(all) => {
                // Cameras Frigate no longer lists have nothing moving.
                for (name, activity) in &mut self.0 {
                    if !all.contains_key(name) {
                        activity.motion = false;
                        activity.objects.clear();
                    }
                }
                for (name, (motion, objects)) in all {
                    if let Some(activity) = self.camera(name) {
                        activity.motion = motion;
                        activity.objects = objects;
                    }
                }
            }
            Update::Motion { camera, on } => {
                if let Some(activity) = self.camera(camera) {
                    activity.motion = on;
                }
            }
            Update::Active {
                camera,
                label,
                count,
            } => {
                if let Some(activity) = self.camera(camera) {
                    if count == 0 {
                        activity.objects.remove(&label);
                    } else if activity.objects.len() < MAX_LABELS
                        || activity.objects.contains_key(&label)
                    {
                        activity.objects.insert(label, count);
                    }
                }
            }
            Update::Review { camera, review } => {
                if let Some(activity) = self.camera(camera) {
                    activity.review = review;
                }
            }
        }
        self.0.retain(|_, activity| !activity.is_quiet());
        *self != before
    }

    /// Forgets everything, as when the connection drops, returning whether
    /// there was anything to forget.
    pub fn clear(&mut self) -> bool {
        let had = !self.0.is_empty();
        self.0.clear();
        had
    }

    #[cfg(test)]
    fn get(&self, camera: &str) -> Option<&CameraActivity> {
        self.0.get(camera)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frigate() -> FrigateTopics {
        FrigateTopics::new("frigate")
    }

    fn objects(counts: &[(&str, u32)]) -> BTreeMap<String, u32> {
        counts
            .iter()
            .map(|(label, count)| (label.to_string(), *count))
            .collect()
    }

    #[test]
    fn topics_sit_under_frigates_prefix() {
        let topics = FrigateTopics::new("/cams/frigate/");
        assert_eq!(topics.on_connect(), "cams/frigate/onConnect");
        assert_eq!(
            topics.subscriptions(),
            [
                "cams/frigate/camera_activity",
                "cams/frigate/+/motion",
                "cams/frigate/+/+/active",
                "cams/frigate/+/review_status",
            ]
        );
    }

    #[test]
    fn camera_activity_gives_motion_and_moving_objects() {
        let payload = include_bytes!("fixtures/camera-activity.json");
        let Some(Update::All(all)) = frigate().parse("frigate/camera_activity", payload) else {
            panic!("camera_activity was not read");
        };
        // The parked car is stationary, so only the two people count.
        assert_eq!(all["front_door"], (true, objects(&[("person", 2)])));
        assert_eq!(all["garage"], (false, BTreeMap::new()));
    }

    #[test]
    fn camera_activity_that_is_not_json_is_ignored() {
        assert_eq!(frigate().parse("frigate/camera_activity", b"{"), None);
        assert_eq!(frigate().parse("frigate/camera_activity", b"[]"), None);
    }

    #[test]
    fn single_topics_are_read() {
        let frigate = frigate();
        assert_eq!(
            frigate.parse("frigate/front_door/motion", b"ON"),
            Some(Update::Motion {
                camera: "front_door".into(),
                on: true
            })
        );
        assert_eq!(
            frigate.parse("frigate/front_door/motion", b"OFF"),
            Some(Update::Motion {
                camera: "front_door".into(),
                on: false
            })
        );
        assert_eq!(
            frigate.parse("frigate/front_door/person/active", b"2"),
            Some(Update::Active {
                camera: "front_door".into(),
                label: "person".into(),
                count: 2
            })
        );
        assert_eq!(
            frigate.parse("frigate/front_door/review_status", b"ALERT"),
            Some(Update::Review {
                camera: "front_door".into(),
                review: Review::Alert
            })
        );
        assert_eq!(
            frigate.parse("frigate/front_door/review_status", b"detection"),
            Some(Update::Review {
                camera: "front_door".into(),
                review: Review::Detection
            })
        );
    }

    #[test]
    fn other_topics_and_bad_payloads_are_ignored() {
        let frigate = frigate();
        for (topic, payload) in [
            ("frigate/front_door/motion", &b"maybe"[..]),
            ("frigate/front_door/person/active", b"-1"),
            ("frigate/front_door/person/active", b"many"),
            ("frigate/front_door/all/active", b"3"),
            ("frigate/front_door/review_status", b"LATER"),
            ("frigate/front_door/person/snapshot", b"\xff\xd8"),
            ("frigate/front_door/motion/threshold", b"30"),
            ("frigate/available", b"online"),
            ("frigatex/front_door/motion", b"ON"),
            ("other/front_door/motion", b"ON"),
            ("frigate/ /motion", b"ON"),
        ] {
            assert_eq!(frigate.parse(topic, payload), None, "{topic}");
        }
    }

    #[test]
    fn updates_change_one_camera_and_quiet_cameras_are_dropped() {
        let mut activity = Activity::default();
        let camera = "front_door".to_string();
        assert!(activity.apply(Update::Motion {
            camera: camera.clone(),
            on: true
        }));
        assert!(!activity.apply(Update::Motion {
            camera: camera.clone(),
            on: true
        }));
        assert!(activity.apply(Update::Active {
            camera: camera.clone(),
            label: "person".into(),
            count: 1
        }));
        assert!(activity.apply(Update::Review {
            camera: camera.clone(),
            review: Review::Alert
        }));
        assert_eq!(
            activity.get("front_door"),
            Some(&CameraActivity {
                motion: true,
                objects: objects(&[("person", 1)]),
                review: Review::Alert,
            })
        );
        activity.apply(Update::Motion {
            camera: camera.clone(),
            on: false,
        });
        activity.apply(Update::Active {
            camera: camera.clone(),
            label: "person".into(),
            count: 0,
        });
        activity.apply(Update::Review {
            camera,
            review: Review::None,
        });
        assert_eq!(activity, Activity::default());
    }

    #[test]
    fn camera_activity_replaces_motion_and_objects_but_keeps_review() {
        let mut activity = Activity::default();
        activity.apply(Update::Review {
            camera: "garage".into(),
            review: Review::Detection,
        });
        activity.apply(Update::Motion {
            camera: "yard".into(),
            on: true,
        });
        let payload = include_bytes!("fixtures/camera-activity.json");
        let update = frigate().parse("frigate/camera_activity", payload).unwrap();
        assert!(activity.apply(update));
        assert_eq!(activity.get("front_door").unwrap().objects["person"], 2);
        assert_eq!(activity.get("garage").unwrap().review, Review::Detection);
        // Frigate no longer lists the yard, so nothing moves there.
        assert_eq!(activity.get("yard"), None);
    }

    #[test]
    fn labels_and_cameras_are_bounded() {
        let mut activity = Activity::default();
        for n in 0..MAX_LABELS + 5 {
            activity.apply(Update::Active {
                camera: "yard".into(),
                label: format!("thing{n}"),
                count: 1,
            });
        }
        assert_eq!(activity.get("yard").unwrap().objects.len(), MAX_LABELS);
        for n in 0..MAX_TILES + 5 {
            activity.apply(Update::Motion {
                camera: format!("camera{n}"),
                on: true,
            });
        }
        assert_eq!(activity.0.len(), MAX_TILES);
    }

    #[test]
    fn clearing_says_whether_there_was_anything() {
        let mut activity = Activity::default();
        assert!(!activity.clear());
        activity.apply(Update::Motion {
            camera: "yard".into(),
            on: true,
        });
        assert!(activity.clear());
        assert_eq!(activity, Activity::default());
    }

    #[test]
    fn activity_serialises_as_the_page_expects() {
        let mut activity = Activity::default();
        activity.apply(Update::Active {
            camera: "front_door".into(),
            label: "person".into(),
            count: 1,
        });
        activity.apply(Update::Review {
            camera: "front_door".into(),
            review: Review::Alert,
        });
        assert_eq!(
            serde_json::to_value(&activity).unwrap(),
            serde_json::json!({
                "front_door": { "motion": false, "objects": { "person": 1 }, "review": "alert" }
            })
        );
    }
}
