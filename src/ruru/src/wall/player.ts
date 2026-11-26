import { streamSocketUrl } from "../app/frigate";
import { inboundVideoFrames, videoFrames, type FrameCounts } from "./diagnostics";
import { ExpiringMap, ExpiringSet } from "./memory";

/**
 * A live player for one go2rtc stream, modelled on go2rtc's MIT-licensed
 * video-rtc.js. It tries WebRTC first for the lowest delay, falls back to
 * MSE (fMP4 over a WebSocket) when WebRTC is missing or fails to connect,
 * and reconnects with a growing delay when the stream drops.
 */

/**
 * What a player is doing, for the tile to show. `stalled` means the picture
 * stopped moving but the connection is still up; `failed` means the webview
 * cannot decode the stream, so the player gave up on it.
 */
export type PlayerState = "connecting" | "playing" | "stalled" | "retrying" | "failed";

export interface PlayerOptions {
  /** The Frigate URL, such as `http://frigate.local:5000`. */
  base: string;
  /** The go2rtc stream name. */
  stream: string;
  video: HTMLVideoElement;
  onState?: (state: PlayerState) => void;
}

/** How long WebRTC may take to connect before MSE is tried instead. */
export const WEBRTC_TIMEOUT_MS = 5000;
/** The first reconnect delay; each failure doubles it up to the maximum. */
export const RETRY_BASE_MS = 1000;
export const RETRY_MAX_MS = 30000;
/** MSE keeps this many seconds of video behind the newest frame. */
export const KEEP_S = 5;
/** Per-player backlog before the SourceBuffer: 8 MiB allows two seconds at 32 Mbit/s. */
export const MAX_PENDING_BYTES = 8 * 1024 * 1024;
/** Bound queue bookkeeping too, even when the server delivers tiny fragments. */
const MAX_PENDING_FRAGMENTS = 512;
/** MSE playback that falls this far behind the newest frame skips ahead. */
export const MAX_LAG_S = 1.5;
/** A brief burst of frames can put the buffered end ahead for a few updates. */
const LAG_GRACE_MS = 1000;
/** MSE playback closer to the newest frame than this waits, because a frame that arrives after its turn is never shown. */
export const MIN_LAG_S = 0.35;
/** A skip or a wait leaves playback this far behind the newest frame, which is room for frames that arrive late. */
export const TARGET_LAG_S = 0.5;
/** After a skip, MSE playback is left alone this long, so a webview that lands short of the target does not skip again and again. */
export const SKIP_REST_MS = 5000;
/** How often MSE playback checks whether frames were shown, and shown on time. */
export const SHOWN_CHECK_MS = 4000;
/** After playback starts, resumes or skips, the decoder gets this long to catch up before frames are checked. */
export const SETTLE_MS = 1000;
/** The comparison needs this many frames to mean anything. */
export const SHOWN_MIN_FRAMES = 8;
/** When fewer than this share of the frames that arrived were shown, playback stays further behind. */
export const SHOWN_RATIO = 0.9;
/** A frame shown this long after its turn was late. A frame on time is reported up to two screen refreshes after it is shown. */
export const LATE_S = 0.04;
/** When more than this share of the frames shown were late, and more than one, playback stays further behind. */
export const LATE_RATIO = 0.05;
/** Room left between a late frame's turn and the newest frame, for frames that arrive unevenly. */
export const LATE_MARGIN_S = 0.1;
/** When frames are as late from further behind, something else holds them up, and lateness is left alone this long. */
export const LATE_REST_MS = 10 * 60 * 1000;
/** How much further behind when frames go missing without saying how late they were, and at most. */
export const LAG_STEP_S = 0.2;
export const MAX_EXTRA_LAG_S = 2;
/** How long a stream's extra distance is remembered, so its next connection starts there instead of finding it again. */
export const LAG_MEMORY_MS = 60 * 60 * 1000;

/** A stream whose picture has not moved for this long is reconnected. */
export const STALL_MS = 10000;
/** A playing stream whose picture has not moved for this long shows as stalled. */
export const STALE_MS = 4000;
/** How often the picture is checked for movement. */
export const STALL_CHECK_MS = 2000;
/** This many decode errors in a row, with no frame shown between them, mean the stream cannot play here. */
export const DECODE_FAILURES = 2;
/**
 * How long a failure is remembered: a server whose WebRTC did not connect
 * goes straight to MSE, and a stream that could not be decoded is skipped.
 * Afterwards both are tried again, in case the server was fixed.
 */
