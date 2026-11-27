//! Local MSE playback counters for tracking stalls and late frames.

use serde::Deserialize;

use crate::settings::MAX_TILES;

// systemd-journald's default maximum stderr stream record size, including newline.
const JOURNAL_LINE_BYTES: usize = 48 * 1024;

/// One minute of counters for a stream. Mirrors `StreamPlayback` in src/app/api.ts.
#[derive(Clone, Deserialize)]
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
    // Keep field names out of each row so a whole wall switching streams fits
    // in one line. The schema and order are documented with the investigation.
    let rows: Vec<_> = streams
        .iter()
        .map(|stream| {
            (
                stream.connections,
                stream.pauses_start,
                stream.pauses_late,
                stream.pauses_missing,
                stream.pauses_close,
                stream.skips,
                stream.arrived,
                stream.presented,
                stream.late,
                stream.worst_late_ms,
                stream.lag_s,
                stream.lag_frames,
            )
        })
        .collect();
    let data = serde_json::to_string(&rows).map_err(|error| error.to_string())?;
    let line = format!("Ruru playback {data}");
    if line.len() >= JOURNAL_LINE_BYTES {
        return Err("Playback report exceeds the journal line limit.".into());
    }
    Ok(line)
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
        assert_eq!(data[0][3], 4);
        assert_eq!(data[1][11], 12.5);
        assert!(data[0].as_array().unwrap().iter().all(|x| x.is_number()));
    }

    #[test]
    fn a_whole_wall_switch_fits_on_one_journal_line() {
        let mut stream = counters();
        stream.arrived = 7_200;
        stream.presented = 7_199;
        let line = journal_line(&vec![stream; MAX_TILES * 2]).unwrap();
        assert!(line.len() < JOURNAL_LINE_BYTES);
        let rows: Vec<Vec<f64>> =
            serde_json::from_str(line.strip_prefix("Ruru playback ").unwrap()).unwrap();
        assert_eq!(rows.len(), MAX_TILES * 2);
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
