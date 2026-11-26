import { useState, type FormEvent } from "react";
import { saveDynamicWall, saveWallOptions, type ActivityStyle, type DynamicWall, type SavedLayout, type Settings, type WallOptions } from "../app/api";
import { cameraLabel } from "../app/frigate";
import { ACTIVITY_STYLES } from "../wall/activity";
import type { WallSize } from "../wall/dynamic";
import DynamicWallPreview from "./DynamicWallPreview";

interface AppearancePageProps {
  wall: WallOptions;
  mqttEnabled: boolean;
  /** The current Frigate server, whose wall the Dynamic wall choices are for. */
  server: string | null;
  /** That server's saved Dynamic wall choices. */
  dynamic: DynamicWall;
  /** The cameras on that server's wall, in wall order. */
  cameras: string[];
  /** The object labels Frigate tracks on those cameras. */
  objects: string[];
  layout: SavedLayout | undefined;
  /** The wall area's size, for the preview. */
  wallSize: WallSize;
  onSaved: (options: WallOptions) => void;
  /** Saved with the Dynamic wall's choices, which return every setting. */
  onDynamicSaved: (settings: Settings) => void;
  onClose: () => void;
}

/** The same cameras, in any order. */
const sameCameras = (a: string[], b: string[]) => a.length === b.length && a.every((camera) => b.includes(camera));

