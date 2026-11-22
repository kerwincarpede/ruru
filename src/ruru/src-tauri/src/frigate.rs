//! Reads the user's Frigate server: its version, and its cameras with the
//! go2rtc streams the wall plays.
//!
//! Frigate sends no CORS headers, so the page cannot read its API itself;
//! these requests go through Rust. Video and snapshots never do: the page
//! loads them from Frigate directly.

use std::{
    collections::{BTreeSet, HashSet},
    fmt,
    time::Duration,
};

use serde::{
    Deserialize, Deserializer, Serialize,
    de::{MapAccess, Visitor},
};

use crate::settings::normalise_frigate_url;

/// How long one request to Frigate may take.
const TIMEOUT: Duration = Duration::from_secs(10);

/// Where go2rtc, running inside Frigate, serves its restreams to ffmpeg.
/// An ffmpeg input from one of these is a go2rtc stream Ruru can play.
const GO2RTC_RTSP: [&str; 2] = ["rtsp://127.0.0.1:8554/", "rtsp://localhost:8554/"];

/// What Test connection reports about a Frigate server.
///
/// Mirrored by `FrigateStatus` in `src/app/frigate.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrigateStatus {
    pub version: String,
    pub camera_count: usize,
}

/// One camera on the wall, with the go2rtc streams its tile plays: `sub`
/// in the grid and `main` when maximised. A camera with one stream has it
/// as both.
///
/// Mirrored by `Camera` in `src/app/frigate.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Camera {
    pub name: String,
    pub enabled: bool,
    pub main_stream: String,
    pub sub_stream: String,
}

/// Why Frigate could not be read.
#[derive(Debug, PartialEq, Eq)]
pub enum FrigateError {
    /// No answer, or the connection failed.
    Unreachable { url: String, message: String },
    /// Frigate answered with an HTTP error.
    Status { url: String, status: u16 },
    /// The answer was not what Frigate sends.
    Parse(String),
}

impl fmt::Display for FrigateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unreachable { url, message } => {
                write!(f, "Could not reach Frigate at {url}: {message}")
            }
            Self::Status { url, status } => {
                write!(f, "Frigate at {url} answered with HTTP {status}.")
            }
            Self::Parse(message) => write!(f, "Frigate's answer was not understood: {message}"),
        }
    }
}

impl std::error::Error for FrigateError {}

/// The parts of `/api/config` Ruru reads.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct Config {
    #[serde(deserialize_with = "ordered_map")]
    cameras: Vec<(String, CameraConfig)>,
}

#[derive(Debug, Deserialize)]
#[serde(default)]
struct CameraConfig {
    enabled: bool,
    ui: UiConfig,
    live: LiveConfig,
    ffmpeg: FfmpegConfig,
}

impl Default for CameraConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            ui: UiConfig::default(),
            live: LiveConfig::default(),
            ffmpeg: FfmpegConfig::default(),
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct UiConfig {
    order: i64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct LiveConfig {
    /// Display name to go2rtc stream name, in Frigate's order.
    #[serde(deserialize_with = "ordered_map")]
    streams: Vec<(String, String)>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct FfmpegConfig {
    inputs: Vec<FfmpegInput>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct FfmpegInput {
    path: String,
    roles: Vec<String>,
}

/// Reads a JSON object as its entries in the order they were sent, which a
/// map would lose: the first live stream is the camera's main one. `null`
/// reads as no entries.
fn ordered_map<'de, D, V>(deserializer: D) -> Result<Vec<(String, V)>, D::Error>
where
    D: Deserializer<'de>,
    V: Deserialize<'de>,
{
    struct Entries<V>(std::marker::PhantomData<V>);

    impl<'de, V: Deserialize<'de>> Visitor<'de> for Entries<V> {
        type Value = Vec<(String, V)>;

        fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
            f.write_str("an object")
        }

        fn visit_unit<E>(self) -> Result<Self::Value, E> {
            Ok(Vec::new())
        }

        fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
            let mut entries = Vec::new();
            while let Some(entry) = map.next_entry()? {
                entries.push(entry);
            }
            Ok(entries)
        }
    }

    deserializer.deserialize_any(Entries(std::marker::PhantomData))
}

fn parse_config(text: &str) -> Result<Config, FrigateError> {
    serde_json::from_str(text).map_err(|err| FrigateError::Parse(err.to_string()))
}

/// The stream names go2rtc has, from `/api/go2rtc/streams`.
fn parse_go2rtc_streams(text: &str) -> Result<HashSet<String>, FrigateError> {
    let streams: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(text).map_err(|err| FrigateError::Parse(err.to_string()))?;
    Ok(streams.into_iter().map(|(name, _)| name).collect())
}

