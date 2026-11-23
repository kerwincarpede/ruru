//! The commands Home Assistant sends on Ruru's command topics: maximise a
//! camera, restore the wall, turn full screen on or off, stop or start every
//! stream, reconnect a tile, install the pending update and turn the display
//! off or on. Each one is checked before it is carried out, since anything on
//! the broker can publish to these topics.

use serde::Serialize;

/// The event the page hears, with the command, when Home Assistant asks the
/// wall to change.
pub const EVENT: &str = "wall-command";

/// The select that maximises a camera; `none` restores the wall.
pub const MAXIMISE: &str = "maximise";
/// The button that restores the wall.
pub const RESTORE: &str = "restore";
/// The switch that turns full screen on and off.
pub const FULL_SCREEN: &str = "full_screen";
/// The switch that stops and starts every camera's stream.
pub const STREAMS: &str = "streams";
/// The buttons that reconnect a tile, each sending its camera's name.
pub const RECONNECT: &str = "reconnect";
/// The update entity's Install.
pub const INSTALL: &str = "install";
/// The switch that turns the display off and on.
pub const DISPLAY: &str = "display";

/// What the Maximise select offers for no camera.
pub const NONE: &str = "none";
/// What a button that needs no payload sends.
pub const PRESS: &str = "PRESS";
/// What the update entity sends to install.
pub const INSTALL_PAYLOAD: &str = "INSTALL";

/// The longest payload Ruru reads: a camera name or a word.
const MAX_PAYLOAD: usize = 256;

/// A change the page carries out on the wall.
///
/// Mirrored by `WallCommand` in `src/app/api.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WallCommand {
    /// Fill the window with one camera on the wall.
    Maximise { camera: String },
    /// Show the whole wall again.
    Restore,
    /// Enter or leave full screen.
    FullScreen { on: bool },
    /// Start every tile's stream, or stop them all and leave the snapshots.
    Streams { on: bool },
    /// Drop a tile's stream and connect it again.
    Reconnect { camera: String },
}

/// A command from Home Assistant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Wall(WallCommand),
    /// Install the pending update and restart full screen.
    Install,
    /// Turn the display on, or off.
    Display {
        on: bool,
    },
}

/// Why a command was ignored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refused {
    /// The topic names no command Ruru has.
    Unknown(String),
    /// The payload is not text, or too long.
    Unreadable,
    /// The camera is not on the wall.
    NotOnWall(String),
    /// A switch sent something other than `ON` or `OFF`.
    NotOnOrOff(String),
}

impl std::fmt::Display for Refused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unknown(name) => write!(f, "there is no {name:?} command"),
            Self::Unreadable => f.write_str("the payload is not short text"),
            Self::NotOnWall(camera) => write!(f, "{camera:?} is not on the wall"),
            Self::NotOnOrOff(payload) => write!(f, "a switch takes ON or OFF, not {payload:?}"),
        }
    }
}

