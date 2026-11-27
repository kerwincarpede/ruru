import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { CameraActivity } from "../app/api";
import { cameraLabel, snapshotUrl, type Camera } from "../app/frigate";
import { Go2rtcPlayer, isUndecodable, type PlayerState } from "./player";
import { AUTO_SETTLE_MS, automaticStream, knownWidth, recordWidth, type StreamKind } from "./streams";
import { objectChip } from "./activity";
import Owl from "../app/Owl";
import TileDiagnostics from "./TileDiagnostics";
import { useLasting } from "../app/useLasting";

interface TileProps {
  base: string;
  camera: Camera;
  /** The saved stream choice; undefined plays Automatic, which follows the tile's size. */
  choice?: StreamKind;
  /** False while the window is hidden, so no stream runs. */
  live: boolean;
  /** The tile fills the window. */
  maximised?: boolean;
  /** True while a Dynamic wall takeover fills the window, so Automatic keeps the saved-layout stream. */
  takeover?: boolean;
  /** The tile's width in CSS pixels in the saved overview layout; when given, Automatic uses it instead of measuring the cell. */
  savedWidth?: number;
  /** Bumped to reconnect the tile's stream. */
  reconnect?: number;
  /** Bumped when cameras are rediscovered, so the snapshot is fetched again. */
  refresh?: number;
  editing?: boolean;
  streamInfo?: boolean;
  /** What Frigate says is happening on the camera; undefined draws no activity. */
  activity?: CameraActivity;
  onOpen?: () => void;
  onHide?: () => void;
  /** Told what Automatic plays on this tile whenever that changes. */
  onAutomatic?: (stream: StreamKind) => void;
  /** Told, while the window is shown, whether the tile has a problem: it can't play, or has been reconnecting for {@link PROBLEM_AFTER_MS}. */
  onProblem?: (problem: boolean) => void;
  /** Told each time the tile starts playing video. */
  onPlaying?: () => void;
  /** Told whether the tile is reconnecting or frozen right now, as soon as that changes. */
  onReconnecting?: (reconnecting: boolean) => void;
}

/** How long a tile reconnects, or stays frozen, before it counts as a problem. */
export const PROBLEM_AFTER_MS = 30_000;
/**
 * How long a reconnecting tile keeps its dimmed last frame. After that, or
 * at once when it has no frame of its own, the tile shows the owl instead,
 * so the wall never passes off an old picture as the camera's view.
 */
export const KEEP_FROZEN_MS = 30_000;
/** How long the outgoing video stays opaque behind the new stream after a handover. */
export const HANDOVER_RETIRE_MS = 250;
/** Incoming `requestVideoFrameCallback` frames required before swapping streams in front. */
const HANDOVER_FRAMES = 2;

const hasVideoFrameCallback = () =>
  typeof HTMLVideoElement !== "undefined" && typeof HTMLVideoElement.prototype.requestVideoFrameCallback === "function";

/** A player state with a picture on screen. */
const showing = (state: PlayerState) => state === "playing" || state === "stalled";

/** One go2rtc player on `video`, running while `stream` is set and the window is live. */
function usePlayer(video: RefObject<HTMLVideoElement | null>, base: string, stream: string | null, live: boolean, reconnect: number, onState: (state: PlayerState, player: Go2rtcPlayer) => void) {
  const [state, setState] = useState<PlayerState>("connecting");
  const player = useRef<Go2rtcPlayer | null>(null);
  const report = useRef(onState);
  useEffect(() => {
    report.current = onState;
  });
  useEffect(() => {
    const element = video.current;
    if (!live || !element || !stream) return;
    const created: Go2rtcPlayer = new Go2rtcPlayer({
      base,
      stream,
      video: element,
      onState: (next) => {
        report.current(next, created);
        setState(next);
      },
    });
    player.current = created;
    created.start();
    return () => {
      player.current = null;
      created.stop();
      setState("connecting");
    };
  }, [video, base, stream, live, reconnect]);
  return { state, player };
}

/**
 * The tile's width in device pixels, for Automatic. When `savedWidth` is
 * given, Automatic follows the saved layout instead of the rendered cell so
 * Dynamic wall hero moves do not switch streams. The first width counts at
 * once and later changes wait to settle; null until measured.
 */
