import type { AutoUpdateStatus } from "./updates";

interface Props {
  status: AutoUpdateStatus;
  /** The user put away the notice of a failed install. */
  onClose: () => void;
}

/**
 * Says what Install updates automatically is doing. While it installs there
 * is nothing to choose; Ruru restarts on its own. A failed install can be put
 * away, and the next check tries again.
 */
export default function AutoUpdateNotice({ status, onClose }: Props) {
  if (status.state === "installing") {
    return (
      <section className="update-prompt" role="status">
        <p>Installing Ruru {status.version}. Ruru will restart in a moment.</p>
      </section>
    );
  }
  return (
    <section className="update-prompt" role="alert">
      <p>Ruru {status.version} could not be installed. Ruru will try again later.</p>
      <p className="update-error">{status.message}</p>
      <div className="update-actions">
        <button type="button" onClick={onClose}>
          OK
        </button>
      </div>
    </section>
  );
}