/// Reads command `name` with `payload`. A camera must be one of `cameras`,
/// those on the wall now.
pub fn parse(name: &str, payload: &[u8], cameras: &[String]) -> Result<Command, Refused> {
    if payload.len() > MAX_PAYLOAD {
        return Err(Refused::Unreadable);
    }
    let payload = std::str::from_utf8(payload)
        .map_err(|_| Refused::Unreadable)?
        .trim();
    let on_wall = |camera: &str| {
        if cameras.iter().any(|name| name == camera) {
            Ok(camera.to_string())
        } else {
            Err(Refused::NotOnWall(camera.to_string()))
        }
    };
    let on_or_off = || match payload.to_ascii_uppercase().as_str() {
        "ON" => Ok(true),
        "OFF" => Ok(false),
        _ => Err(Refused::NotOnOrOff(payload.to_string())),
    };
    let command = match name {
        MAXIMISE if payload.eq_ignore_ascii_case(NONE) => WallCommand::Restore,
        MAXIMISE => WallCommand::Maximise {
            camera: on_wall(payload)?,
        },
        RESTORE => WallCommand::Restore,
        FULL_SCREEN => WallCommand::FullScreen { on: on_or_off()? },
        STREAMS => WallCommand::Streams { on: on_or_off()? },
        RECONNECT => WallCommand::Reconnect {
            camera: on_wall(payload)?,
        },
        INSTALL => return Ok(Command::Install),
        DISPLAY => return Ok(Command::Display { on: on_or_off()? }),
        other => return Err(Refused::Unknown(other.to_string())),
    };
    Ok(Command::Wall(command))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cameras() -> Vec<String> {
        vec!["front_door".into(), "garage".into()]
    }

    fn wall(name: &str, payload: &str) -> Result<Command, Refused> {
        parse(name, payload.as_bytes(), &cameras())
    }

    #[test]
    fn the_select_maximises_a_camera_on_the_wall_or_restores() {
        assert_eq!(
            wall("maximise", "garage"),
            Ok(Command::Wall(WallCommand::Maximise {
                camera: "garage".into()
            }))
        );
        assert_eq!(
            wall("maximise", "none"),
            Ok(Command::Wall(WallCommand::Restore))
        );
        assert_eq!(
            wall("maximise", "yard"),
            Err(Refused::NotOnWall("yard".into()))
        );
        assert_eq!(wall("maximise", ""), Err(Refused::NotOnWall(String::new())));
    }

    #[test]
    fn the_buttons_restore_reconnect_and_install() {
        assert_eq!(
            wall("restore", PRESS),
            Ok(Command::Wall(WallCommand::Restore))
        );
        assert_eq!(
            wall("reconnect", "front_door"),
            Ok(Command::Wall(WallCommand::Reconnect {
                camera: "front_door".into()
            }))
        );
        assert_eq!(
            wall("reconnect", "yard"),
            Err(Refused::NotOnWall("yard".into()))
        );
        assert_eq!(wall("install", INSTALL_PAYLOAD), Ok(Command::Install));
    }

    #[test]
    fn the_switch_turns_full_screen_on_and_off() {
        assert_eq!(
            wall("full_screen", "ON"),
            Ok(Command::Wall(WallCommand::FullScreen { on: true }))
        );
        assert_eq!(
            wall("full_screen", " off "),
            Ok(Command::Wall(WallCommand::FullScreen { on: false }))
        );
        assert_eq!(
            wall("full_screen", "toggle"),
            Err(Refused::NotOnOrOff("toggle".into()))
        );
    }

    #[test]
    fn the_switch_stops_and_starts_the_streams() {
        assert_eq!(
            wall("streams", "OFF"),
            Ok(Command::Wall(WallCommand::Streams { on: false }))
        );
        assert_eq!(
            wall("streams", "on"),
            Ok(Command::Wall(WallCommand::Streams { on: true }))
        );
        assert_eq!(
            wall("streams", PRESS),
            Err(Refused::NotOnOrOff(PRESS.into()))
        );
    }

    #[test]
    fn the_switch_turns_the_display_off_and_on() {
        assert_eq!(wall("display", "OFF"), Ok(Command::Display { on: false }));
        assert_eq!(wall("display", " on"), Ok(Command::Display { on: true }));
        assert_eq!(
            wall("display", "PRESS"),
            Err(Refused::NotOnOrOff("PRESS".into()))
        );
    }

    #[test]
    fn unknown_commands_and_unreadable_payloads_are_refused() {
        assert_eq!(
            wall("shutdown", PRESS),
            Err(Refused::Unknown("shutdown".into()))
        );
        assert_eq!(
            parse("maximise", &[0xff, 0xfe], &cameras()),
            Err(Refused::Unreadable)
        );
        assert_eq!(
            parse(
                "maximise",
                "g".repeat(MAX_PAYLOAD + 1).as_bytes(),
                &cameras()
            ),
            Err(Refused::Unreadable)
        );
        assert!(
            Refused::NotOnWall("yard".into())
                .to_string()
                .contains("not on the wall")
        );
    }

    #[test]
    fn commands_reach_the_page_tagged_by_kind() {
        let json = |command: WallCommand| serde_json::to_value(command).unwrap();
        assert_eq!(
            json(WallCommand::Maximise {
                camera: "garage".into()
            }),
            serde_json::json!({ "kind": "maximise", "camera": "garage" })
        );
        assert_eq!(
            json(WallCommand::Restore),
            serde_json::json!({ "kind": "restore" })
        );
        assert_eq!(
            json(WallCommand::FullScreen { on: true }),
            serde_json::json!({ "kind": "fullScreen", "on": true })
        );
        assert_eq!(
            json(WallCommand::Streams { on: false }),
            serde_json::json!({ "kind": "streams", "on": false })
        );
        assert_eq!(
            json(WallCommand::Reconnect {
                camera: "garage".into()
            }),
            serde_json::json!({ "kind": "reconnect", "camera": "garage" })
        );
    }
}
