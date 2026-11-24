import { useState, type FormEvent } from "react";
import { saveWallOptions, type ActivityStyle, type WallOptions } from "../app/api";
import { ACTIVITY_STYLES } from "../wall/activity";

interface AppearancePageProps {
  wall: WallOptions;
  mqttEnabled: boolean;
  onSaved: (options: WallOptions) => void;
  onClose: () => void;
}

export default function AppearancePage({ wall, mqttEnabled, onSaved, onClose }: AppearancePageProps) {
  const [activity, setActivity] = useState(wall.activity);
  const [activityStyle, setActivityStyle] = useState(wall.activityStyle);
  const [streamInfo, setStreamInfo] = useState(wall.streamInfo);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = activity !== wall.activity || activityStyle !== wall.activityStyle || streamInfo !== wall.streamInfo;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const options = { ...wall, activity, activityStyle, streamInfo };
    try {
      await saveWallOptions(options);
      onSaved(options);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      setSaving(false);
    }
  };

  return (
    <form className="settings-body" onSubmit={save}>
      <h3 className="settings-title">Appearance</h3>
      <div className="settings-content">
        <section className="settings-section" aria-labelledby="card-highlighting">
          <h4 id="card-highlighting">Card highlighting</h4>
          <div className="field-check">
            <input
              id="show-activity"
              type="checkbox"
              checked={activity}
              aria-describedby={mqttEnabled ? "activity-hint" : "activity-hint activity-source"}
              onChange={(event) => setActivity(event.target.checked)}
            />
            <label className="field-label" htmlFor="show-activity">Show activity</label>
            <span id="activity-hint" className="field-hint">
              Mark tiles when Frigate detects motion, objects or alerts.
            </span>
            {!mqttEnabled && (
              <span id="activity-source" className="field-hint">Connect to Home Assistant to receive activity from Frigate.</span>
            )}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="activity-style">Activity style</label>
            <select
              id="activity-style"
              aria-describedby="activity-style-hint"
              value={activityStyle}
              disabled={!activity}
              onChange={(event) => setActivityStyle(event.target.value as ActivityStyle)}
            >
              {ACTIVITY_STYLES.map((choice) => (
                <option key={choice.value} value={choice.value}>{choice.title}</option>
              ))}
            </select>
            <span id="activity-style-hint" className="field-hint">
              {ACTIVITY_STYLES.find((choice) => choice.value === activityStyle)?.hint}
            </span>
          </div>
        </section>
        <section className="settings-section" aria-labelledby="tile-details">
          <h4 id="tile-details">Tile details</h4>
          <div className="field-check">
            <input
              id="show-stream-info"
              type="checkbox"
              checked={streamInfo}
              aria-describedby="stream-info-hint"
              onChange={(event) => setStreamInfo(event.target.checked)}
            />
            <label className="field-label" htmlFor="show-stream-info">Show stream info</label>
            <span id="stream-info-hint" className="field-hint">Show the stream, playback method and resolution on each tile.</span>
          </div>
        </section>
        {error && <p className="test-failed" role="alert">{error}</p>}
      </div>
      <footer className="dialog-foot">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={!changed || saving}>Save</button>
      </footer>
    </form>
  );
}