function useDeviceWidth(tile: RefObject<HTMLElement | null>, savedWidth?: number): number | null {
  const fixed = savedWidth !== undefined;
  const [measured, setMeasured] = useState<number | null>(() => (typeof ResizeObserver === "undefined" ? 0 : null));
  const [ratio, setRatio] = useState(() => window.devicePixelRatio || 1);
  const desiredWidth = savedWidth === undefined ? null : Math.round(savedWidth * ratio);
  const [settledWidth, setSettledWidth] = useState(desiredWidth);
  useEffect(() => {
    if (desiredWidth === settledWidth) return;
    const timer = setTimeout(() => setSettledWidth(desiredWidth), AUTO_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [desiredWidth, settledWidth]);
  useEffect(() => {
    if (fixed) {
      const onResize = () => setRatio(window.devicePixelRatio || 1);
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }
    // The grid cell keeps its size while the tile is maximised over the window.
    const element = tile.current?.parentElement ?? tile.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    const measure = () => setMeasured(Math.round(element.getBoundingClientRect().width * (window.devicePixelRatio || 1)));
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(measure, AUTO_SETTLE_MS);
    };
    const observer = new ResizeObserver(() => {
      if (!first) return settle();
      first = false;
      measure();
    });
    observer.observe(element);
    // Moving to a screen with another pixel ratio resizes the window, not the tile.
    window.addEventListener("resize", settle);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("resize", settle);
    };
  }, [tile, fixed]);
  return fixed ? (settledWidth ?? desiredWidth) : measured;
}

/** The time, updated every second while `active`, and a function to read it now. */
function useClock(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const tick = useCallback(() => {
    const current = Date.now();
    setNow(current);
    return current;
  }, []);
  return [now, tick] as const;
}

type Slots = { front: 0 | 1; streams: [string | null, string | null]; retiring: boolean; handover: number };

/**
 * One camera: its snapshot until the video plays, then the live stream. A
 * change of stream plays the new one out of sight and swaps it in once a
 * frame shows, so the picture never stops moving; a stream the webview
 * cannot decode gives way to the camera's other stream.
 */
