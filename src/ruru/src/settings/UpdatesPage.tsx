import { useState } from "react";
import { setAutoUpdate, setUpdateChannel, type AppInfo, type Settings, type UpdateChannel } from "../app/api";
import { checkForUpdate, UPDATE_CHANNELS, versionLabel, type AvailableUpdate } from "../app/updates";

interface UpdatesPageProps {
  info: AppInfo | null;
  channel: UpdateChannel;
  /** Install updates automatically is on. */
  autoUpdate: boolean;
  /** The channel was saved; the window uses the new settings. */
  onChannelSaved: (settings: Settings) => void;
  /** Install updates automatically was saved; the window uses the new settings. */
  onAutoUpdateSaved: (settings: Settings) => void;
  /** A check found an update, for the window's prompt after Settings closes. */
  onUpdate: (update: AvailableUpdate | null) => void;
  onClose: () => void;
}

type Check =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "found"; update: AvailableUpdate }
  | { kind: "installing"; update: AvailableUpdate }
  | { kind: "failed"; message: string; update?: AvailableUpdate };

/** The error's message for the user. Commands reject with a string. */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Settings › Updates: the version, the update channel, automatic updates and a check on demand. */
export default function UpdatesPage({ info, channel, autoUpdate, onChannelSaved, onAutoUpdateSaved, onUpdate, onClose }: UpdatesPageProps) {
  const [check, setCheck] = useState<Check>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const [toStable, setToStable] = useState(false);
  const busy = saving || check.kind === "checking" || check.kind === "installing";

  const runCheck = async () => {
    setCheck({ kind: "checking" });
    try {
      const update = await checkForUpdate();
      onUpdate(update);
      setCheck(update ? { kind: "found", update } : { kind: "current" });
    } catch (error) {
      onUpdate(null);
      setCheck({ kind: "failed", message: message(error) });
    }
  };

  // Switching forgets what the old channel offered and checks the new one at once.
  const changeChannel = async (next: UpdateChannel) => {
    setSaving(true);
    setCheck({ kind: "idle" });
    onUpdate(null);
    try {
      onChannelSaved(await setUpdateChannel(next));
      setToStable(next === "stable");
    } catch (error) {
      setCheck({ kind: "failed", message: message(error) });
      setSaving(false);
      return;
    }
    setSaving(false);
    await runCheck();
  };

  // Turning it on hands installing to the backend, which checks straight away.
  const changeAutoUpdate = async (enabled: boolean) => {
    setSaving(true);
    try {
      onAutoUpdateSaved(await setAutoUpdate(enabled));
      if (enabled) {
        onUpdate(null);
        setCheck({ kind: "idle" });
      }
    } catch (error) {
      setCheck({ kind: "failed", message: message(error) });
    }
    setSaving(false);
  };

  const install = async (update: AvailableUpdate) => {
    setCheck({ kind: "installing", update });
    try {
      // A real update restarts Ruru before this resolves.
      await update.install();
      onUpdate(null);
      setCheck({ kind: "idle" });
    } catch (error) {
      setCheck({ kind: "failed", message: message(error), update });
    }
  };

  const hint = UPDATE_CHANNELS.find((choice) => choice.value === channel)?.hint;
  const offered = check.kind === "found" || check.kind === "installing" || (check.kind === "failed" && check.update) ? check.update : undefined;

  return (
    <div className="settings-body">
      <h3 className="settings-title">Updates</h3>
      <div className="settings-content">
        <div className="field">
          <label className="field-label" htmlFor="update-channel">
            Update channel
          </label>
          <select
            id="update-channel"
            aria-describedby="update-channel-hint"
            value={channel}
            disabled={busy}
            data-autofocus
            onChange={(event) => void changeChannel(event.target.value as UpdateChannel)}
          >
            {UPDATE_CHANNELS.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.title}
              </option>
            ))}
          </select>
          <span id="update-channel-hint" className="field-hint">
            {hint}
            {toStable && channel === "stable" && " If you’re ahead of Stable, you keep your version until a newer Stable release is out."}
          </span>
        </div>
        <div className="field-check">
          <input
            id="auto-update"
            type="checkbox"
            aria-describedby="auto-update-hint"
            checked={autoUpdate}
            disabled={busy}
            onChange={(event) => void changeAutoUpdate(event.target.checked)}
          />
          <label className="field-label" htmlFor="auto-update">
            Install updates automatically
          </label>
          <span id="auto-update-hint" className="field-hint">
            Ruru checks at startup and every 6 hours, then installs the update and restarts without asking.
          </span>
        </div>
        <section className="settings-section" aria-labelledby="installed-version">
          <h4 id="installed-version">{info ? versionLabel(info, channel) : "Ruru"}</h4>
          <div className="settings-test" aria-live="polite">
            {offered ? (
              <button type="button" className="primary" onClick={() => void install(offered)} disabled={busy}>
                {check.kind === "installing" ? "Installing…" : "Install and restart"}
              </button>
            ) : (
              <button type="button" onClick={() => void runCheck()} disabled={busy}>
                {check.kind === "checking" ? "Checking…" : "Check for updates"}
              </button>
            )}
            {check.kind === "current" && <p className="test-ok">Ruru is up to date.</p>}
            {offered && <p className="test-ok">Ruru {offered.version} is ready.</p>}
            {check.kind === "failed" && (
              <p className="test-failed" role="alert">
                {check.message}
              </p>
            )}
          </div>
        </section>
      </div>
      <footer className="dialog-foot">
        <span className="dialog-foot-note">Changes save as you make them.</span>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </footer>
    </div>
  );
}
