import WallNotice from "./WallNotice";

/** Frigate answered, but its config has no cameras. */
export function NoCameras({ onCheck }: { onCheck: () => void }) {
  return (
    <WallNotice mood="puzzled" title="Frigate has no cameras yet">
      <p>Add a camera to Frigate's config. Ruru looks again each time you come back to this window.</p>
      <div className="wall-notice-buttons">
        <button type="button" onClick={onCheck}>
          Check again
        </button>
      </div>
    </WallNotice>
  );
}

interface EveryCameraHiddenProps {
  count: number;
  onShowAll: () => void;
  onEdit: () => void;
}

/** Every camera was hidden in Edit layout, so the wall has nothing to show. */
export function EveryCameraHidden({ count, onShowAll, onEdit }: EveryCameraHiddenProps) {
  return (
    <WallNotice mood="closed" title="Every camera is hidden">
      <p>{count === 1 ? "You hid the only camera in Edit layout." : `You hid all ${count} cameras in Edit layout.`}</p>
      <div className="wall-notice-buttons">
        <button type="button" className="primary" onClick={onShowAll}>
          Show all cameras
        </button>
        <button type="button" onClick={onEdit}>
          Edit layout
        </button>
      </div>
    </WallNotice>
  );
}
