import "./settings.css";
import { useState, type FormEvent } from "react";
import Dialog from "../app/Dialog";
import type { FrigateStatus } from "../app/frigate";
import { saveFrigateUrl, testFrigate, type AppInfo, type Settings, type WallOptions } from "../app/api";
import type { AvailableUpdate } from "../app/updates";
import AppearancePage from "./AppearancePage";
import HomeAssistantPage from "./HomeAssistantPage";
import UpdatesPage from "./UpdatesPage";

interface SettingsDialogProps {
  settings: Settings;
  /** The running version, for the Updates page. */
  info: AppInfo | null;
  /** The Frigate URL was saved; the wall uses the new one. */
  onSaved: (settings: Settings) => void;
  /** The update channel was saved. */
  onChannelSaved: (settings: Settings) => void;
  /** The Home Assistant connection was saved. */
  onMqttSaved: (settings: Settings) => void;
  /** The appearance settings were saved; the wall uses the new options. */
  onWallSaved: (options: WallOptions) => void;
  /** Install updates automatically was turned on or off. */
  onAutoUpdateSaved: (settings: Settings) => void;
  /** A check on the Updates page found an update, or found none. */
  onUpdate: (update: AvailableUpdate | null) => void;
  onClose: () => void;
}

type Page = "frigate" | "homeassistant" | "appearance" | "updates";
const PAGES: { page: Page; title: string; icon: string }[] = [
  { page: "frigate", title: "Frigate", icon: "M3 6h12v12H3z M15 10l6-4v12l-6-4" },
  { page: "homeassistant", title: "Home Assistant", icon: "m3 11 9-8 9 8 M5 9v12h14V9 M10 21v-6h4v6" },
  { page: "appearance", title: "Appearance", icon: "M3 5h18v14H3z M3 15l5-5 4 4 3-3 6 6" },
  { page: "updates", title: "Updates", icon: "M20 10a8 8 0 1 0-1 7 M20 4v6h-6" },
];

type Test = { kind: "idle" } | { kind: "testing" } | { kind: "ok"; status: FrigateStatus } | { kind: "failed"; message: string };

/** The error's message for the user. Commands reject with a string. */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Settings over the wall, with a page for each group of options. */
export default function SettingsDialog({ settings, info, onSaved, onChannelSaved, onAutoUpdateSaved, onMqttSaved, onWallSaved, onUpdate, onClose }: SettingsDialogProps) {
  const [page, setPage] = useState<Page>("frigate");
  const [url, setUrl] = useState(settings.frigateUrl ?? "");
  const [test, setTest] = useState<Test>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const runTest = async () => {
    setTest({ kind: "testing" });
    try {
      setTest({ kind: "ok", status: await testFrigate(url) });
    } catch (error) {
      setTest({ kind: "failed", message: message(error) });
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      onSaved(await saveFrigateUrl(url));
      onClose();
    } catch (error) {
      setSaveError(message(error));
      setSaving(false);
    }
  };

  const cameras = (count: number) => (count === 1 ? "1 camera" : `${count} cameras`);

  return (
    <Dialog title="Settings" hideTitle className="settings-dialog" onClose={onClose}>
      <nav className="settings-nav" aria-label="Settings pages">
        <p className="settings-nav-title" aria-hidden="true">
          Settings
        </p>
        {PAGES.map((item) => (
          <button
            key={item.page}
            type="button"
            className={`nav-item${page === item.page ? " is-current" : ""}`}
            aria-current={page === item.page ? "page" : undefined}
            onClick={() => setPage(item.page)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d={item.icon} />
            </svg>
            <span>{item.title}</span>
          </button>
        ))}
      </nav>
      <button type="button" className="settings-close" aria-label="Close Settings" onClick={onClose}>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
      {page === "homeassistant" && <HomeAssistantPage mqtt={settings.mqtt} onSaved={onMqttSaved} onClose={onClose} />}
      {page === "appearance" && <AppearancePage wall={settings.wall} mqttEnabled={settings.mqtt.enabled} onSaved={onWallSaved} onClose={onClose} />}
      {page === "updates" && (
        <UpdatesPage
          info={info}
          channel={settings.updateChannel}
          autoUpdate={settings.autoUpdate}
          onChannelSaved={onChannelSaved}
          onAutoUpdateSaved={onAutoUpdateSaved}
          onUpdate={onUpdate}
          onClose={onClose}
        />
      )}
      {page === "frigate" && (
        <form className="settings-body" onSubmit={save}>
          <h3 className="settings-title">Frigate</h3>
          <div className="settings-content">
            <div className="field">
              <label className="field-label" htmlFor="frigate-url">
                Frigate URL
              </label>
              <input
                id="frigate-url"
                aria-describedby="frigate-url-hint"
                type="text"
                inputMode="url"
                value={url}
                placeholder="http://frigate.local:5000"
                autoComplete="off"
                spellCheck={false}
                data-autofocus
                onChange={(event) => {
                  setUrl(event.target.value);
                  setTest({ kind: "idle" });
                  setSaveError(null);
                }}
              />
              <span id="frigate-url-hint" className="field-hint">
                The address you open Frigate at, on its unauthenticated port (usually 5000).
              </span>
            </div>
            <div className="settings-test" aria-live="polite">
              <button type="button" onClick={runTest} disabled={!url.trim() || test.kind === "testing"}>
                {test.kind === "testing" ? "Testing…" : "Test connection"}
              </button>
              {test.kind === "ok" && (
                <p className="test-ok">
                  Connected to Frigate {test.status.version}, with {cameras(test.status.cameraCount)}.
                </p>
              )}
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
          <footer className="dialog-foot">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!url.trim() || saving}>
              Save
            </button>
          </footer>
        </form>
      )}
    </Dialog>
  );
}
