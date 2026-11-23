import WallNotice from "./WallNotice";

interface StreamsOffProps {
  /** Home Assistant is connected, so its Streams switch can turn them back on too. */
  homeAssistant: boolean;
  onStart: () => void;
}

/** Fills the wall while every stream is stopped, such as overnight, and says how to start them again. */
export default function StreamsOff({ homeAssistant, onStart }: StreamsOffProps) {
  return (
    <WallNotice mood="asleep" title="Streams are off">
      <p>Ruru isn't pulling any video from Frigate.</p>
      <p className="wall-notice-small">
        To turn them back on, choose <strong>Start streams</strong> below, or right-click anywhere and choose <strong>Start streams</strong>.
        {homeAssistant && (
          <>
            {" "}
            You can also turn on the <strong>Streams</strong> switch in Home Assistant.
          </>
        )}
      </p>
      <div className="wall-notice-buttons">
        <button type="button" className="primary" onClick={onStart}>
          Start streams
        </button>
      </div>
    </WallNotice>
  );
}
