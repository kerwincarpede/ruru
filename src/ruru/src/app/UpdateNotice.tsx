import type { UpdateStatus } from "./updates";

interface Props {
  status: UpdateStatus;
  /** The user put away the notice of a failed install. */
  onClose: () => void;
}

/**
 * Says what an update is doing, whether the user, Home Assistant or Install
 * updates automatically started it. While it downloads and installs there is
 * nothing to choose; Ruru restarts on its own. A failed install can be put
 * away.
 */
export default function UpdateNotice({ status, onClose }: Props) {
  if (status.state === "downloading") {
    const { percent } = status;
    return (
      <section className="update-prompt" role="status">
        <p>
          Downloading Ruru {status.version}
          {percent === null ? "…" : `: ${percent}%.`} Ruru will restart when it’s done.
        </p>
        <progress
          className="update-progress"
          aria-label={`Downloading Ruru ${status.version}`}
          max={100}
          {...(percent === null ? {} : { value: percent })}
        />
      </section>
    );
  }
  if (status.state === "installing") {
    return (
      <section className="update-prompt" role="status">
        <p>Installing Ruru {status.version}. Ruru will restart in a moment.</p>
      </section>
    );
  }
  return (
    <section className="update-prompt" role="alert">
      <p>
        Ruru {status.version} could not be installed.{status.automatic ? " Ruru will try again later." : ""}
      </p>
      <p className="update-error">{status.message}</p>
      <div className="update-actions">
        <button type="button" onClick={onClose}>
          OK
        </button>
      </div>
    </section>
  );
}
