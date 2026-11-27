//! Local MSE playback counters for tracking stalls and late frames.

use serde::{Deserialize, Serialize};

use crate::settings::MAX_TILES;

/// One minute of counters for a stream. Mirrors `StreamPlayback` in src/app/api.ts.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamPlayback {
    connections: u32,
    pauses_start: u32,
    pauses_late: u32,
    pauses_missing: u32,
    pauses_close: u32,
    skips: u32,
    arrived: u32,
    presented: u32,
    late: u32,
    worst_late_ms: u32,
    lag_s: f64,
    lag_frames: f64,
}

/// Writes one local journal line for the wall, carrying only numeric stream data.
#[tauri::command]
pub fn report_playback(streams: Vec<StreamPlayback>) -> Result<(), String> {
    let line = journal_line(&streams)?;
    eprintln!("{line}");
    Ok(())
}

fn journal_line(streams: &[StreamPlayback]) -> Result<String, String> {
    // Allow main and sub streams plus recently replaced streams.
    if streams.is_empty() || streams.len() > MAX_TILES * 4 {
        return Err("Invalid playback stream count.".into());
    }
    if streams.iter().any(|stream| {
        !stream.lag_s.is_finite()
            || stream.lag_s < 0.0
            || !stream.lag_frames.is_finite()
            || stream.lag_frames < 0.0
    }) {
        return Err("Invalid playback lag.".into());
    }
    let data = serde_json::to_string(streams).map_err(|error| error.to_string())?;
    Ok(format!("Ruru playback {data}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn counters() -> StreamPlayback {
        serde_json::from_str(
            r#"{"connections":1,"pausesStart":2,"pausesLate":3,"pausesMissing":4,"pausesClose":5,"skips":6,"arrived":900,"presented":899,"late":7,"worstLateMs":42,"lagS":0.5,"lagFrames":12.5}"#,
        )
        .unwrap()
    }

    #[test]
    fn writes_one_line_with_all_streams() {
        let line = journal_line(&[counters(), counters()]).unwrap();
        let payload = line.strip_prefix("Ruru playback ").unwrap();
        assert_eq!(line.lines().count(), 1);
        let data: serde_json::Value = serde_json::from_str(payload).unwrap();
        assert_eq!(data.as_array().unwrap().len(), 2);
        assert_eq!(data[0]["pausesMissing"], 4);
        assert_eq!(data[1]["lagFrames"], 12.5);
        assert!(data[0].as_object().unwrap().values().all(|x| x.is_number()));
    }

    #[test]
    fn rejects_bad_counts_and_lag() {
        assert!(journal_line(&[]).is_err());
        assert!(journal_line(&vec![counters(); MAX_TILES * 4 + 1]).is_err());
        let mut invalid = counters();
        invalid.lag_s = -1.0;
        assert!(journal_line(&[invalid]).is_err());
    }
}
