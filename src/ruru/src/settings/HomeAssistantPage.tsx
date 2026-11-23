import { useEffect, useRef, useState, type FormEvent } from "react";
import { saveMqtt, testMqtt, type MqttInput, type MqttSettings, type Settings } from "../app/api";

interface HomeAssistantPageProps {
  mqtt: MqttSettings;
  /** The connection was saved; the window uses the new settings. */
  onSaved: (settings: Settings) => void;
  onClose: () => void;
}

/** MQTT's usual ports, without and with TLS. */
const PLAIN_PORT = 1883;
const TLS_PORT = 8883;

type Test = { kind: "idle" } | { kind: "testing" } | { kind: "ok"; address: string } | { kind: "failed"; message: string };

/** The error's message for the user. Commands reject with a string. */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The port as typed, or null when it is not one. */
function parsePort(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const port = Number(text.trim());
  return port >= 1 && port <= 65535 ? port : null;
}

/** Settings › Home Assistant: the MQTT broker in Home Assistant that Ruru connects to. */
export default function HomeAssistantPage({ mqtt, onSaved, onClose }: HomeAssistantPageProps) {
  const [enabled, setEnabled] = useState(mqtt.enabled);
  const [host, setHost] = useState(mqtt.host);
  const [port, setPort] = useState(String(mqtt.port));
  const [tls, setTls] = useState(mqtt.tls);
  const [username, setUsername] = useState(mqtt.username);
  // Null until typed in. Left empty, the saved password stays.
  const [password, setPassword] = useState<string | null>(null);
  const [discoveryPrefix, setDiscoveryPrefix] = useState(mqtt.discoveryPrefix);
  const [frigatePrefix, setFrigatePrefix] = useState(mqtt.frigatePrefix);
  const [test, setTest] = useState<Test>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saved = mqtt.passwordStorage !== "none" && !password;

  // The page scrolls, so a result below the fold is brought into view.
  const result = useRef<HTMLDivElement>(null);
  const shown = test.kind === "ok" || test.kind === "failed" || saveError !== null;
  useEffect(() => {
    if (shown) result.current?.scrollIntoView?.({ block: "nearest" });
  }, [shown, test, saveError]);
  const changed = () => {
    setTest({ kind: "idle" });
    setSaveError(null);
  };
  const input = (): MqttInput | string => {
    const number = parsePort(port);
    if (number === null) return "Enter a port from 1 to 65535.";
    return { enabled, host, port: number, tls, username, discoveryPrefix, frigatePrefix };
  };

  const runTest = async () => {
    const value = input();
    if (typeof value === "string") return setTest({ kind: "failed", message: value });
    setTest({ kind: "testing" });
    try {
      await testMqtt(value, password || null);
      setTest({ kind: "ok", address: `${value.host.trim()}:${value.port}` });
    } catch (error) {
      setTest({ kind: "failed", message: message(error) });
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const value = input();
    if (typeof value === "string") return setSaveError(value);
    setSaving(true);
    setSaveError(null);
    try {
      onSaved(await saveMqtt(value, password || null));
      onClose();
    } catch (error) {
      setSaveError(message(error));
      setSaving(false);
    }
  };

  // Turning TLS on or off moves a port left at the usual one to the other usual one.
  const changeTls = (next: boolean) => {
    setTls(next);
    if (parsePort(port) === (next ? PLAIN_PORT : TLS_PORT)) setPort(String(next ? TLS_PORT : PLAIN_PORT));
    changed();
  };

  return (
    <form className="settings-body" onSubmit={save}>
      <h3 className="settings-title">Home Assistant</h3>
      <div className="settings-content">
        <label className="check">
          <input
            type="checkbox"
            checked={enabled}
            data-autofocus
            onChange={(event) => {
              setEnabled(event.target.checked);
              changed();
            }}
          />
          Connect to Home Assistant
        </label>
        <p className="field-hint">
          Ruru shows up in Home Assistant as a device, through the MQTT broker that Home Assistant uses.
        </p>
        <div className="field-row">
          <div className="field field-grow">
            <label className="field-label" htmlFor="mqtt-host">
              Broker
            </label>
            <input
              id="mqtt-host"
              type="text"
              value={host}
              placeholder="homeassistant.local"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setHost(event.target.value);
                changed();
              }}
            />
          </div>
          <div className="field field-port">
            <label className="field-label" htmlFor="mqtt-port">
              Port
            </label>
            <input
              id="mqtt-port"
              type="text"
              inputMode="numeric"
              value={port}
              onChange={(event) => {
                setPort(event.target.value);
                changed();
              }}
            />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={tls} onChange={(event) => changeTls(event.target.checked)} />
          Use TLS
        </label>
        <div className="field-row">
          <div className="field field-grow">
            <label className="field-label" htmlFor="mqtt-username">
              Username
            </label>
            <input
              id="mqtt-username"
              type="text"
              value={username}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setUsername(event.target.value);
                changed();
              }}
            />
          </div>
          <div className="field field-grow">
            <label className="field-label" htmlFor="mqtt-password">
              Password
            </label>
            <input
              id="mqtt-password"
              type="password"
              aria-describedby="mqtt-password-hint"
              value={password ?? ""}
              placeholder={saved ? "Saved" : ""}
              autoComplete="off"
              onChange={(event) => {
                setPassword(event.target.value);
                changed();
              }}
            />
          </div>
        </div>
        <span id="mqtt-password-hint" className="field-hint">
          {mqtt.passwordStorage === "file" && "This computer has no keychain Ruru can use, so the password is kept in Ruru’s settings file."}
          {mqtt.passwordStorage === "keychain" && "The password is kept in this computer’s keychain."}
          {mqtt.passwordStorage === "none" && "Ruru keeps the password in this computer’s keychain if it has one, or else in Ruru’s settings file."}
        </span>
        <div className="field-row">
          <div className="field field-grow">
            <label className="field-label" htmlFor="mqtt-discovery">
              Discovery prefix
            </label>
            <input
              id="mqtt-discovery"
              type="text"
              value={discoveryPrefix}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setDiscoveryPrefix(event.target.value);
                changed();
              }}
            />
          </div>
          <div className="field field-grow">
            <label className="field-label" htmlFor="mqtt-frigate">
              Frigate prefix
            </label>
            <input
              id="mqtt-frigate"
              type="text"
              value={frigatePrefix}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setFrigatePrefix(event.target.value);
                changed();
              }}
            />
          </div>
        </div>
        <div ref={result} className="settings-results">
          <div className="settings-test" aria-live="polite">
            <button type="button" onClick={() => void runTest()} disabled={!host.trim() || test.kind === "testing"}>
              {test.kind === "testing" ? "Testing…" : "Test connection"}
            </button>
            {test.kind === "ok" && <p className="test-ok">Connected to the broker at {test.address}.</p>}
            {test.kind === "failed" && (
              <p className="test-failed" role="alert">
                {test.message}
              </p>
            )}
          </div>
          {saveError && (
            <p className="test-failed" role="alert">
              {saveError}
            </p>
          )}
        </div>
      </div>
      <footer className="dialog-foot">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={saving || (enabled && !host.trim())}>
          Save
        </button>
      </footer>
    </form>
  );
}