export const FAILURE_MEMORY_MS = 10 * 60 * 1000;

/** MediaError.MEDIA_ERR_DECODE. */
const MEDIA_ERR_DECODE = 3;

/** Frigate servers, by base URL, whose WebRTC recently failed to connect. */
const webrtcFailures = new ExpiringSet(FAILURE_MEMORY_MS);
/** Streams, by base URL and name, the webview recently failed to decode. */
const undecodable = new ExpiringSet(FAILURE_MEMORY_MS);
/** How much further behind the newest frame each stream, by base URL and name, recently had to play. */
const extraLags = new ExpiringMap<number>(LAG_MEMORY_MS);
const streamKey = (base: string, stream: string) => `${base}\n${stream}`;

/** Whether `stream` recently failed to decode here, so a tile should play another one. */
export function isUndecodable(base: string, stream: string): boolean {
  return undecodable.has(streamKey(base, stream));
}

/** Forgets every remembered failure. For tests. */
export function forgetFailures(): void {
  webrtcFailures.clear();
  undecodable.clear();
}

/** Forgets how far behind each stream had to play. For tests. */
export function forgetLags(): void {
  extraLags.clear();
}

/**
 * The video codecs go2rtc can send over MSE, from video-rtc.js. Tiles are
 * muted, so no audio codec is asked for: a stream that declares audio but
 * sends none would otherwise never become playable.
 */
const MSE_CODECS = ["avc1.640029", "avc1.64002A", "avc1.640033", "hvc1.1.6.L153.B0"];

/** The delay before reconnect attempt `attempt` (0 is the first). */
export function retryDelay(attempt: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
}

/** The MSE codecs this webview can play, comma-separated as go2rtc expects. */
export function supportedMseCodecs(isTypeSupported: (type: string) => boolean): string {
  return MSE_CODECS.filter((codec) => isTypeSupported(`video/mp4; codecs="${codec}"`)).join();
}

type Mode = "webrtc" | "mse";

export class Go2rtcPlayer {
  private readonly options: PlayerOptions;
  private socket: WebSocket | null = null;
  private peer: RTCPeerConnection | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private onPlaying: (() => void) | null = null;
  private firstFrame: number | null = null;
  private disposeMse: (() => void) | null = null;
  private onError: (() => void) | null = null;
  private attempt = 0;
  private stopped = true;
  private state: PlayerState | null = null;
  private mode: Mode | null = null;
  /** WebRTC gave this stream no picture, so this player sticks to MSE. */
  private webrtcFailed = false;
  /** Decode errors since a frame was last shown. */
  private decodeErrors = 0;
  /** When the picture last moved, for the tile to say how old a frozen frame is. */
  private movedAt: number | undefined;
  /** Bumped on every connection, so late events from an old one are ignored. */
  private generation = 0;

  constructor(options: PlayerOptions) {
    this.options = options;
  }

  /** Local transport details; no extra connection or network request. */
  connection() {
    return {
      generation: this.generation,
      transport: this.peer ? "WebRTC" : this.socket ? "MSE" : undefined,
      status: this.peer?.connectionState ?? (this.socket ? (this.socket.readyState === WebSocket.OPEN ? "connected" : "connecting") : undefined),
      fallback: this.mode === "mse" && typeof RTCPeerConnection !== "undefined",
    };
  }

  /**
   * The stream's frame counters. WebRTC reads them from the connection's
   * stats, because WebKit counts no frames on a MediaStream video element.
   */
  async frames(): Promise<FrameCounts | undefined> {
    const { peer } = this;
    if (peer && typeof peer.getStats === "function") {
      const counts = await peer.getStats().then(inboundVideoFrames, () => undefined);
      if (counts) return counts;
    }
    return videoFrames(this.options.video);
  }

  /** When the picture last moved (as `Date.now()`), or undefined before the first frame. */
  lastFrameAt(): number | undefined {
    return this.movedAt;
  }

  /** Starts playing. Calling it while playing does nothing. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.decodeErrors = 0;
    this.connect();
  }

  /** Stops playing and closes every connection. */
  stop(): void {
    this.stopped = true;
    this.teardown();
  }

  private connect(): void {
    this.teardown();
    this.setState("connecting");
    const mode: Mode = this.webrtcAvailable() ? "webrtc" : "mse";
    this.mode = mode;
    const generation = ++this.generation;
    this.watch(generation, mode);
    if (mode === "webrtc") this.startWebRtc(generation);
    else this.startMse(generation);
  }