/// The go2rtc stream an ffmpeg input reads, when it reads one.
fn go2rtc_name(path: &str) -> Option<&str> {
    let rest = GO2RTC_RTSP
        .iter()
        .find_map(|prefix| path.strip_prefix(prefix))?;
    let name = rest.split(['?', '/']).next().unwrap_or_default();
    (!name.is_empty()).then_some(name)
}

/// The go2rtc stream of the first ffmpeg input with `role`.
fn input_stream<'a>(camera: &'a CameraConfig, role: &str) -> Option<&'a str> {
    camera
        .ffmpeg
        .inputs
        .iter()
        .filter(|input| input.roles.iter().any(|r| r == role))
        .find_map(|input| go2rtc_name(&input.path))
}

/// Picks a camera's main and sub streams. With more than one live stream,
/// the first is main and the sub is one named like a sub stream, or else the
/// second. Otherwise the record input is main and the detect input is sub,
/// and failing those go2rtc's `NAME` and `NAME_sub`. When `go2rtc` is known,
/// a stream it lacks is skipped; a missing sub is the main stream.
fn pick_streams(
    name: &str,
    camera: &CameraConfig,
    go2rtc: Option<&HashSet<String>>,
) -> (String, String) {
    let exists = |stream: &str| go2rtc.is_none_or(|streams| streams.contains(stream));
    let live = &camera.live.streams;
    if live.len() > 1 {
        let main = live[0].1.clone();
        let sub = live[1..]
            .iter()
            .find(|(label, stream)| {
                label.to_lowercase().contains("sub") || stream.to_lowercase().contains("sub")
            })
            .unwrap_or(&live[1])
            .1
            .clone();
        return (main, sub);
    }
    let fallback_sub = format!("{name}_sub");
    let main = [
        input_stream(camera, "record"),
        live.first().map(|(_, stream)| stream.as_str()),
        Some(name),
    ]
    .into_iter()
    .flatten()
    .find(|stream| exists(stream))
    .unwrap_or(name)
    .to_string();
    let sub = [
        input_stream(camera, "detect"),
        // Only a name go2rtc is known to have: guessing it could break a tile.
        go2rtc
            .filter(|streams| streams.contains(&fallback_sub))
            .map(|_| fallback_sub.as_str()),
    ]
    .into_iter()
    .flatten()
    .find(|stream| exists(stream))
    .unwrap_or(&main)
    .to_string();
    (main, sub)
}

/// The cameras in `config`, in Frigate's order (`ui.order`, then name,
/// because orders repeat). Disabled cameras and those hidden from Frigate's
/// dashboard are kept: the wall shows everything.
fn cameras_from(config: Config, go2rtc: Option<&HashSet<String>>) -> Vec<Camera> {
    let mut cameras: Vec<(i64, Camera)> = config
        .cameras
        .into_iter()
        .map(|(name, camera)| {
            let (main_stream, sub_stream) = pick_streams(&name, &camera, go2rtc);
            let order = camera.ui.order;
            (
                order,
                Camera {
                    name,
                    enabled: camera.enabled,
                    main_stream,
                    sub_stream,
                },
            )
        })
        .collect();
    cameras.sort_by(|(a_order, a), (b_order, b)| {
        a_order.cmp(b_order).then_with(|| a.name.cmp(&b.name))
    });
    let mut seen = BTreeSet::new();
    cameras
        .into_iter()
        .map(|(_, camera)| camera)
        .filter(|camera| seen.insert(camera.name.clone()))
        .collect()
}

/// An HTTP client for Frigate, with a timeout so a dead server fails fast.
fn client() -> Result<reqwest::Client, FrigateError> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        // Another thread may install it first; either provider is the same.
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|err| FrigateError::Unreachable {
            url: String::new(),
            message: err.to_string(),
        })
}

/// An error and every cause under it, because reqwest's own message is
/// only "error sending request".
fn describe(err: &dyn std::error::Error) -> String {
    let mut message = err.to_string();
    let mut source = err.source();
    while let Some(cause) = source {
        message.push_str(": ");
        message.push_str(&cause.to_string());
        source = cause.source();
    }
    message
}

/// The body of `base` + `path`.
async fn get(client: &reqwest::Client, base: &str, path: &str) -> Result<String, FrigateError> {
    let unreachable = |err: reqwest::Error| FrigateError::Unreachable {
        url: base.to_string(),
        message: describe(&err),
    };
    let response = client
        .get(format!("{base}{path}"))
        .send()
        .await
        .map_err(unreachable)?;
    let status = response.status();
    if !status.is_success() {
        return Err(FrigateError::Status {
            url: base.to_string(),
            status: status.as_u16(),
        });
    }
    response.text().await.map_err(unreachable)
}

