import { cameraLabel } from "../app/frigate";
import { frigateProblem } from "./frigateProblem";
import WallNotice from "./WallNotice";

/** Above this many cameras the dots give way to a bar. */
export const MAX_DOTS = 12;

type ConnectingProps =
  /**
   * Asking Frigate for its cameras. `error` is set after an attempt failed;
   * Ruru then tries again on its own, and `attempt` counts each try.
   */
  | { stage: "frigate"; server: string; error?: string | null; attempt?: number; onRetry: () => void; onSettings: () => void }
  /** The cameras are known and their tiles are starting their streams, `connected` in the order they started. */
  | { stage: "cameras"; cameras: string[]; connected: string[] };

/** What the wall says when Frigate's cameras could not be read. */
function problemText(error: string, server: string) {
  const problem = frigateProblem(error);
  switch (problem.kind) {
    case "waiting":
      return {
        title: "Waiting for Frigate…",
        detail: `Frigate at ${server} isn't answering yet, as while it is still starting. If this lasts, check the address with Test connection in Settings.`,
      };
    case "status":
      return {
        title: "Frigate turned Ruru away",
        detail: `Frigate at ${server} answered with HTTP ${problem.status}. Check the address, and that Frigate allows access without signing in on this port.`,
      };
    case "unexpected":
      return {
        title: "That doesn't look like Frigate",
        detail: `Something answered at ${server}, but not with Frigate's camera list. Check the address and port.`,
      };
    case "unreachable":
      return {
        title: "Ruru can't reach Frigate",
        detail: `Nothing answered at ${server}. Check that Frigate is running and that this computer is on the same network.`,
      };
  }
}

/** Covers the wall while Ruru first reaches Frigate and its cameras. */
export default function Connecting(props: ConnectingProps) {
  if (props.stage === "cameras") {
    const { cameras, connected } = props;
    const done = cameras.filter((camera) => connected.includes(camera)).length;
    const total = cameras.length;
    // The owl glances towards the camera that connected last.
    const latest = connected.length ? cameras.indexOf(connected[connected.length - 1]) : -1;
    const look = latest < 0 || total < 2 ? 0 : (latest / (total - 1)) * 2 - 1;
    return (
      <WallNotice mood="counting" look={look} title="Connecting to your cameras" overlay>
        <p className="wall-notice-count">
          {done} of {total} {total === 1 ? "camera" : "cameras"} connected
        </p>
        {total <= MAX_DOTS ? (
          <ul className="wall-notice-dots" aria-label="Cameras">
            {cameras.map((camera) => {
              const on = connected.includes(camera);
              return <li key={camera} className={on ? "is-on" : undefined} aria-label={`${cameraLabel(camera)}: ${on ? "connected" : "connecting"}`} />;
            })}
          </ul>
        ) : (
          <div className="wall-notice-progress" role="progressbar" aria-label="Cameras connected" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <span style={{ width: `${(done / total) * 100}%` }} />
          </div>
        )}
      </WallNotice>
    );
  }
  const { server, error, attempt = 0, onRetry, onSettings } = props;
  if (!error) {
    return (
      <WallNotice mood="scanning" title="Looking for cameras">
        <p>Asking Frigate at {server}</p>
      </WallNotice>
    );
  }
  const { title, detail } = problemText(error, server);
  return (
    <WallNotice mood="drowsy" owlKey={attempt} title={title}>
      <p>{detail}</p>
      <p className="wall-notice-small">Ruru keeps trying on its own.</p>
      {error !== title && <code className="wall-notice-error">{error}</code>}
      <div className="wall-notice-buttons">
        <button type="button" className="primary" onClick={onRetry}>
          Try again
        </button>
        <button type="button" onClick={onSettings}>
          Settings
        </button>
      </div>
    </WallNotice>
  );
}
