import { useEffect, useRef, useState } from "react";
import { cameraLabel, snapshotUrl, type Camera } from "../app/frigate";
import { Go2rtcPlayer, type PlayerState } from "./player";

import TileDiagnostics from "./TileDiagnostics";

interface TileProps {
  base: string;
  camera: Camera;
  /** The go2rtc stream to play: the sub stream on the wall, main when maximised. */
  stream: string;
  /** False while the window is hidden, so no stream runs. */
  live: boolean;
  /** Bumped when cameras are rediscovered, so the snapshot is fetched again. */
  refresh?: number;
  editing?: boolean;
  onOpen?: () => void;
  onHide?: () => void;
}

/** One camera: its snapshot until the video plays, then the live stream. */
export default function Tile({ base, camera, stream, live, refresh = 0, editing = false, onOpen, onHide }: TileProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<PlayerState>("connecting");
  const activePlayer = useRef<Go2rtcPlayer | null>(null);
  const label = cameraLabel(camera.name);

  useEffect(() => {
    const element = video.current;
    if (!live || !element) return;
    const player = new Go2rtcPlayer({ base, stream, video: element, onState: setState });
    activePlayer.current = player;
    player.start();
    return () => {
      activePlayer.current = null;
      player.stop();
      setState("connecting");
    };
  }, [base, stream, live]);

  const playing = live && (state === "playing" || state === "stalled");
  return (
    <figure
      className={`tile${playing ? " is-playing" : ""}`}
      aria-label={label}
      data-camera={camera.name}
      onDoubleClick={editing ? undefined : onOpen}
    >
      <img
        className="tile-snapshot"
        src={`${snapshotUrl(base, camera.name)}${refresh ? `?t=${refresh}` : ""}`}
        alt=""
        draggable={false}
      />
      <video ref={video} className="tile-video" muted playsInline autoPlay />
      {editing && live && <TileDiagnostics key={`${base}/${stream}`} player={activePlayer} video={video} stream={stream} state={state} />}
      <figcaption className="tile-name">
        {label}
        {state === "retrying" && live && <span className="tile-status"> · Reconnecting…</span>}
      </figcaption>
      {editing && onHide && (
        <button type="button" className="tile-hide" aria-label={`Hide ${label}`} onClick={onHide}>
          Hide
        </button>
      )}
    </figure>
  );
}