  /**
   * Playing means a frame was decoded, not that bytes arrived or that the
   * element says `playing` (WebKit can say so with nothing decoded). Until
   * then, and whenever no new frame is decoded for STALL_MS, the stream
   * reconnects.
   */
  private watch(generation: number, mode: Mode): void {
    const { video } = this.options;
    let shown = false;
    const show = () => {
      if (shown || !this.current(generation)) return;
      shown = true;
      this.decodeErrors = 0;
      this.movedAt = Date.now();
      this.playing();
    };
    this.onPlaying = () => {
      if (shown || !this.current(generation)) return;
      if (typeof video.requestVideoFrameCallback === "function") {
        if (this.firstFrame === null) this.firstFrame = video.requestVideoFrameCallback(show);
      }
      // WebKit counts no frames on a MediaStream, so WebRTC asks for a picture instead.
      else if (mode === "webrtc" ? video.readyState >= HAVE_CURRENT_DATA : decoded(video)) show();
    };
    video.addEventListener("playing", this.onPlaying);
    this.onError = () => this.retry(generation);
    video.addEventListener("error", this.onError);

    let last = mode === "webrtc" ? video.currentTime : progress(video);
    let lastMoved = Date.now();
    let checking = false;
    const check = (now: number) => {
      if (!this.current(generation)) return;
      if (moved(video, last, now)) {
        lastMoved = Date.now();
        // A frame can decode after the element's `playing` event.
        if (!video.paused && (mode === "webrtc" ? now > 0 : decoded(video))) show();
        if (shown) this.movedAt = lastMoved;
        if (this.state === "stalled") this.setState("playing");
      } else if (Date.now() - lastMoved >= STALL_MS) {
        // WebRTC that connects but never shows a frame gives way to MSE.
        if (mode === "webrtc" && !shown) this.fallBack(generation, false);
        else this.retry(generation);
      } else if (shown && this.state === "playing" && Date.now() - lastMoved >= STALE_MS) {
        this.setState("stalled");
      }
      last = now;
    };
    this.watchdog = setInterval(() => {
      if (checking) return;
      // WebKit counts no frames on a MediaStream, so WebRTC counts the
      // frames its connection decoded, or failing that the play position.
      const peer = mode === "webrtc" ? this.peer : null;
      if (peer && typeof peer.getStats === "function") {
        checking = true;
        void peer
          .getStats()
          .then(inboundVideoFrames, () => undefined)
          .then((counts) => {
            checking = false;
            check(counts ? counts.shown : video.currentTime);
          });
      } else check(mode === "webrtc" ? video.currentTime : progress(video));
    }, STALL_CHECK_MS);
  }

  private webrtcAvailable(): boolean {
    return !this.webrtcFailed && !webrtcFailures.has(this.options.base) && typeof RTCPeerConnection !== "undefined";
  }

  private current(generation: number): boolean {
    return !this.stopped && generation === this.generation;
  }

  private setState(state: PlayerState): void {
    this.state = state;
    this.options.onState?.(state);
  }

  private playing(): void {
    this.attempt = 0;
    this.setState("playing");
  }

