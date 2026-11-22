import { useState } from "react";
import type { AvailableUpdate } from "./updates";

interface Props {
  update: AvailableUpdate;
  /** The prompt is done: Not now, or a fake update "installed". */
  onClose: () => void;
}

/**
 * Offers the update found at startup. Not now only closes the prompt; the
 * next launch checks, and asks, again.
 */
export default function UpdatePrompt({ update, onClose }: Props) {
  const [installing, setInstalling] = useState(false);
  const [failed, setFailed] = useState(false);

  const install = async () => {
    setInstalling(true);
    setFailed(false);
    try {
      // A real update restarts Ruru before this resolves.
      await update.install();
      onClose();
    } catch {
      setInstalling(false);
      setFailed(true);
    }
  };

  return (
    <section className="update-prompt" role="dialog" aria-labelledby="update-prompt-text">
      <p id="update-prompt-text">Ruru {update.version} is ready. Install and restart?</p>
      {failed && (
        <p className="update-error" role="alert">
          The update could not be installed. Try again later.
        </p>
      )}
      <div className="update-actions">
        <button type="button" onClick={onClose} disabled={installing}>
          Not now
        </button>
        <button type="button" className="primary" onClick={install} disabled={installing}>
          {installing ? "Installing…" : "Install and restart"}
        </button>
      </div>
    </section>
  );
}