export default function Tile({ base, camera, choice, live, maximised = false, takeover = false, savedWidth, reconnect = 0, refresh = 0, editing = false, streamInfo = false, activity, onOpen, onHide, onAutomatic, onProblem, onPlaying, onReconnecting }: TileProps) {
  const figure = useRef<HTMLElement>(null);
  const videoA = useRef<HTMLVideoElement>(null);
  const videoB = useRef<HTMLVideoElement>(null);
  const videos = [videoA, videoB] as const;
  const freeze = useRef<HTMLCanvasElement>(null);
  const label = cameraLabel(camera.name);
  const nameOf = (kind: StreamKind) => (kind === "main" ? camera.mainStream : camera.subStream);

  // Automatic: main once the tile is well wider than the sub stream's picture.
  // Heroes and takeovers keep the saved-layout stream; manual maximise uses the window width.
  const manualMaximised = maximised && !takeover;
  const measured = useDeviceWidth(figure, savedWidth);
  const [subWidth, setSubWidth] = useState(() => knownWidth(base, camera.subStream));
  const width = manualMaximised ? window.innerWidth * (window.devicePixelRatio || 1) : (measured ?? 0);
  const [automatic, setAutomatic] = useState<StreamKind>(() => automaticStream(width, subWidth));
  const nextAutomatic = automaticStream(width, subWidth, automatic);
  if (nextAutomatic !== automatic) setAutomatic(nextAutomatic);
  useEffect(() => { onAutomatic?.(automatic); }, [automatic, onAutomatic]);

  const wanted = choice ?? automatic;
  const other: StreamKind = wanted === "main" ? "sub" : "main";
  const twoStreams = camera.mainStream !== camera.subStream;
  const fallback = twoStreams && isUndecodable(base, nameOf(wanted)) && !isUndecodable(base, nameOf(other));
  const target = measured === null && !manualMaximised ? null : nameOf(fallback ? other : wanted);

  // The frozen frame of a stalled or reconnecting stream, and when it last moved.
  const [frozenAt, setFrozenAt] = useState<number | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [clock, tick] = useClock(frozenAt !== null && live);
  const front = useRef<0 | 1>(0);
  const onState = useCallback((slot: 0 | 1, state: PlayerState, player: Go2rtcPlayer) => {
    if (slot !== front.current) return;
    if (state === "playing") {
      setFrozenAt(null);
      setFrozen(false);
      return;
    }
    if (state !== "stalled" && state !== "retrying" && state !== "failed") return;
    const lastFrame = player.lastFrameAt();
    if (lastFrame !== undefined) setFrozenAt(lastFrame);
    const now = tick();
    // Called before the player clears the video, so its last frame can be kept.
    if (state !== "retrying" || lastFrame === undefined || now - lastFrame >= KEEP_FROZEN_MS) return;
    const video = slot === 0 ? videoA.current : videoB.current;
    const canvas = freeze.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    const bounds = video.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const scale = Math.min(1, bounds.width * ratio / video.videoWidth, bounds.height * ratio / video.videoHeight);
    if (scale <= 0) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    // Hardware-decoded video on WebKitGTK can draw a transparent canvas
    // (alpha === 0); show the owl straight away instead of an empty frame.
    if (typeof context.getImageData === "function") {
      try {
        const alpha = context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[3];
        if (alpha === 0) {
          canvas.width = 0;
          canvas.height = 0;
          setFrozen(false);
          return;
        }
      } catch {
        // A tainted canvas cannot be read back; keep the frame as drawn.
      }
    }
    setFrozen(true);
  }, [tick]);

  const [slots, setSlots] = useState<Slots>({ front: 0, streams: [null, null], retiring: false, handover: 0 });
  const a = usePlayer(videoA, base, slots.streams[0], live, reconnect, (state, player) => onState(0, state, player));
  const b = usePlayer(videoB, base, slots.streams[1], live, reconnect, (state, player) => onState(1, state, player));
  const players = [a, b] as const;
  const back = slots.front === 0 ? 1 : 0;
  const frontState = players[slots.front].state;
  const frontStream = slots.streams[slots.front];
  const backStream = slots.streams[back];
  const [painted, setPainted] = useState<{ handover: number; reconnect: number } | null>(null);
  const backReady = !hasVideoFrameCallback() || (painted?.handover === slots.handover && painted.reconnect === reconnect);
  const set = (frontNext: string | null, backNext: string | null, which = slots.front, retiring = false): Slots => {
    const streams: Slots["streams"] = which === 0 ? [frontNext, backNext] : [backNext, frontNext];
    return { front: which, streams, retiring, handover: slots.handover + 1 };
  };
  let next = slots;
  if (target !== frontStream) {
    // The stream already starting out of sight takes over once two frames have
    // painted (or once playing where rVFC is missing), keeping the old video
    // opaque underneath briefly. When nothing is showing, switch at once.
    if (backStream === target && !slots.retiring && live && showing(frontState) && players[back].state === "playing" && backReady) {
      next = set(target, frontStream, back, true);
    } else if (backStream === target && (!live || !showing(frontState))) {
      next = set(target, null, back, false);
    } else if (!live || !showing(frontState)) {
      next = set(target, null, slots.front, false);
    } else if (backStream !== target || slots.retiring) {
      next = set(frontStream, target, slots.front, false);
    }
  } else if (backStream !== null && (!slots.retiring || !live || !showing(frontState))) {
    next = set(frontStream, null, slots.front, false);
  }
  if (next !== slots) setSlots(next);
  useEffect(() => {
    front.current = slots.front;
  }, [slots.front]);

  // Wait for two painted incoming frames before swapping the new stream in front.
  const incoming = !slots.retiring && backStream !== null && backStream === target && live;
  const backVideo = back === 0 ? videoA : videoB;
  useEffect(() => {
    if (!incoming) return;
    const video = backVideo.current;
    if (!video || typeof video.requestVideoFrameCallback !== "function") return;
    let cancelled = false;
    let frames = 0;
    let handle: number | null = null;
    const handover = slots.handover;
    const onFrame = () => {
      handle = null;
      if (cancelled) return;
      frames += 1;
      if (frames >= HANDOVER_FRAMES) {
        setPainted({ handover, reconnect });
      } else {
        handle = video.requestVideoFrameCallback(onFrame);
      }
    };
    handle = video.requestVideoFrameCallback(onFrame);
    return () => {
      cancelled = true;
      if (handle !== null && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(handle);
      }
    };
  }, [incoming, backVideo, slots.handover, reconnect]);

  // Keep the outgoing video opaque behind the new front video for HANDOVER_RETIRE_MS,
  // then tear it down so the freshly promoted layer never flashes through.
  useEffect(() => {
    if (!slots.retiring) return;
    const timer = setTimeout(() => {
      setSlots((current) => {
        if (!current.retiring) return current;
        const streams: Slots["streams"] = current.front === 0 ? [current.streams[0], null] : [null, current.streams[1]];
        return { front: current.front, streams, retiring: false, handover: current.handover + 1 };
      });
    }, HANDOVER_RETIRE_MS);
    return () => clearTimeout(timer);
  }, [slots.retiring, slots.front]);

  const playing = live && showing(frontState);
  const stale = live && frozenAt !== null && frontState !== "playing" && frontState !== "failed";
  const age = frozenAt === null ? 0 : Math.max(0, Math.round((clock - frozenAt) / 1000));
  const failed = live && frontState === "failed";
  let status: string | null = null;
  if (failed) status = "Can't play this stream";
  else if (stale) status = `${frontState === "stalled" ? "Frozen" : "Reconnecting"} · ${age} s old`;
  else if (live && frontState === "retrying") status = "Reconnecting…";

  // Trouble lasts from a freeze or a dropped stream until a frame plays again,
  // through the reconnect attempts in between.
  const [troubled, setTroubled] = useState(false);
  const troubleNow = live && frontState !== "playing" && (troubled || frontState === "stalled" || frontState === "retrying");
  if (troubled !== troubleNow) setTroubled(troubleNow);
  const reconnecting = troubleNow && !failed;
  const lastingTrouble = useLasting(reconnecting, PROBLEM_AFTER_MS);
  const problem = failed || lastingTrouble;
  // The dimmed last frame stays up only while it is recent; then the owl takes over.
  const held = playing || (stale && frozen);
  const recent = frozenAt !== null && clock - frozenAt < KEEP_FROZEN_MS;
  const keepFrozen = live && recent && !failed && frontState !== "playing";
  if (frozen && !keepFrozen) setFrozen(false);
  // Returning to the live picture or the owl retires the canvas backing bitmap.
  useEffect(() => {
    const canvas = freeze.current;
    if (!keepFrozen && canvas?.width) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }, [keepFrozen]);
  const lost = reconnecting && !(held && recent);
  if (lost) status = null;
  const reportProblem = useRef(onProblem);
  useEffect(() => {
    reportProblem.current = onProblem;
  });
  const reportReconnecting = useRef(onReconnecting);
  useEffect(() => {
    reportReconnecting.current = onReconnecting;
  });
  useEffect(() => {
    reportReconnecting.current?.(reconnecting);
  }, [reconnecting]);
  const reportPlaying = useRef(onPlaying);
  useEffect(() => {
    reportPlaying.current = onPlaying;
  });
  useEffect(() => {
    if (playing) reportPlaying.current?.();
  }, [playing]);
  // While the window is hidden nothing plays, so the last report stands.
  useEffect(() => {
    if (live) reportProblem.current?.(problem);
  }, [live, problem]);

  const onSize = (slot: 0 | 1) => () => {
    const video = videos[slot].current;
    if (video && slots.streams[slot] === camera.subStream && video.videoWidth) {
      recordWidth(base, camera.subStream, video.videoWidth);
      setSubWidth(video.videoWidth);
    }
  };

  // Frigate has no snapshot for a camera that is offline or still starting.
  const [noSnapshot, setNoSnapshot] = useState(false);
  const waiting = noSnapshot && !playing && !(stale && frozen) && !lost;
  const objects = Object.entries(activity?.objects ?? {}).filter(([, count]) => count > 0);
  const alert = activity?.review === "alert";
  const className = ["tile", playing && "is-playing", stale && "is-stale", reconnecting && "is-reconnecting", lost && "is-lost", maximised && "is-maximised", editing && "is-editing", activity?.motion && "has-motion", alert && "is-alert"].filter(Boolean).join(" ");
  return (
    <figure ref={figure} className={className} aria-label={label} data-camera={camera.name} onDoubleClick={editing ? undefined : onOpen}>
      <img className="tile-snapshot" src={`${snapshotUrl(base, camera.name)}${refresh ? `?t=${refresh}` : ""}`} alt="" draggable={false} onLoad={() => setNoSnapshot(false)} onError={() => setNoSnapshot(true)} />
      {waiting && (
        <div className="tile-waiting">
          <Owl mood="dim" className="on-wall" />
          Waiting for a picture
        </div>
      )}
      <canvas ref={freeze} width={0} height={0} className={`tile-freeze${stale && frozen && !playing && !lost ? " is-shown" : ""}`} aria-hidden="true" />
      {lost && (
        <div className="tile-waiting tile-lost">
          <Owl mood="searching" className="on-wall" />
          Reconnecting…
        </div>
      )}
      <div className="tile-videos">
        {([0, 1] as const).map((slot) => (
          <video
            key={slot}
            ref={videos[slot]}
            className={`tile-video${slot === slots.front ? " is-front" : slots.retiring && slots.streams[slot] !== null ? " is-retiring" : ""}`}
            data-stream={slots.streams[slot] ?? undefined}
            muted
            playsInline
            autoPlay
            onLoadedMetadata={onSize(slot)}
            onResize={onSize(slot)}
          />
        ))}
      </div>
      {streamInfo && live && frontStream && (
        <TileDiagnostics key={`${base}/${frontStream}`} player={players[slots.front].player} video={videos[slots.front]} stream={frontStream} state={frontState} />
      )}
      {fallback && (
        <span className="tile-badge">
          {wanted === "main" ? "Main" : "Sub"} stream can't play · showing {other} stream
        </span>
      )}
      {objects.length > 0 && (
        <ul className="tile-objects" aria-label="Objects in view">
          {objects.map(([object, count]) => (
            <li key={object} className="tile-chip">
              {objectChip(object, count)}
            </li>
          ))}
        </ul>
      )}
      <figcaption className="tile-name">
        {label}
        {alert && <span className="tile-status"> · Alert</span>}
        {status && <span className="tile-status"> · {status}</span>}
      </figcaption>
      {editing && onHide && (
        <button type="button" className="tile-hide" aria-label={`Hide ${label}`} onClick={onHide}>
          Hide
        </button>
      )}
    </figure>
  );
}