  /**
   * The connection dropped: try again after the backoff delay. A stream the
   * webview keeps failing to decode is given up on instead. The state is set
   * before the video is cleared, so the tile can keep its last frame.
   */
  private retry(generation: number): void {
    if (!this.current(generation)) return;
    if (this.options.video.error?.code === MEDIA_ERR_DECODE && ++this.decodeErrors >= DECODE_FAILURES) {
      this.fail();
      return;
    }
    this.setState("retrying");
    this.teardown();
    const delay = retryDelay(this.attempt++);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped) this.connect();
    }, delay);
  }

  /** The webview cannot decode this stream: stop, and remember it so tiles play another. */
  private fail(): void {
    const { base, stream } = this.options;
    undecodable.add(streamKey(base, stream));
    this.stopped = true;
    this.setState("failed");
    this.teardown();
  }

  /**
   * WebRTC did not work: use MSE straight away. When it did not connect at
   * all, every player for this server skips WebRTC for a while; when only
   * this stream failed, only this player does.
   */
  private fallBack(generation: number, serverWide = true): void {
    if (!this.current(generation)) return;
    if (serverWide) webrtcFailures.add(this.options.base);
    else this.webrtcFailed = true;
    this.connect();
  }

  private startWebRtc(generation: number): void {
    const { base, stream, video } = this.options;
    const peer = new RTCPeerConnection({ bundlePolicy: "max-bundle" });
    this.peer = peer;
    // Video only: tiles are muted, and a silent audio track must not hold playback up.
    peer.addTransceiver("video", { direction: "recvonly" });
    let connected = false;

    const socket = new WebSocket(streamSocketUrl(base, "webrtc", stream));
    this.socket = socket;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!connected) this.fallBack(generation);
    }, WEBRTC_TIMEOUT_MS);

    const send = (type: string, value: string) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type, value }));
    };

    // One stream for the connection's video and audio tracks, which arrive
    // in separate track events and may not share a stream of their own.
    const media = new MediaStream();
    peer.ontrack = (event) => {
      if (!this.current(generation)) return;
      media.addTrack(event.track);
      if (video.srcObject !== media) video.srcObject = media;
      play(video);
    };
    peer.onicecandidate = (event) => {
      // An empty candidate tells go2rtc there are no more.
      send("webrtc/candidate", event.candidate ? event.candidate.candidate : "");
    };
    peer.onconnectionstatechange = () => {
      if (!this.current(generation)) return;
      const state = peer.connectionState;
      if (state === "connected") {
        connected = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        // The tile shows as playing once the video's first frame plays.
      } else if (state === "failed" || state === "disconnected" || state === "closed") {
        if (connected) this.retry(generation);
        else this.fallBack(generation);
      }
    };

    socket.onopen = async () => {
      try {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        send("webrtc/offer", offer.sdp ?? "");
      } catch {
        this.fallBack(generation);
      }
    };
    socket.onmessage = (event: MessageEvent) => {
      if (!this.current(generation) || typeof event.data !== "string") return;
      const message = parseMessage(event.data);
      if (!message) return;
      if (message.type === "webrtc/answer") {
        void peer.setRemoteDescription({ type: "answer", sdp: message.value }).catch(() => this.fallBack(generation));
      } else if (message.type === "webrtc/candidate") {
        if (message.value) void peer.addIceCandidate({ candidate: message.value, sdpMid: "0" }).catch(() => {});
      } else if (message.type === "error") {
        // go2rtc refused this stream over WebRTC, such as for its codec.
        if (connected) this.retry(generation);
        else this.fallBack(generation, false);
      }
    };
    socket.onclose = () => {
      // go2rtc may close the signalling socket once WebRTC is up.
      if (!connected) this.fallBack(generation);
    };
  }

  private startMse(generation: number): void {
    const { base, stream, video } = this.options;
    if (typeof MediaSource === "undefined") {
      this.retry(generation);
      return;
    }
    const source = new MediaSource();
    video.srcObject = null;
    video.src = URL.createObjectURL(source);
    const socket = new WebSocket(streamSocketUrl(base, "mse", stream));
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    let buffer: SourceBuffer | null = null;
    const queue: ArrayBuffer[] = [];
    let queuedBytes = 0;
    let countFrame: number | undefined;
    const listeners = new AbortController();
    this.disposeMse = () => {
      listeners.abort();
      queue.length = 0;
      if (countFrame !== undefined) video.cancelVideoFrameCallback(countFrame);
    };
    const flush = () => {
      if (!buffer || buffer.updating || queue.length === 0) return;
      try {
        const chunk = queue.shift()!;
        queuedBytes -= chunk.byteLength;
        buffer.appendBuffer(chunk);
      } catch {
        // The element's error, if any, says whether it was a decode error.
        this.retry(generation);
      }
    };
    // Keep only the last few seconds, and play them at normal speed between
    // MIN_LAG_S and MAX_LAG_S behind the newest frame. Playback that falls
    // further behind, as it does after the network stalls, skips ahead once.
    // Playback that gets too close, where late frames miss their turn, waits
    // for the stream to get ahead again. The speed is never changed instead:
    // WebKitGTK restarts its decoder on every change of playbackRate, which
    // blanks the picture for a frame or two, shows whatever is behind the
    // video, and can show a frame it has already shown.
    let skippedAt = -Infinity;
    let behindSince: number | undefined;
    let waiting = true;
    // A hardware decoder can hold each frame back until several more have
    // arrived, so a frame is ready only after its turn: it is shown late,
    // which makes the picture jerk, or not at all. Each frame shown is
    // checked against the play position, the frames shown are counted
    // against the frames that arrived, and playback stays `extra` seconds
    // further behind, by as much as the late frames needed.
    const key = streamKey(base, stream);
    let extra = extraLags.get(key) ?? 0;
    let arrived = 0;
    let shown = 0;
    let late = 0;
    // The two latest frames. One alone can be the page being busy, not the decoder.
    let latest = 0;
    let nextLatest = 0;
    // The least distance behind the newest frame, which is when frames had the least time.
    let closest = Infinity;
    // What playback last fell back from for late frames, until the next check shows whether that helped.
    let tried: { extra: number; late: number } | undefined;
    let lateRestUntil = 0;
    let countedAt = Date.now();
    const recount = (settle = 0) => {
      arrived = 0;
      shown = 0;
      late = 0;
      latest = 0;
      nextLatest = 0;
      closest = Infinity;
      countedAt = Date.now() + settle;
    };
    const counts = typeof video.requestVideoFrameCallback === "function";
    const count = (_now?: number, frame?: VideoFrameCallbackMetadata) => {
      if (!this.current(generation)) return;
      if (Date.now() >= countedAt) {
        shown++;
        // The play position has already passed a frame that is shown after its turn.
        const by = frame && !video.paused && !video.seeking ? video.currentTime - frame.mediaTime : 0;
        if (by > LATE_S) {
          late++;
          if (by > latest) [latest, nextLatest] = [by, latest];
          else if (by > nextLatest) nextLatest = by;
        }
      }
      countFrame = video.requestVideoFrameCallback(count);
    };
    if (counts) countFrame = video.requestVideoFrameCallback(count);
    const keepUp = () => {
      if (!buffer || buffer.updating || !video.buffered || video.buffered.length === 0) return;
      const end = video.buffered.end(video.buffered.length - 1);
      const keepFrom = end - KEEP_S;
      const first = video.buffered.start(0);
      if (keepFrom - first >= 2) {
        try {
          buffer.remove(first, keepFrom);
        } catch {
          // Trimming is housekeeping; the next update tries again.
        }
      }
      const lag = end - video.currentTime;
      if (waiting) {
        if (lag < TARGET_LAG_S + extra) return;
        waiting = false;
        recount(SETTLE_MS);
      }
      // Playback that waited, or that paused or ended at the live edge, carries on.
      if (video.paused) play(video);
      if (video.seeking) return;
      // While the decoder catches up the play position can stand still, so the distance says nothing yet.
      if (Date.now() >= countedAt) closest = Math.min(closest, lag);
      if (Date.now() - countedAt >= SHOWN_CHECK_MS) {
        // No count at all means the webview is not reporting frames, not that every one was late.
        const missing = shown > 0 && arrived >= SHOWN_MIN_FRAMES && shown < arrived * SHOWN_RATIO;
        let lateFrames = Date.now() >= lateRestUntil && late > 1 && late > shown * LATE_RATIO;
        if (lateFrames && tried && nextLatest > tried.late / 2) {
          // As late from further behind: something else holds the frames up,
          // such as a busy computer, and more distance would not help.
          extra = tried.extra;
          extraLags.set(key, extra);
          lateRestUntil = Date.now() + LATE_REST_MS;
          lateFrames = false;
        }
        tried = undefined;
        if (missing || lateFrames) {
          const before = extra;
          // Far enough behind that the late frames would have been on time.
          const more = Math.max(lateFrames ? nextLatest + LATE_MARGIN_S : 0, missing ? LAG_STEP_S : 0);
          extra = Math.min(Math.max(extra, closest + more - TARGET_LAG_S), MAX_EXTRA_LAG_S);
          extraLags.set(key, extra);
          // Playback that is closer than that waits for the stream to get ahead.
          if (lag < TARGET_LAG_S + extra) {
            if (lateFrames) tried = { extra: before, late: nextLatest };
            waiting = true;
            video.pause();
            return;
          }
        }
        recount();
      }
      const now = performance.now();
      behindSince = lag > MAX_LAG_S + extra ? (behindSince ?? now) : undefined;
      const sustained = behindSince !== undefined && now - behindSince >= LAG_GRACE_MS;
      const rested = now - skippedAt >= SKIP_REST_MS;
      // Video older than KEEP_S is gone, so playback that far back has to move.
      if (lag > KEEP_S || (sustained && rested)) {
        skippedAt = now;
        behindSince = undefined;
        video.currentTime = end - TARGET_LAG_S - extra;
        recount(SETTLE_MS);
      } else if (lag < MIN_LAG_S + extra) {
        waiting = true;
        video.pause();
      }
    };

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "mse", value: supportedMseCodecs((type) => MediaSource.isTypeSupported(type)) }));
    };
    socket.onmessage = (event: MessageEvent) => {
      if (!this.current(generation)) return;
      if (typeof event.data === "string") {
        const message = parseMessage(event.data);
        if (message?.type === "mse" && !buffer) {
          const create = () => {
            if (!this.current(generation)) return;
            try {
              buffer = source.addSourceBuffer(message.value);
              buffer.mode = "segments";
              // A live stream has no end. go2rtc's fMP4 leaves the duration
              // at the buffered end, so WebKit pauses and ends playback
              // each time it catches up with the live edge.
              try {
                source.duration = Infinity;
              } catch {
                // The webview keeps its own duration; keepUp resumes playback.
              }
              buffer.addEventListener("updateend", () => {
                if (!this.current(generation)) return;
                keepUp();
                flush();
              }, { signal: listeners.signal });
              flush();
            } catch {
              this.retry(generation);
            }
          };
          if (source.readyState === "open") create();
          else source.addEventListener("sourceopen", create, { once: true, signal: listeners.signal });
        } else if (message?.type === "error") {
          this.retry(generation);
        }
        return;
      }
      // One frame, after the first message. Playback starts once
      // TARGET_LAG_S of video has arrived; see keepUp.
      const chunk = event.data as ArrayBuffer;
      if (queuedBytes + chunk.byteLength > MAX_PENDING_BYTES || queue.length >= MAX_PENDING_FRAGMENTS) {
        // A fresh connection supplies the headers and keyframe needed to resume.
        this.retry(generation);
        return;
      }
      if (Date.now() >= countedAt) arrived++;
      queuedBytes += chunk.byteLength;
      queue.push(chunk);
      flush();
    };
    socket.onclose = () => this.retry(generation);
  }

  private teardown(): void {
    this.generation++;
    this.disposeMse?.();
    this.disposeMse = null;
    if (this.firstFrame !== null) this.options.video.cancelVideoFrameCallback(this.firstFrame);
    this.firstFrame = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    if (this.onPlaying) this.options.video.removeEventListener("playing", this.onPlaying);
    this.onPlaying = null;
    if (this.onError) this.options.video.removeEventListener("error", this.onError);
    this.onError = null;
    const { socket, peer } = this;
    this.socket = null;
    this.peer = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = null;
      socket.close();
    }
    peer?.close();
    const { video } = this.options;
    if (video.src) {
      URL.revokeObjectURL(video.src);
      video.removeAttribute("src");
    }
    video.srcObject = null;
  }
}

