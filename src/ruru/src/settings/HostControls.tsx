import { useEffect, useState } from "react";
import {
  disableHostControls,
  enableHostControls,
  hostControlsStatus,
  testHostControls,
  type HostControlsStatus,
} from "../app/api";

type Action = "test" | "enable" | "disable";

/** Sets up the independent Ubuntu service with its own MQTT account. */
export default function HostControls({ mqttEnabled }: { mqttEnabled: boolean }) {
  const [status, setStatus] = useState<HostControlsStatus>();
  const [setup, setSetup] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<Action>();
  const [error, setError] = useState<string>();
  const [tested, setTested] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await hostControlsStatus();
        if (active) setStatus(next);
      } catch {
        // A later refresh can recover from a transient failure.
      }
    };
    if (busy === undefined) void refresh();
    const interval = window.setInterval(() => {
      if (busy === undefined) void refresh();
    }, 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [busy]);

  if (!status || !(status.supported || status.enabled || status.cleanupPending)) return null;

  const ready = username.trim() !== "" && password !== "" && busy === undefined;

  const perform = async (action: Action) => {
    setBusy(action);
    setError(undefined);
    setTested(false);
    const credentials = { username, password };
    try {
      switch (action) {
        case "test":
          await testHostControls(credentials);
          setTested(true);
          break;
        case "enable":
          await enableHostControls(credentials, consent);
          setPassword("");
          break;
        case "disable": {
          const next = await disableHostControls();
          setStatus(next);
          setError(next.message ?? undefined);
          setSetup(false);
          setConsent(false);
          break;
        }
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section className="field" aria-labelledby="host-controls-title">
      <h4 id="host-controls-title">Host controls</h4>
      {status.enabled ? (
        <>
          <p role="status">{status.connected ? "Host controls connected" : "Host controls disconnected"}</p>
          <button type="button" disabled={busy !== undefined} onClick={() => void perform("disable")}>
            Disable host controls
          </button>
        </>
      ) : status.cleanupPending ? (
        <>
          <p role="status">Host controls are off. Home Assistant cleanup is pending.</p>
          <button type="button" disabled={busy !== undefined} onClick={() => void perform("disable")}>
            Retry broker cleanup
          </button>
        </>
      ) : (
        <>
          <p className="field-hint">Control the display and see or change Ruru’s running state in Home Assistant even when the wall is closed.</p>
          <button type="button" disabled={!mqttEnabled || setup} onClick={() => setSetup(true)}>
            Enable host controls
          </button>
          {!mqttEnabled && <p className="field-hint">Save the Home Assistant connection to enable host controls.</p>}
        </>
      )}
      {setup && !status.enabled && !status.cleanupPending && (
        <>
          <div className="field-row">
            <label className="field field-grow">
              Host controls MQTT username
              <input value={username} autoComplete="off" spellCheck={false} disabled={busy !== undefined} onChange={(event) => { setUsername(event.target.value); setTested(false); }} />
            </label>
            <label className="field field-grow">
              Host controls MQTT password
              <input type="password" value={password} autoComplete="off" disabled={busy !== undefined} onChange={(event) => { setPassword(event.target.value); setTested(false); }} />
            </label>
          </div>
          <p className="field-hint">Use an MQTT account dedicated to host controls on the saved broker. Ruru stores its credentials in a file readable only by your desktop account.</p>
          <label className="check">
            <input type="checkbox" checked={consent} disabled={busy !== undefined} onChange={(event) => setConsent(event.target.checked)} />
            Let Ruru manage its user service and replace any duplicate GNOME autostart entries. The wall will restart now and start at each graphical sign-in.
          </label>
          <div className="field-row">
            <button type="button" disabled={!ready} onClick={() => void perform("test")}>
              {busy === "test" ? "Testing…" : "Test host controls connection"}
            </button>
            <button type="button" disabled={!ready || !consent} onClick={() => void perform("enable")}>
              {busy === "enable" ? "Enabling…" : "Enable and restart Ruru"}
            </button>
          </div>
          {tested && <p className="test-ok" role="status">Connected with the host controls account.</p>}
        </>
      )}
      {(error || status.message) && <p className="test-failed" role="alert">{error ?? status.message}</p>}
    </section>
  );
}