/// Checks a URL before it is saved: Frigate's version and camera count.
pub async fn status(base: &str) -> Result<FrigateStatus, FrigateError> {
    let client = client()?;
    let version = get(&client, base, "/api/version").await?.trim().to_string();
    let config = parse_config(&get(&client, base, "/api/config").await?)?;
    Ok(FrigateStatus {
        version,
        camera_count: config.cameras.len(),
    })
}

/// Every camera on the Frigate server at `base`, with its streams. go2rtc's
/// stream list only sharpens the choice; without it the config decides.
pub async fn cameras(base: &str) -> Result<Vec<Camera>, FrigateError> {
    let client = client()?;
    let config = parse_config(&get(&client, base, "/api/config").await?)?;
    let go2rtc = match get(&client, base, "/api/go2rtc/streams").await {
        Ok(text) => parse_go2rtc_streams(&text).ok(),
        Err(_) => None,
    };
    Ok(cameras_from(config, go2rtc.as_ref()))
}

fn base_url(url: &str) -> Result<String, String> {
    normalise_frigate_url(url).map_err(|err| err.to_string())
}

/// Test connection: the Frigate version and how many cameras it has.
#[tauri::command]
pub async fn test_frigate(url: String) -> Result<FrigateStatus, String> {
    status(&base_url(&url)?)
        .await
        .map_err(|err| err.to_string())
}

