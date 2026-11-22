import { streamSocketUrl } from "../app/frigate";

/**
 * A live player for one go2rtc stream, modelled on go2rtc's MIT-licensed
 * video-rtc.js. It tries WebRTC first for the lowest delay, falls back to
 * MSE (fMP4 over a WebSocket) when WebRTC is missing or fails to connect,
 * and reconnects with a growing delay when the stream drops.
 */

/** What a player is doing, for the tile to show. */
export type PlayerState = "connecting" | "playing" | "retrying";

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
/** MSE keeps this many seconds of video, and skips ahead when it falls further behind. */
export const KEEP_S = 5;
/** MSE playback speeds up or slows down within these rates to stay near the live edge. */
const MIN_RATE = 0.1;
const MAX_RATE = 2;

/** A stream whose picture has not moved for this long is reconnected. */
export const STALL_MS = 10000;
/** How often the picture is checked for movement. */
export const STALL_CHECK_MS = 2000;

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
  private attempt = 0;
  private stopped = true;
  /** WebRTC failed to connect once, so this player sticks to MSE. */
  private webrtcFailed = false;
  /** Bumped on every connection, so late events from an old one are ignored. */
  private generation = 0;

  constructor(options: PlayerOptions) {
    this.options = options;
  }

  /** Starts playing. Calling it while playing does nothing. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
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
      this.playing();
    };
    this.onPlaying = () => {
      if (!this.current(generation)) return;
      if (typeof video.requestVideoFrameCallback === "function") video.requestVideoFrameCallback(show);
      else if (decoded(video)) show();
    };
    video.addEventListener("playing", this.onPlaying);
    let last = progress(video);
    let lastMoved = Date.now();
    this.watchdog = setInterval(() => {
      const now = progress(video);
      if (moved(video, last, now)) {
        lastMoved = Date.now();
        // A frame can decode after the element's `playing` event.
        if (!video.paused && decoded(video)) show();
      } else if (Date.now() - lastMoved >= STALL_MS) {
        // WebRTC that connects but never shows a frame gives way to MSE.
        if (mode === "webrtc" && !shown) this.fallBack(generation);
        else this.retry(generation);
      }
      last = now;
    }, STALL_CHECK_MS);
  }

  private webrtcAvailable(): boolean {
    return !this.webrtcFailed && typeof RTCPeerConnection !== "undefined";
  }

  private current(generation: number): boolean {
    return !this.stopped && generation === this.generation;
  }

  private setState(state: PlayerState): void {
    this.options.onState?.(state);
  }

  private playing(): void {
    this.attempt = 0;
    this.setState("playing");
  }

  /** The connection dropped: try again after the backoff delay. */
  private retry(generation: number): void {
    if (!this.current(generation)) return;
    this.teardown();
    this.setState("retrying");
    const delay = retryDelay(this.attempt++);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped) this.connect();
    }, delay);
  }

  /** WebRTC did not connect: use MSE from now on, straight away. */
  private fallBack(generation: number): void {
    if (!this.current(generation)) return;
    this.webrtcFailed = true;
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
        if (connected) this.retry(generation);
        else this.fallBack(generation);
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
    let started = false;
    const queue: ArrayBuffer[] = [];
    const flush = () => {
      if (!buffer || buffer.updating || queue.length === 0) return;
      try {
        buffer.appendBuffer(queue.shift() as ArrayBuffer);
      } catch {
        this.retry(generation);
      }
    };
    // As go2rtc's video-rtc.js does: keep only the last few seconds, jump
    // ahead when playback falls behind them, and otherwise speed up or slow
    // down a little to stay near the live edge. Seeking on every small lag
    // restarts decoding from the next keyframe, which on a 5 fps camera
    // left tiles without new frames long enough to trip the watchdog.
    const keepUp = () => {
      if (!buffer || buffer.updating || !video.buffered || video.buffered.length === 0) return;
      const end = video.buffered.end(video.buffered.length - 1);
      const keepFrom = end - KEEP_S;
      const first = video.buffered.start(0);
      if (keepFrom > first) {
        try {
          buffer.remove(first, keepFrom);
        } catch {
          // Trimming is housekeeping; the next update tries again.
        }
      }
      if (video.currentTime < keepFrom) video.currentTime = keepFrom;
      video.playbackRate = Math.max(MIN_RATE, Math.min(end - video.currentTime, MAX_RATE));
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
            try {
              buffer = source.addSourceBuffer(message.value);
              buffer.mode = "segments";
              buffer.addEventListener("updateend", () => {
                keepUp();
                flush();
              });
              flush();
            } catch {
              this.retry(generation);
            }
          };
          if (source.readyState === "open") create();
          else source.addEventListener("sourceopen", create, { once: true });
        } else if (message?.type === "error") {
          this.retry(generation);
        }
        return;
      }
      queue.push(event.data as ArrayBuffer);
      if (!started) {
        // The first video data. The tile shows as playing once it decodes.
        started = true;
        play(video);
      }
      flush();
    };
    socket.onclose = () => this.retry(generation);
  }

  private teardown(): void {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    if (this.onPlaying) this.options.video.removeEventListener("playing", this.onPlaying);
    this.onPlaying = null;
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
  return typeof video.getVideoPlaybackQuality === "function"
    ? video.getVideoPlaybackQuality().totalVideoFrames
    : video.currentTime;
}

/** Whether a frame has been decoded. */
function decoded(video: HTMLVideoElement): boolean {
  if (typeof video.getVideoPlaybackQuality === "function") return video.getVideoPlaybackQuality().totalVideoFrames > 0;
  return video.readyState >= HAVE_CURRENT_DATA;
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