export default function AppearancePage({ wall, mqttEnabled, server, dynamic, cameras, objects, layout, wallSize, onSaved, onDynamicSaved, onClose }: AppearancePageProps) {
  const [activity, setActivity] = useState(wall.activity);
  const [activityStyle, setActivityStyle] = useState(wall.activityStyle);
  const [streamInfo, setStreamInfo] = useState(wall.streamInfo);
  // Home Assistant can turn the Dynamic wall on or off while this page is
  // open, so the checkbox follows the saved setting until it is changed here.
  const [dynamicWallPick, setDynamicWallPick] = useState<boolean | null>(null);
  const dynamicWall = dynamicWallPick ?? wall.dynamicWall;
  const [slots, setSlots] = useState<[string, string]>([dynamic.heroSlots[0] ?? "", dynamic.heroSlots[1] ?? ""]);
  const [priority, setPriority] = useState(dynamic.priorityCameras);
  const [ignored, setIgnored] = useState(dynamic.ignoredObjects);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Both slots on Automatic, or two different cameras.
  const slotsValid = slots[0] === slots[1] ? slots[0] === "" : slots[0] !== "" && slots[1] !== "";
  const heroSlots = slots[0] && slots[1] ? [...slots] : [];
  const dynamicChanged = dynamicWall !== wall.dynamicWall || (server !== null && (heroSlots.join("\n") !== dynamic.heroSlots.join("\n") || !sameCameras(priority, dynamic.priorityCameras) || !sameCameras(ignored, dynamic.ignoredObjects)));
  const changed = activity !== wall.activity || activityStyle !== wall.activityStyle || streamInfo !== wall.streamInfo || dynamicChanged;
  const offerChoices = server !== null && cameras.length > 0;
  // A saved slot for a camera no longer on the wall is still offered, so it can be seen and changed.
  const slotChoices = [...cameras, ...slots.filter((slot) => slot && !cameras.includes(slot))];
  // Likewise a left-out object Frigate no longer tracks, so it can be ticked again.
  const objectChoices = [...objects, ...ignored.filter((label) => !objects.includes(label))];

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const options = { ...wall, activity, activityStyle, streamInfo, dynamicWall };
    try {
      if (dynamicChanged) onDynamicSaved(await saveDynamicWall(options, server, { heroSlots, priorityCameras: priority, ignoredObjects: ignored }));
      else {
        await saveWallOptions(options);
        onSaved(options);
      }
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
        <section className="settings-section" aria-labelledby="dynamic-wall-title">
          <h4 id="dynamic-wall-title">Dynamic wall</h4>
          <div className="field-check">
            <input
              id="dynamic-wall"
              type="checkbox"
              checked={dynamicWall}
              aria-describedby={mqttEnabled ? "dynamic-wall-hint" : "dynamic-wall-hint dynamic-wall-source"}
              onChange={(event) => setDynamicWallPick(event.target.checked === wall.dynamicWall ? null : event.target.checked)}
            />
            <label className="field-label" htmlFor="dynamic-wall">Dynamic wall</label>
            <span id="dynamic-wall-hint" className="field-hint">
              While Frigate sees objects, show up to two of those cameras large above the rest. Your layout is kept, and every stream stays connected.
            </span>
            {!mqttEnabled && (
              <span id="dynamic-wall-source" className="field-hint">Connect to Home Assistant to receive activity from Frigate.</span>
            )}
          </div>
          {!offerChoices && <p className="field-hint">Connect to Frigate to choose hero slots and priority cameras for its wall.</p>}
          {offerChoices && (
            <>
              <DynamicWallPreview cameras={cameras} layout={layout} heroSlots={heroSlots} priority={priority} size={wallSize} />
              <div className="dynamic-slots">
                {(["First hero slot", "Second hero slot"] as const).map((label, index) => (
                  <div className="field" key={label}>
                    <label className="field-label" htmlFor={`hero-slot-${index}`}>{label}</label>
                    <select
                      id={`hero-slot-${index}`}
                      aria-describedby="hero-slot-hint"
                      value={slots[index]}
                      disabled={!dynamicWall}
                      onChange={(event) => setSlots((now) => (index === 0 ? [event.target.value, now[1]] : [now[0], event.target.value]))}
                    >
                      <option value="">Automatic</option>
                      {slotChoices.map((camera) => (
                        <option key={camera} value={camera}>{cameraLabel(camera)}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <span id="hero-slot-hint" className="field-hint">
                {slotsValid
                  ? "Automatic puts active cameras in a row above the others. Pick two tiles of your layout to swap active cameras into them instead; the cameras they show move to the active cameras’ places for a while."
                  : "Pick two different cameras, or leave both on Automatic."}
              </span>
              {objectChoices.length > 0 && (
                <fieldset className="dynamic-priority" disabled={!dynamicWall} aria-describedby="hero-objects-hint">
                  <legend className="field-label">Hero objects</legend>
                  <span id="hero-objects-hint" className="field-hint">
                    A camera becomes a hero when Frigate sees one of these. Untick an object, such as a dog, to leave its cameras where they are.
                  </span>
                  {objectChoices.map((label) => (
                    <label key={label} className="field-check">
                      <input
                        type="checkbox"
                        checked={!ignored.includes(label)}
                        onChange={(event) => setIgnored((now) => (event.target.checked ? now.filter((name) => name !== label) : [...now, label]))}
                      />
                      <span>{cameraLabel(label)}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              <fieldset className="dynamic-priority" disabled={!dynamicWall} aria-describedby="priority-hint">
                <legend className="field-label">Priority cameras</legend>
                <span id="priority-hint" className="field-hint">
                  When Frigate sees a person at one of these cameras, it fills the wall until the person leaves. Press Esc to go back to the wall.
                </span>
                {cameras.map((camera) => (
                  <label key={camera} className="field-check">
                    <input
                      type="checkbox"
                      checked={priority.includes(camera)}
                      onChange={(event) => setPriority((now) => (event.target.checked ? [...now, camera] : now.filter((name) => name !== camera)))}
                    />
                    <span>{cameraLabel(camera)}</span>
                  </label>
                ))}
              </fieldset>
            </>
          )}
        </section>
        {error && <p className="test-failed" role="alert">{error}</p>}
      </div>
      <footer className="dialog-foot">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={!changed || !slotsValid || saving}>Save</button>
      </footer>
    </form>
  );
}
