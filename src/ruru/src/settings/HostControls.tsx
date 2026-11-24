import { useEffect, useState, type KeyboardEvent } from "react";
import {
  authoriseHostReboot,
  disableHostControls,
  enableHostControls,
  setHostReboot,
  hostControlsStatus,
  testHostControls,
  type HostControlsStatus,
} from "../app/api";

type Action = "test" | "enable" | "disable" | "toggle-reboot" | "authorise-reboot";

/** Sets up the independent Ubuntu service, signed in with Ruru’s Home Assistant account or its own. */
export default function HostControls({ mqttEnabled }: { mqttEnabled: boolean }) {
  const [status, setStatus] = useState<HostControlsStatus>();
  const [setup, setSetup] = useState(false);
  const [shared, setShared] = useState(true);
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

  const ready = busy === undefined && (shared || (username.trim() !== "" && password !== ""));

  const perform = async (action: Action) => {
    setBusy(action);
    setError(undefined);
    setTested(false);
    const credentials = shared ? { shared, username: "", password: "" } : { shared, username, password };
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
        case "toggle-reboot":
          setStatus(await setHostReboot(!status.rebootEnabled));
          break;
        case "authorise-reboot":
          setStatus(await authoriseHostReboot());
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

  // These fields sit inside the Home Assistant page's form, whose Enter saves the
  // broker and closes Settings. Enter here tests the host controls account instead.
  const testOnEnter = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    if (ready) void perform("test");
  };

  return (
    <section className="settings-section" aria-labelledby="host-controls-title">
      <h4 id="host-controls-title">Host controls</h4>
      {status.enabled ? (
        <>
          <div className="settings-test">
            <button type="button" disabled={busy !== undefined} onClick={() => void perform("disable")}>
              Disable host controls
            </button>
            <p role="status">{status.connected ? "Host controls connected" : "Host controls disconnected"}</p>
          </div>
          <div className="field-check">
            <input
              id="host-controls-reboot"
              type="checkbox"
              aria-describedby="host-controls-reboot-hint"
              checked={status.rebootEnabled}
              disabled={busy !== undefined}
              onChange={() => void perform("toggle-reboot")}
            />
            <label className="field-label" htmlFor="host-controls-reboot">
              Enable host reboot
            </label>
            <span id="host-controls-reboot-hint" className="field-hint">
              {status.rebootEnabled && status.rebootMessage
                ? status.rebootMessage
                : "Adds a Reboot host button to Home Assistant that requests a normal Ubuntu reboot."}
            </span>
          </div>
          {status.rebootEnabled && (
            <div className="settings-test">
              {status.rebootCanAuthorise && (
                <button type="button" disabled={busy !== undefined} onClick={() => void perform("authorise-reboot")}>
                  {busy === "authorise-reboot" ? "Waiting for approval…" : "Authorise host reboot"}
                </button>
              )}
              <p role="status">{status.rebootAvailable ? "Host reboot enabled" : "Host reboot unavailable"}</p>
            </div>
          )}
        </>
      ) : status.cleanupPending ? (
        <div className="settings-test">
          <button type="button" disabled={busy !== undefined} onClick={() => void perform("disable")}>
            Retry broker cleanup
          </button>
          <p role="status">Host controls are off. Home Assistant cleanup is pending.</p>
        </div>
      ) : (
        <>
          <span className="field-hint">
            Control the display and see or change Ruru’s running state in Home Assistant even when the wall is closed.
          </span>
          <div className="settings-test">
            <button type="button" disabled={!mqttEnabled || setup} onClick={() => setSetup(true)}>
              Enable host controls
            </button>
          </div>
          {!mqttEnabled && <span className="field-hint">Save the Home Assistant connection to enable host controls.</span>}
        </>
      )}
      {setup && !status.enabled && !status.cleanupPending && (
        <>
          <div className="field-check">
            <input
              id="host-controls-shared"
              type="checkbox"
              aria-describedby="host-controls-shared-hint"
              checked={shared}
              disabled={busy !== undefined}
              onChange={(event) => {
                setShared(event.target.checked);
                setTested(false);
              }}
            />
            <label className="field-label" htmlFor="host-controls-shared">
              Use Ruru’s Home Assistant account
            </label>
            <span id="host-controls-shared-hint" className="field-hint">
              {shared
                ? "The host agent signs in with the saved account above. Ruru copies its password to a file readable only by your desktop account, so the agent can connect while the wall is closed."
                : "Enter another MQTT account on the saved broker. Ruru stores it in a file readable only by your desktop account."}
            </span>
          </div>
          {!shared && (
            <div className="field-row" onKeyDown={testOnEnter}>
              <div className="field field-grow">
                <label className="field-label" htmlFor="host-controls-username">
                  Host controls MQTT username
                </label>
                <input
                  id="host-controls-username"
                  type="text"
                  value={username}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy !== undefined}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setTested(false);
                  }}
                />
              </div>
              <div className="field field-grow">
                <label className="field-label" htmlFor="host-controls-password">
                  Host controls MQTT password
                </label>
                <input
                  id="host-controls-password"
                  type="password"
                  value={password}
                  autoComplete="off"
                  disabled={busy !== undefined}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setTested(false);
                  }}
                />
              </div>
            </div>
          )}
          <div className="field-check">
            <input
              id="host-controls-consent"
              type="checkbox"
              aria-describedby="host-controls-consent-hint"
              checked={consent}
              disabled={busy !== undefined}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <label className="field-label" htmlFor="host-controls-consent">
              Let Ruru manage its user service
            </label>
            <span id="host-controls-consent-hint" className="field-hint">
              Ruru replaces any duplicate GNOME autostart entries. The wall restarts now and starts at each graphical sign-in.
            </span>
          </div>
          <div className="settings-test">
            <button type="button" disabled={!ready} onClick={() => void perform("test")}>
              {busy === "test" ? "Testing…" : "Test host controls connection"}
            </button>
            <button type="button" disabled={!ready || !consent} onClick={() => void perform("enable")}>
              {busy === "enable" ? "Enabling…" : "Enable and restart Ruru"}
            </button>
            {tested && (
              <p className="test-ok" role="status">
                {shared ? "Connected with Ruru’s Home Assistant account." : "Connected with the host controls account."}
              </p>
            )}
          </div>
        </>
      )}
      {(error || status.message) && (
        <p className="test-failed" role="alert">
          {error ?? status.message}
        </p>
      )}
    </section>
  );
}