/** The element has a picture: HAVE_CURRENT_DATA or better. */
const HAVE_CURRENT_DATA = 2;

/**
 * How far decoding has got: the decoded-frame count when the webview
 * reports one, since the play position can move with nothing decoded, and
 * the play position only where that API is missing.
 */
function progress(video: HTMLVideoElement): number {
  return videoFrames(video)?.shown ?? video.currentTime;
}

/** Whether a frame has been decoded. */
function decoded(video: HTMLVideoElement): boolean {
  const frames = videoFrames(video);
  return frames ? frames.shown > 0 : video.readyState >= HAVE_CURRENT_DATA;
}

/**
 * Whether the picture moved between two checks. A decoded-frame count that
 * went back to a smaller number was reset by the webview (after a seek), and
 * counts as movement once it is counting again. An element without a
 * current picture never moves.
 */
function moved(video: HTMLVideoElement, last: number, now: number): boolean {
  if (video.readyState < HAVE_CURRENT_DATA) return false;
  return now > last || (now < last && now > 0);
}

/** Starts the video; a refused autoplay leaves the snapshot showing. */
function play(video: HTMLVideoElement): void {
  try {
    void video.play()?.catch(() => {});
  } catch {
    // The webview cannot play here; the next connection tries again.
  }
}

interface Message {
  type: string;
  value: string;
}

function parseMessage(data: string): Message | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (parsed && typeof parsed === "object" && "type" in parsed && typeof parsed.type === "string") {
      const value = "value" in parsed && typeof parsed.value === "string" ? parsed.value : "";
      return { type: parsed.type, value };
    }
  } catch {
    // Not a message go2rtc sends; ignore it.
  }
  return null;
}