/// The cameras on the Frigate server at `url`, in the wall's order.
#[tauri::command]
pub async fn frigate_cameras(url: String) -> Result<Vec<Camera>, String> {
    cameras(&base_url(&url)?)
        .await
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONFIG: &str = include_str!("frigate/fixtures/config.json");
    const STREAMS: &str = include_str!("frigate/fixtures/streams.json");

    fn camera(name: &str, enabled: bool, main: &str, sub: &str) -> Camera {
        Camera {
            name: name.into(),
            enabled,
            main_stream: main.into(),
            sub_stream: sub.into(),
        }
    }

    fn fixture_cameras(go2rtc: Option<&HashSet<String>>) -> Vec<Camera> {
        cameras_from(parse_config(CONFIG).unwrap(), go2rtc)
    }

    #[test]
    fn cameras_are_sorted_by_order_then_name_and_all_are_kept() {
        let streams = parse_go2rtc_streams(STREAMS).unwrap();
        assert_eq!(
            fixture_cameras(Some(&streams)),
            vec![
                camera("shed", true, "shed", "shed"),
                camera("maingate", true, "maingate", "maingate_sub"),
                // Disabled and off Frigate's dashboard, but on the wall.
                camera("porch", false, "porch_main", "porch_low"),
                camera("braai", true, "braai", "braai_sub"),
                camera("driveway", true, "driveway", "driveway_sub"),
            ]
        );
    }

    #[test]
    fn without_go2rtc_the_config_decides() {
        let cameras = fixture_cameras(None);
        assert_eq!(cameras.len(), 5);
        assert_eq!(
            cameras[1],
            camera("maingate", true, "maingate", "maingate_sub")
        );
        assert_eq!(cameras[0], camera("shed", true, "shed", "shed"));
    }

    #[test]
    fn the_fixture_status_counts_cameras() {
        assert_eq!(parse_config(CONFIG).unwrap().cameras.len(), 5);
    }

    fn config(json: serde_json::Value) -> Config {
        parse_config(&json.to_string()).unwrap()
    }

    fn streams(names: &[&str]) -> HashSet<String> {
        names.iter().map(|name| name.to_string()).collect()
    }

    #[test]
    fn a_live_stream_named_sub_is_the_sub_stream() {
        let config = config(
            serde_json::json!({"cameras": {"gate": {"live": {"streams": {
                "HD": "gate_hd", "Medium": "gate_mid", "Sub": "gate_small"
            }}}}}),
        );
        assert_eq!(
            cameras_from(config, None),
            vec![camera("gate", true, "gate_hd", "gate_small")]
        );
    }

    #[test]
    fn go2rtc_name_and_name_sub_are_used_without_go2rtc_inputs() {
        let cfg = || {
            config(serde_json::json!({"cameras": {"gate": {
                "ffmpeg": {"inputs": [{"path": "rtsp://10.0.0.2/live", "roles": ["record", "detect"]}]}
            }}}))
        };
        assert_eq!(
            cameras_from(cfg(), Some(&streams(&["gate", "gate_sub"]))),
            vec![camera("gate", true, "gate", "gate_sub")]
        );
        // Not known to go2rtc: the camera's own name serves both.
        assert_eq!(
            cameras_from(cfg(), None),
            vec![camera("gate", true, "gate", "gate")]
        );
    }

    #[test]
    fn a_detect_stream_go2rtc_lacks_falls_back_to_main() {
        let config = config(
            serde_json::json!({"cameras": {"gate": {"ffmpeg": {"inputs": [
                {"path": "rtsp://127.0.0.1:8554/gate?video=copy", "roles": ["record"]},
                {"path": "rtsp://localhost:8554/gate_low", "roles": ["detect"]}
            ]}}}}),
        );
        assert_eq!(
            cameras_from(config, Some(&streams(&["gate"]))),
            vec![camera("gate", true, "gate", "gate")]
        );
    }

    #[test]
    fn go2rtc_names_come_from_restream_paths_only() {
        assert_eq!(go2rtc_name("rtsp://127.0.0.1:8554/front"), Some("front"));
        assert_eq!(
            go2rtc_name("rtsp://127.0.0.1:8554/front_sub?mp4"),
            Some("front_sub")
        );
        assert_eq!(go2rtc_name("rtsp://localhost:8554/a/b"), Some("a"));
        assert_eq!(go2rtc_name("rtsp://127.0.0.1:8554/"), None);
        assert_eq!(go2rtc_name("rtsp://10.0.0.1:554/front"), None);
    }

    #[test]
    fn missing_and_null_fields_read_as_defaults() {
        let config = config(serde_json::json!({"cameras": {
            "b": {"enabled": false, "live": {"streams": null}},
            "a": {}
        }}));
        assert_eq!(
            cameras_from(config, None),
            vec![camera("a", true, "a", "a"), camera("b", false, "b", "b")]
        );
        assert!(parse_config("{}").unwrap().cameras.is_empty());
    }

    #[test]
    fn answers_that_are_not_frigate_are_errors() {
        let err = parse_config("<html>").unwrap_err();
        assert!(
            err.to_string()
                .starts_with("Frigate's answer was not understood:")
        );
        assert!(parse_config(r#"{"cameras": []}"#).is_err());
        assert!(parse_go2rtc_streams("[]").is_err());
    }

    #[test]
    fn errors_read_as_the_page_shows_them() {
        assert_eq!(
            FrigateError::Unreachable {
                url: "http://a".into(),
                message: "connection refused".into()
            }
            .to_string(),
            "Could not reach Frigate at http://a: connection refused"
        );
        assert_eq!(
            FrigateError::Status {
                url: "http://a".into(),
                status: 404
            }
            .to_string(),
            "Frigate at http://a answered with HTTP 404."
        );
    }

    #[test]
    fn describe_includes_every_cause() {
        #[derive(Debug)]
        struct Outer(std::io::Error);
        impl fmt::Display for Outer {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("error sending request")
            }
        }
        impl std::error::Error for Outer {
            fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
                Some(&self.0)
            }
        }
        let err = Outer(std::io::Error::other("connection refused"));
        assert_eq!(describe(&err), "error sending request: connection refused");
    }

    #[test]
    fn serialises_as_the_page_expects() {
        assert_eq!(
            serde_json::to_value(camera("a", true, "a", "a_sub")).unwrap(),
            serde_json::json!({"name": "a", "enabled": true, "mainStream": "a", "subStream": "a_sub"})
        );
        assert_eq!(
            serde_json::to_value(FrigateStatus {
                version: "0.18.0".into(),
                camera_count: 3
            })
            .unwrap(),
            serde_json::json!({"version": "0.18.0", "cameraCount": 3})
        );
    }

    #[test]
    fn commands_refuse_a_bad_url_before_any_request() {
        let rt = tauri::async_runtime::block_on(test_frigate("nope".into()));
        assert_eq!(
            rt.unwrap_err(),
            "Enter a Frigate URL starting with http:// or https://."
        );
        let rt = tauri::async_runtime::block_on(frigate_cameras("ftp://x".into()));
        assert!(rt.is_err());
    }

    #[test]
    fn an_unreachable_server_is_reported() {
        // A port that was just free on this machine refuses connections; no
        // network needed.
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let base = format!("http://127.0.0.1:{port}");
        let err = tauri::async_runtime::block_on(status(&base)).unwrap_err();
        assert!(
            err.to_string()
                .starts_with(&format!("Could not reach Frigate at {base}:")),
            "{err}"
        );
    }
}
