import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetPlayback } from "./playbackLog";
import {
  DECAY_CLEAN_MS,
  DECAY_STEP_S,
  DECODE_FAILURES,
  FAILURE_MEMORY_MS,
  Go2rtcPlayer,
  HITCH_MS,
  HITCH_WINDOW_MS,
  KEEP_S,
  LAG_MEMORY_MS,
  LAG_STEP_S,
  LATE_MARGIN_S,
  LATE_REST_MS,
  LOW_LAG_GRACE_MS,
  MAX_LAG_FRAMES,
  MAX_PENDING_BYTES,
  RETRY_MAX_MS,
  SETTLE_MS,
  SHOWN_CHECK_MS,
  SKIP_REST_MS,
  STALE_MS,
  STALL_CHECK_MS,
  STALL_MS,
  TARGET_LAG_S,
  VIEW_REST_MS,
  WEBRTC_TIMEOUT_MS,
  forgetFailures,
  forgetLags,
  isUndecodable,
  noteViewChange,
  retryDelay,
  supportedMseCodecs,
  type PlayerState,
} from "./player";

class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  binaryType = "blob";
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(data: unknown) {
    this.onmessage?.({ data });
  }
  sentMessages() {
    return this.sent.map((text) => JSON.parse(text) as { type: string; value: string });
  }
}

class FakePeer {
  static all: FakePeer[] = [];
  connectionState = "new";
  /** The stats report's inbound video, when a test gives the peer one. */
  inbound: { framesDecoded: number; framesDropped?: number } | null = null;
  transceivers: string[] = [];
  remote: unknown = null;
  candidates: unknown[] = [];
  closed = false;
  ontrack: ((event: { streams: unknown[]; track: unknown }) => void) | null = null;
  onicecandidate: ((event: { candidate: { candidate: string } | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  constructor() {
    FakePeer.all.push(this);
  }
  addTransceiver(kind: string) {
    this.transceivers.push(kind);
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0 offer" };
  }
  async setLocalDescription() {}
  async setRemoteDescription(description: unknown) {
    this.remote = description;
  }
  async addIceCandidate(candidate: unknown) {
    this.candidates.push(candidate);
  }
  close() {
    this.closed = true;
  }
  state(state: string) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

class FakeBuffer extends EventTarget {
  updating = false;
  mode = "";
  appended: ArrayBuffer[] = [];
  removed: [number, number][] = [];
  appendBuffer(data: ArrayBuffer) {
    this.appended.push(data);
  }
  remove(start: number, end: number) {
    this.removed.push([start, end]);
  }
}

/** A FakePeer with `getStats`, which WebKit's WebRTC relies on for frame counts. */
class StatsPeer extends FakePeer {
  async getStats() {
    const report = new Map<string, unknown>([["audio", { type: "inbound-rtp", kind: "audio", framesDecoded: 0 }]]);
    if (this.inbound) report.set("video", { type: "inbound-rtp", kind: "video", ...this.inbound });
    return report;
  }
}

class FakeMediaSource extends EventTarget {
  static supported = (type: string) => type.includes("avc1");
  static isTypeSupported(type: string) {
    return FakeMediaSource.supported(type);
  }
  static last: FakeMediaSource | null = null;
  readyState = "closed";
  duration = NaN;
  buffers: { type: string; buffer: FakeBuffer }[] = [];
  constructor() {
    super();
    FakeMediaSource.last = this;
  }
  addSourceBuffer(type: string) {
    const buffer = new FakeBuffer();
    this.buffers.push({ type, buffer });
    return buffer;
  }
  open() {
    this.readyState = "open";
    this.dispatchEvent(new Event("sourceopen"));
  }
}

/** A video element whose picture state a test sets: jsdom never decodes. */
type TestVideo = HTMLVideoElement & { ready: number; paused: boolean };

function video(): TestVideo {
  const element = document.createElement("video") as TestVideo;
  element.play = vi.fn().mockResolvedValue(undefined);
  element.pause = vi.fn();
  element.ready = 4;
  Object.defineProperty(element, "readyState", { get: () => element.ready });
  Object.defineProperty(element, "paused", { configurable: true, writable: true, value: false });
  return element;
}

/** Makes the element report `frames()` decoded frames, as WebKit and Chromium do. */
function countFrames(element: HTMLVideoElement, frames: () => number) {
  element.getVideoPlaybackQuality = () => ({ totalVideoFrames: frames(), droppedVideoFrames: 0 }) as VideoPlaybackQuality;
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("retryDelay", () => {
  it("doubles from one second up to the maximum", () => {
    expect([0, 1, 2, 3].map(retryDelay)).toEqual([1000, 2000, 4000, 8000]);
    expect(retryDelay(20)).toBe(RETRY_MAX_MS);
  });
});

describe("supportedMseCodecs", () => {
  it("lists only the codecs the webview can play", () => {
    expect(supportedMseCodecs((type) => type.includes("avc1"))).toBe("avc1.640029,avc1.64002A,avc1.640033");
    expect(supportedMseCodecs(() => false)).toBe("");
  });
});

describe("Go2rtcPlayer", () => {
  let states: PlayerState[];
  const players: Go2rtcPlayer[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.all = [];
    FakePeer.all = [];
    FakeMediaSource.last = null;
    forgetFailures();
    forgetLags();
    states = [];
    vi.stubGlobal("WebSocket", FakeSocket);
    // Tests drive the shared animation tracker explicitly when they need a hitch.
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "MediaStream",
      class {
        tracks: unknown[] = [];
        addTrack(track: unknown) {
          this.tracks.push(track);
        }
      },
    );
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:source", revokeObjectURL: vi.fn() }));
  });

  afterEach(() => {
    for (const player of players.splice(0)) player.stop();
    forgetPlayback();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const make = (element = video()) => {
    const player = new Go2rtcPlayer({ base: "https://frigate.test", stream: "garage_sub", video: element, onState: (s) => states.push(s) });
    players.push(player);
    return player;
  };

  it("negotiates WebRTC over go2rtc's WebSocket and plays the track", async () => {
    vi.stubGlobal("RTCPeerConnection", FakePeer);
    const element = video();
    const player = make(element);
    player.start();
    player.start();
    expect(FakeSocket.all).toHaveLength(1);
    const socket = FakeSocket.all[0];
    expect(socket.url).toBe("wss://frigate.test/live/webrtc/api/ws?src=garage_sub");
    const peer = FakePeer.all[0];
    // Video only: tiles are muted.
    expect(peer.transceivers).toEqual(["video"]);

    socket.open();
    await flush();
    expect(socket.sentMessages()).toEqual([{ type: "webrtc/offer", value: "v=0 offer" }]);

    socket.message(JSON.stringify({ type: "webrtc/answer", value: "v=0 answer" }));
    socket.message(JSON.stringify({ type: "webrtc/candidate", value: "candidate:1" }));
    socket.message(JSON.stringify({ type: "webrtc/candidate", value: "" }));
    socket.message("not json");
    socket.message(new ArrayBuffer(1));
    await flush();
    expect(peer.remote).toEqual({ type: "answer", sdp: "v=0 answer" });
    expect(peer.candidates).toEqual([{ candidate: "candidate:1", sdpMid: "0" }]);

    peer.onicecandidate?.({ candidate: { candidate: "candidate:2" } });
    peer.onicecandidate?.({ candidate: null });
    expect(socket.sentMessages().slice(1)).toEqual([
      { type: "webrtc/candidate", value: "candidate:2" },
      { type: "webrtc/candidate", value: "" },
    ]);

    const videoTrack = { kind: "video" };
    const audioTrack = { kind: "audio" };
    peer.ontrack?.({ streams: [], track: videoTrack });
    const media = element.srcObject as unknown as { tracks: unknown[] };
    peer.ontrack?.({ streams: [], track: audioTrack });
    // The audio track joins the video's stream instead of replacing it.
    expect(element.srcObject).toBe(media);
    expect(media.tracks).toEqual([videoTrack, audioTrack]);
    peer.state("connected");
    // Connected is not playing until the first frame plays.
    expect(states).toEqual(["connecting"]);
    element.dispatchEvent(new Event("playing"));
    expect(states).toEqual(["connecting", "playing"]);

    // Connected WebRTC with a moving picture outlives the timeout, the
    // stall watchdog and the signalling socket.
    for (let i = 1; i <= 10; i++) {
      element.currentTime = i;
      vi.advanceTimersByTime(STALL_CHECK_MS);
    }
    socket.onclose?.();
    expect(FakeSocket.all).toHaveLength(1);

    player.stop();
    expect(socket.closed).toBe(true);
    expect(peer.closed).toBe(true);
    expect(element.srcObject).toBeNull();
  });

  it("reconnects with backoff after a connected WebRTC stream drops", () => {
    vi.stubGlobal("RTCPeerConnection", FakePeer);
    const player = make();
    player.start();
    FakePeer.all[0].state("connected");
    FakePeer.all[0].state("failed");
    expect(states[states.length - 1]).toBe("retrying");
    vi.advanceTimersByTime(999);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);
    expect(FakeSocket.all[1].url).toContain("/live/webrtc/");
    player.stop();
  });

  it("falls back to MSE when WebRTC does not connect in time", () => {
    vi.stubGlobal("RTCPeerConnection", FakePeer);
    vi.stubGlobal("MediaSource", FakeMediaSource);
    const player = make();
    player.start();
    vi.advanceTimersByTime(WEBRTC_TIMEOUT_MS);
    expect(FakePeer.all[0].closed).toBe(true);
    expect(FakeSocket.all[1].url).toBe("wss://frigate.test/live/mse/api/ws?src=garage_sub");
    // Later attempts skip WebRTC.
    FakeSocket.all[1].onclose?.();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.all[2].url).toContain("/live/mse/");
    expect(FakePeer.all).toHaveLength(1);
    player.stop();
  });

  it("falls back to MSE when go2rtc reports an error or closes before connecting", () => {
    vi.stubGlobal("RTCPeerConnection", FakePeer);
    vi.stubGlobal("MediaSource", FakeMediaSource);
    const first = make();
    first.start();
    FakeSocket.all[0].message(JSON.stringify({ type: "error", value: "no stream" }));
    expect(FakeSocket.all[1].url).toContain("/live/mse/");
    first.stop();

    // go2rtc refusing one stream says nothing about the server's WebRTC.
    const second = make();
    second.start();
    expect(FakeSocket.all[2].url).toContain("/live/webrtc/");
    FakeSocket.all[2].onclose?.();
    expect(FakeSocket.all[3].url).toContain("/live/mse/");
    second.stop();

    forgetFailures();
    const third = make();
    third.start();
    FakePeer.all[2].state("failed");
    expect(FakeSocket.all[5].url).toContain("/live/mse/");
    third.stop();
  });

  it("remembers a server whose WebRTC did not connect, for a while", () => {
    vi.stubGlobal("RTCPeerConnection", FakePeer);
    vi.stubGlobal("MediaSource", FakeMediaSource);
    const first = make();
    first.start();
    vi.advanceTimersByTime(WEBRTC_TIMEOUT_MS);
    first.stop();

    // A new player for the same server goes straight to MSE...
    const second = make();
    second.start();
    expect(FakeSocket.all[FakeSocket.all.length - 1]?.url).toContain("/live/mse/");
    expect(second.connection().fallback).toBe(true);
    second.stop();
    // ...but another server still tries WebRTC.
    const other = new Go2rtcPlayer({ base: "https://other.test", stream: "garage_sub", video: video() });
    other.start();
    expect(FakeSocket.all[FakeSocket.all.length - 1]?.url).toContain("/live/webrtc/");
    other.stop();

    // Once the memory expires, WebRTC is tried again.
    vi.advanceTimersByTime(FAILURE_MEMORY_MS);
    const third = make();
    third.start();
    expect(FakeSocket.all[FakeSocket.all.length - 1]?.url).toBe("wss://frigate.test/live/webrtc/api/ws?src=garage_sub");
    expect(third.connection().fallback).toBe(false);
    third.stop();
  });

  it("keeps a WebRTC tile whose connection decodes frames, though the element counts none", async () => {
    vi.stubGlobal("RTCPeerConnection", StatsPeer);
    const element = video();
    // WebKit's counters stay at zero for a MediaStream.
    countFrames(element, () => 0);
    const player = make(element);
    player.start();
    const peer = FakePeer.all[0];
    peer.state("connected");
    element.dispatchEvent(new Event("playing"));
    expect(states).toEqual(["connecting", "playing"]);
    for (let i = 1; i <= 20; i++) {
      peer.inbound = { framesDecoded: i * 12, framesDropped: 1 };
      await vi.advanceTimersByTimeAsync(STALL_CHECK_MS);
    }
    expect(FakeSocket.all).toHaveLength(1);
    expect(states).toEqual(["connecting", "playing"]);
    expect(await player.frames()).toEqual({ shown: 240, dropped: 1 });

    // Frozen: stalled first, then reconnected.
    await vi.advanceTimersByTimeAsync(STALE_MS);
    expect(states[states.length - 1]).toBe("stalled");
    peer.inbound = { framesDecoded: 250 };
    await vi.advanceTimersByTimeAsync(STALL_CHECK_MS);
    expect(states[states.length - 1]).toBe("playing");
    await vi.advanceTimersByTimeAsync(STALL_MS);
    expect(states[states.length - 1]).toBe("retrying");
    player.stop();
  });

  it("counts the play position for WebRTC when the connection has no video stats", async () => {
    vi.stubGlobal("RTCPeerConnection", StatsPeer);
    const element = video();
    const player = make(element);
    player.start();
    FakePeer.all[0].state("connected");
    for (let i = 1; i <= 8; i++) {
      element.currentTime = i;
      await vi.advanceTimersByTimeAsync(STALL_CHECK_MS);
    }
    expect(states).toEqual(["connecting", "playing"]);
    expect(FakeSocket.all).toHaveLength(1);
    player.stop();
  });

  it("gives up on a stream the webview keeps failing to decode", () => {
    vi.stubGlobal("MediaSource", FakeMediaSource);
    const element = video();
    const player = make(element);
    player.start();
    let error: { code: number } | null = { code: 3 };
    Object.defineProperty(element, "error", { get: () => error });
    for (let i = 1; i < DECODE_FAILURES; i++) {
      element.dispatchEvent(new Event("error"));
      expect(states[states.length - 1]).toBe("retrying");
      vi.advanceTimersByTime(retryDelay(i - 1));
    }
    expect(isUndecodable("https://frigate.test", "garage_sub")).toBe(false);
    element.dispatchEvent(new Event("error"));
    expect(states[states.length - 1]).toBe("failed");
    expect(isUndecodable("https://frigate.test", "garage_sub")).toBe(true);
    expect(isUndecodable("https://frigate.test", "garage")).toBe(false);
    const sockets = FakeSocket.all.length;
    vi.advanceTimersByTime(RETRY_MAX_MS * 2);
    expect(FakeSocket.all).toHaveLength(sockets);

    // Any other error is reconnected as before, and the memory expires.
    error = { code: 2 };
    states = [];
    player.start();
    for (let i = 0; i <= DECODE_FAILURES; i++) {
      element.dispatchEvent(new Event("error"));
      vi.advanceTimersByTime(RETRY_MAX_MS);
    }
    expect(states).not.toContain("failed");
    vi.advanceTimersByTime(FAILURE_MEMORY_MS);
    expect(isUndecodable("https://frigate.test", "garage_sub")).toBe(false);
    player.stop();
  });

  it("starts counting decode errors again after a frame shows", () => {
    vi.stubGlobal("MediaSource", FakeMediaSource);
    const element = video();
    const player = make(element);
    player.start();
    Object.defineProperty(element, "error", { get: () => ({ code: 3 }) });
    for (let i = 0; i < DECODE_FAILURES * 2; i++) {
      element.dispatchEvent(new Event("playing"));
      element.dispatchEvent(new Event("error"));
      vi.advanceTimersByTime(retryDelay(0));
    }
    expect(states).not.toContain("failed");
    player.stop();
  });

  it("plays fMP4 over MSE, appending data in order", () => {
    vi.stubGlobal("MediaSource", FakeMediaSource);
    const element = video();
    const player = make(element);
    player.start();
    const socket = FakeSocket.all[0];
    expect(socket.binaryType).toBe("arraybuffer");
    expect(element.getAttribute("src")).toBe("blob:source");
    socket.open();
    expect(socket.sentMessages()).toEqual([{ type: "mse", value: "avc1.640029,avc1.64002A,avc1.640033" }]);

    const source = FakeMediaSource.last as FakeMediaSource;
    socket.message(JSON.stringify({ type: "mse", value: 'video/mp4; codecs="avc1.640029"' }));
    // A live stream has no end, so catching up never ends playback.
    expect(source.duration).toBe(NaN);
    const chunk = new ArrayBuffer(4);
    socket.message(chunk);
    // Bytes are not a picture: the tile plays once the video does.
    expect(states).toEqual(["connecting"]);
    element.dispatchEvent(new Event("playing"));
    expect(states).toEqual(["connecting", "playing"]);
    source.open();
    const { type, buffer } = source.buffers[0];
    expect(type).toBe('video/mp4; codecs="avc1.640029"');
    expect(source.duration).toBe(Infinity);
    expect(buffer.appended).toEqual([chunk]);

    buffer.updating = true;
    const later = new ArrayBuffer(2);
    socket.message(later);
    expect(buffer.appended).toHaveLength(1);
    buffer.updating = false;
    buffer.dispatchEvent(new Event("updateend"));
    expect(buffer.appended).toEqual([chunk, later]);

    socket.message(JSON.stringify({ type: "error", value: "gone" }));
    expect(states[states.length - 1]).toBe("retrying");
    player.stop();
    vi.advanceTimersByTime(RETRY_MAX_MS);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("shows an MSE stream whose picture stops moving as stalled, then reconnects it", () => {
    vi.stubGlobal("MediaSource", FakeMediaSource);
    const element = video();
    const player = make(element);
    player.start();
    expect(player.lastFrameAt()).toBeUndefined();
    element.dispatchEvent(new Event("playing"));
    element.currentTime = 1;
    vi.advanceTimersByTime(STALL_CHECK_MS);
    const movedAt = player.lastFrameAt();
    expect(movedAt).toBe(Date.now());
    // Frozen from here on.
    vi.advanceTimersByTime(STALE_MS);
    expect(states[states.length - 1]).toBe("stalled");
    vi.advanceTimersByTime(STALL_MS - STALL_CHECK_MS - STALE_MS);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(STALL_CHECK_MS);
    expect(states[states.length - 1]).toBe("retrying");
    expect(player.lastFrameAt()).toBe(movedAt);
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.all).toHaveLength(2);
    player.stop();
  });

  it("reconnects an MSE stream that sends bytes but never plays", () => {
    vi.stubGlobal("MediaSource", FakeMediaSource);
    const player = make();
    player.start();
    FakeSocket.all[0].open();
    FakeSocket.all[0].message(new ArrayBuffer(4));
    vi.advanceTimersByTime(STALL_MS);
    expect(states).toEqual(["connecting", "retrying"]);
    player.stop();
  });

  it("counts decoded frames when the webview reports them, through counter resets", () => {
    vi.stubGlobal("MediaSource", FakeMediaSource);
    const element = video();
    let frames = 0;
    countFrames(element, () => frames);
    const player = make(element);
    player.start();
    for (let i = 0; i < 20; i++) {
      // A 5 fps camera whose counter WebKit resets now and then.
      frames = i % 4 === 3 ? 2 : frames + 10;
      vi.advanceTimersByTime(STALL_CHECK_MS);
    }
    expect(FakeSocket.all).toHaveLength(1);
    expect(states).toEqual(["connecting", "playing"]);
    player.stop();
  });

  it("reconnects a stream that buffers and moves on without decoding a frame", () => {
    vi.stubGlobal("MediaSource", FakeMediaSource);
    const element = video();
    element.getVideoPlaybackQuality = () => ({ totalVideoFrames: element.currentTime * 25, droppedVideoFrames: element.currentTime * 25 }) as VideoPlaybackQuality;
    const player = make(element);
    player.start();
    // WebKit says playing and the clock moves, but nothing is decoded.
    element.dispatchEvent(new Event("playing"));
    for (let i = 1; i <= STALL_MS / STALL_CHECK_MS; i++) {
      element.currentTime = i;
      vi.advanceTimersByTime(STALL_CHECK_MS);
    }
    expect(states).toEqual(["connecting", "retrying"]);
    player.stop();
  });

  it("reconnects when the element has no current picture for the stall window", () => {
    vi.stubGlobal("MediaSource", FakeMediaSource);
    const element = video();
    element.ready = 1;
    const player = make(element);
    player.start();
    for (let i = 1; i <= STALL_MS / STALL_CHECK_MS; i++) {
      element.currentTime = i;
      vi.advanceTimersByTime(STALL_CHECK_MS);
    }
    expect(states).toEqual(["connecting", "retrying"]);
    player.stop();
  });

  it("shows playing only once a frame is decoded", () => {
    vi.stubGlobal("MediaSource", FakeMediaSource);
    const element = video();
    let frames = 0;
    countFrames(element, () => frames);
    const player = make(element);
    player.start();
    element.dispatchEvent(new Event("playing"));
    expect(states).toEqual(["connecting"]);
    frames = 3;
    vi.advanceTimersByTime(STALL_CHECK_MS);
    expect(states).toEqual(["connecting", "playing"]);
    player.stop();
  });

  it("waits for requestVideoFrameCallback where the webview has it", () => {
    vi.stubGlobal("MediaSource", FakeMediaSource);
    const element = video();
    element.cancelVideoFrameCallback = vi.fn();
    let frame: (() => void) | null = null;
    element.requestVideoFrameCallback = (callback) => {
      frame = callback as unknown as () => void;
      return 1;
    };
    const player = make(element);
    player.start();
    element.dispatchEvent(new Event("playing"));
    expect(states).toEqual(["connecting"]);
    (frame as unknown as () => void)();
    expect(states).toEqual(["connecting", "playing"]);
    player.stop();
  });

  /** An MSE player on `element`, whose buffered range is whatever `range` returns. */
  function mse(element: TestVideo, range: () => { start: number; end: number }) {
    vi.stubGlobal("MediaSource", FakeMediaSource);
    Object.defineProperty(element, "buffered", {
      get: () => ({ length: 1, start: () => range().start, end: () => range().end }),
    });
    const player = make(element);
    player.start();
    const socket = FakeSocket.all[0];
    const source = FakeMediaSource.last as FakeMediaSource;
    source.open();
    socket.message(JSON.stringify({ type: "mse", value: 'video/mp4; codecs="avc1.640029"' }));
    const { buffer } = source.buffers[0];
    return { player, socket, update: () => buffer.dispatchEvent(new Event("updateend")), buffer };
  }

  it("reconnects at the live edge when a stalled MSE buffer exceeds its pending byte budget", () => {
    const element = video();
    const { player, socket, buffer, update } = mse(element, () => ({ start: 0, end: 0 }));
    const chunk = new ArrayBuffer(MAX_PENDING_BYTES);
    socket.message(chunk);
    buffer.updating = true;
    socket.message(chunk);
    expect(socket.closed).toBe(false);
    socket.message(new ArrayBuffer(1));
    expect(socket.closed).toBe(true);
    expect(states[states.length - 1]).toBe("retrying");
    buffer.updating = false;
    update();
    expect(buffer.appended).toHaveLength(1);
    vi.advanceTimersByTime(retryDelay(0));
    const nextSource = FakeMediaSource.last!;
    nextSource.open();
    const next = FakeSocket.all[1];
    next.message(JSON.stringify({ type: "mse", value: "video/mp4" }));
    const fresh = new ArrayBuffer(4);
    next.message(fresh);
    expect(nextSource.buffers[0].buffer.appended).toEqual([fresh]);
    player.stop();
  });

  it("cancels both pending frame callbacks when a player stops", () => {
    const element = video();
    let id = 0;
    element.requestVideoFrameCallback = vi.fn(() => ++id);
    element.cancelVideoFrameCallback = vi.fn();
    const { player } = mse(element, () => ({ start: 0, end: 0 }));
    element.dispatchEvent(new Event("playing"));
    element.dispatchEvent(new Event("playing"));
    player.stop();
    expect(id).toBe(2);
    expect(element.cancelVideoFrameCallback).toHaveBeenCalledWith(1);
    expect(element.cancelVideoFrameCallback).toHaveBeenCalledWith(2);
  });

  it("keeps MSE near the live edge at normal speed and trims the old buffer", () => {
    const element = video();
    let range = { start: 0, end: 0.2 };
    const { player, update, buffer } = mse(element, () => range);
    element.paused = true;

    // Playback starts once enough video has arrived to ride out late frames.
    update();
    expect(element.play).not.toHaveBeenCalled();
    range = { start: 0, end: 30 };
    element.currentTime = 2;
    update();
    expect(element.play).toHaveBeenCalledTimes(1);
    element.paused = false;
    // Far behind: it trims to the last few seconds and skips ahead once.
    expect(buffer.removed).toEqual([[0, 30 - KEEP_S]]);
    expect(element.currentTime).toBe(30 - TARGET_LAG_S);

    // Behind again straight after a skip: left alone until the rest is over.
    range = { start: 27, end: 32 };
    element.currentTime = 30;
    update();
    expect(element.currentTime).toBe(30);
    vi.advanceTimersByTime(SKIP_REST_MS);
    update();
    expect(element.currentTime).toBe(32 - TARGET_LAG_S);

    // Normal headroom: no skip, wait, trim or change in speed.
    element.currentTime = 31.2;
    update();
    expect(buffer.removed).toHaveLength(1);
    expect(element.currentTime).toBe(31.2);
    expect(element.pause).not.toHaveBeenCalled();
    expect(element.playbackRate).toBe(1);

    // Too close to the newest frame: a brief dip rides out the grace, then it waits for the stream to get ahead.
    element.currentTime = 31.9;
    update();
    expect(element.pause).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LOW_LAG_GRACE_MS);
    update();
    expect(element.pause).toHaveBeenCalledTimes(1);
    element.paused = true;
    range = { start: 27, end: 32.2 };
    update();
    expect(element.play).toHaveBeenCalledTimes(1);
    range = { start: 27, end: 32.5 };
    update();
    expect(element.play).toHaveBeenCalledTimes(2);
    expect(element.playbackRate).toBe(1);
    player.stop();
  });

  it("plays through recurring short bursts without jumping but catches sustained lag", () => {
    const element = video();
    let decoded = 0;
    countFrames(element, () => ++decoded);
    let end = 1;
    const { player, update } = mse(element, () => ({ start: Math.max(0, end - KEEP_S), end }));
    // Two minutes of 1x playback. Once a minute, frames arrive in a batch.
    for (let tick = 0; tick < 1200; tick++) {
      const position = tick / 10;
      element.currentTime = position;
      const phase = tick % 600;
      if (phase === 300) end = position + 1.8;
      end = Math.max(end, position + 0.8);
      update();
      expect(element.currentTime).toBe(position);
      vi.advanceTimersByTime(100);
    }
    end = 122;
    element.currentTime = 120;
    update();
    expect(element.currentTime).toBe(120);
    vi.advanceTimersByTime(1000);
    end++;
    element.currentTime++;
    update();
    expect(element.currentTime).toBe(end - TARGET_LAG_S);
    expect(element.pause).not.toHaveBeenCalled();
    expect(element.playbackRate).toBe(1);
    player.stop();
  });

  it("stays further behind the live edge while frames arrive but are not shown", () => {
    const element = video();
    element.cancelVideoFrameCallback = vi.fn();
    let frame: VideoFrameRequestCallback | undefined;
    element.requestVideoFrameCallback = (callback) => {
      frame = callback;
      return 1;
    };
    // The picture keeps moving, so the watchdog leaves the stream alone.
    let decoded = 0;
    countFrames(element, () => ++decoded);
    let range = { start: 5, end: 10 };
    const { player, socket, update } = mse(element, () => range);
    let presentedFrames = 0;
    const play = (arrived: number, shown: number) => {
      for (let i = 0; i < arrived; i++) socket.message(new ArrayBuffer(4));
      if (shown > 0) {
        frame?.(0, { presentedFrames: ++presentedFrames } as VideoFrameCallbackMetadata);
        presentedFrames += shown - 1;
        frame?.(0, { presentedFrames } as VideoFrameCallbackMetadata);
      }
      vi.advanceTimersByTime(SHOWN_CHECK_MS);
      update();
    };
    element.currentTime = 10 - TARGET_LAG_S;
    update();
    vi.advanceTimersByTime(VIEW_REST_MS);

    // Every frame shown, including those between callbacks: playback stays where it is.
    play(20, 20);
    expect(element.pause).not.toHaveBeenCalled();
    // A webview that reports no frames at all says nothing about late ones.
    play(20, 0);
    expect(element.pause).not.toHaveBeenCalled();

    // Half the frames missed their turn: it waits until it is a step further behind.
    play(20, 10);
    expect(element.pause).toHaveBeenCalledTimes(1);
    element.paused = true;
    range = { start: 5, end: 10 + LAG_STEP_S / 2 };
    update();
    expect(element.play).not.toHaveBeenCalled();
    range = { start: 5, end: 10.01 + LAG_STEP_S };
    update();
    expect(element.play).toHaveBeenCalledTimes(1);
    element.paused = false;
    vi.advanceTimersByTime(SETTLE_MS);
    play(20, 10);
    play(20, 10);
    expect(element.pause).toHaveBeenCalledTimes(1);
    player.stop();
  });

  /** An MSE player that reports each frame it shows, `late` seconds after the frame's turn. */
  function lateFrames(range: () => { start: number; end: number }) {
    const element = video();
    element.cancelVideoFrameCallback = vi.fn();
    let frame: VideoFrameRequestCallback | null = null;
    element.requestVideoFrameCallback = (callback) => {
      frame = callback;
      return 1;
    };
    // The picture keeps moving, so the watchdog leaves the stream alone.
    let decoded = 0;
    countFrames(element, () => ++decoded);
    FakeSocket.all = [];
    const { player, socket, update } = mse(element, range);
    /** One check's worth of frames, every one of them shown. */
    const play = (late: number[]) => {
      for (const by of late) {
        socket.message(new ArrayBuffer(4));
        frame?.(0, { mediaTime: element.currentTime - by } as VideoFrameCallbackMetadata);
      }
      vi.advanceTimersByTime(SHOWN_CHECK_MS);
      update();
    };
    const firstFrame = (mediaTime: number) => frame?.(0, { mediaTime } as VideoFrameCallbackMetadata);
    return { element, player, socket, update, play, firstFrame };
  }
  const onTime = (count: number) => Array.from({ length: count }, () => 0.016);

  it("ignores lateness while a view settles", () => {
    const { element, player, update, play } = lateFrames(() => ({ start: 5, end: 10 }));
    element.currentTime = 10 - TARGET_LAG_S;
    update();
    vi.advanceTimersByTime(VIEW_REST_MS);
    noteViewChange();
    const late = [...onTime(17), 0.2, 0.2, 0.2];
    play(late);
    expect(element.pause).not.toHaveBeenCalled();
    play(late);
    expect(element.pause).toHaveBeenCalledTimes(1);
    player.stop();
  });

  it("ignores late samples in the window after an animation hitch", () => {
    let tick: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      tick = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { element, player, update, play } = lateFrames(() => ({ start: 5, end: 10 }));
    element.currentTime = 10 - TARGET_LAG_S;
    update();
    vi.advanceTimersByTime(VIEW_REST_MS);
    tick?.(performance.now());
    vi.advanceTimersByTime(HITCH_MS + 1);
    tick?.(performance.now());
    vi.advanceTimersByTime(HITCH_WINDOW_MS - 1);
    play([...onTime(17), 0.2, 0.2, 0.2]);
    expect(element.pause).not.toHaveBeenCalled();
    player.stop();
  });

  it("caps a first-frame hold-back at twelve measured frame intervals", () => {
    const interval = 0.1;
    const cap = MAX_LAG_FRAMES * interval;
    const range = { start: 0, end: 5 };
    const { element, player, socket, firstFrame, update } = lateFrames(() => range);
    element.currentTime = 5 - TARGET_LAG_S;
    update();

    // The decoder's first frame is more than twelve frames behind.
    for (let n = 0; n < 10; n++) socket.message(new ArrayBuffer(4));
    range.end = 6;
    update();
    element.currentTime = 5;
    firstFrame(4.5);
    expect(element.pause).toHaveBeenCalledTimes(1);
    element.paused = true;
    range.end = 5 + cap - 0.01;
    update();
    expect(element.play).not.toHaveBeenCalled();
    range.end = 5 + cap + 0.01;
    update();
    expect(element.play).toHaveBeenCalledTimes(1);
    expect(element.playbackRate).toBe(1);
    player.stop();
  });

  it("uses incoming media cadence for the cap when playback drops every second frame", () => {
    const range = { start: 0, end: 10 };
    const { element, player, socket, firstFrame, update } = lateFrames(() => range);
    element.currentTime = range.end - TARGET_LAG_S;
    update();
    vi.advanceTimersByTime(VIEW_REST_MS);

    for (let pair = 0; pair < 50; pair++) {
      socket.message(new ArrayBuffer(4));
      socket.message(new ArrayBuffer(4));
      range.end += 0.08;
      element.currentTime = range.end - TARGET_LAG_S;
      firstFrame(element.currentTime - 0.016);
      vi.advanceTimersByTime(80);
      update();
    }

    // The displayed cadence suggests a 0.96 s cap; the source delivers
    // twice as many frames, so even this sustained drop must not raise lag.
    expect(element.pause).not.toHaveBeenCalled();
    expect(element.playbackRate).toBe(1);
    player.stop();
  });

  it("decays extra lag after five minutes of clean frames", () => {
    const lateBy = 0.2;
    const range = { start: 0, end: 10 };
    const { element, player, update, play } = lateFrames(() => range);
    element.currentTime = 10 - TARGET_LAG_S;
    update();
    vi.advanceTimersByTime(VIEW_REST_MS);
    play([...onTime(17), lateBy, lateBy, lateBy]);
    expect(element.pause).toHaveBeenCalledTimes(1);
    const target = TARGET_LAG_S + lateBy + LATE_MARGIN_S;
    range.end = element.currentTime + target + 0.01;
    update();
    vi.advanceTimersByTime(SETTLE_MS);
    for (let time = 0; time <= DECAY_CLEAN_MS; time += SHOWN_CHECK_MS) {
      play(onTime(20));
    }
    player.stop();

    const next = lateFrames(() => ({ start: 0, end: target - DECAY_STEP_S / 2 }));
    next.element.paused = true;
    next.update();
    expect(next.element.play).toHaveBeenCalledTimes(1);
    next.player.stop();
  });

  it("stays behind by as much as frames shown late needed", () => {
    let range = { start: 5, end: 10 };
    const { element, player, update, play } = lateFrames(() => range);
    element.currentTime = 10 - TARGET_LAG_S;
    update();
    // Frames shown while the decoder catches up say nothing.
    play([1, 1, 1, 1]);
    expect(element.pause).not.toHaveBeenCalled();

    // On time, a frame is reported a screen refresh after it is shown.
    play(onTime(20));
    expect(element.pause).not.toHaveBeenCalled();
    // One late frame alone is the page being busy, not the decoder.
    play([...onTime(9), 0.5]);
    expect(element.pause).not.toHaveBeenCalled();

    // Frames keep coming late: it waits until they would have been on time, with room to spare.
    play([...onTime(17), 0.2, 0.15, 0.15]);
    expect(element.pause).toHaveBeenCalledTimes(1);
    element.paused = true;
    range = { start: 5, end: 10 + 0.15 };
    update();
    expect(element.play).not.toHaveBeenCalled();
    range = { start: 5, end: 10.01 + 0.15 + LATE_MARGIN_S };
    update();
    expect(element.play).toHaveBeenCalledTimes(1);
    element.paused = false;

    // From there the same frames are on time, and playback is left alone.
    vi.advanceTimersByTime(SETTLE_MS);
    play(onTime(20));
    play(onTime(20));
    expect(element.pause).toHaveBeenCalledTimes(1);
    expect(element.playbackRate).toBe(1);
    player.stop();
  });

  it("measures the distance behind only once the decoder has caught up", () => {
    let range = { start: 5, end: 10 };
    const { element, player, update, play } = lateFrames(() => range);
    element.currentTime = 10 - TARGET_LAG_S;
    update();
    // The play position stood still while the first frames were decoded: playback is really 1 s behind.
    vi.advanceTimersByTime(VIEW_REST_MS);
    range = { start: 5, end: 10.5 };
    update();
    play([...onTime(17), 0.2, 0.2, 0.2]);
    expect(element.pause).toHaveBeenCalledTimes(1);
    element.paused = true;
    range = { start: 5, end: 10.5 + 0.2 };
    update();
    expect(element.play).not.toHaveBeenCalled();
    range = { start: 5, end: 10.51 + 0.2 + LATE_MARGIN_S };
    update();
    expect(element.play).toHaveBeenCalledTimes(1);
    player.stop();
  });

  it("stops falling back when frames are as late from further behind", () => {
    let range = { start: 5, end: 10 };
    const { element, player, update, play } = lateFrames(() => range);
    element.currentTime = 10 - TARGET_LAG_S;
    update();
    vi.advanceTimersByTime(VIEW_REST_MS);
    const late = [...onTime(17), 0.2, 0.2, 0.2];
    play(late);
    expect(element.pause).toHaveBeenCalledTimes(1);
    element.paused = true;
    range = { start: 5, end: 10.01 + 0.2 + LATE_MARGIN_S };
    update();
    expect(element.play).toHaveBeenCalledTimes(1);
    element.paused = false;

    // Just as late: a busy computer, which more distance does not help.
    vi.advanceTimersByTime(SETTLE_MS);
    play(late);
    play(late);
    expect(element.pause).toHaveBeenCalledTimes(1);
    // The distance that did not help is not kept for the next connection.
    player.stop();
    range = { start: 0, end: TARGET_LAG_S + 0.01 };
    const next = lateFrames(() => range);
    next.element.paused = true;
    next.update();
    expect(next.element.play).toHaveBeenCalledTimes(1);
    next.element.paused = false;

    // A new connection looks at late frames afresh.
    vi.advanceTimersByTime(VIEW_REST_MS);
    next.play(late);
    expect(next.element.pause).toHaveBeenCalledTimes(1);
    next.player.stop();
  });

  it("looks at late frames again after a rest", () => {
    let range = { start: 5, end: 10 };
    const { element, player, update, play } = lateFrames(() => range);
    element.currentTime = 10 - TARGET_LAG_S;
    update();
    vi.advanceTimersByTime(VIEW_REST_MS);
    const late = [...onTime(17), 0.2, 0.2, 0.2];
    play(late);
    element.paused = true;
    range = { start: 5, end: 10.01 + 0.2 + LATE_MARGIN_S };
    update();
    element.paused = false;
    vi.advanceTimersByTime(SETTLE_MS);
    play(late);
    expect(element.pause).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(LATE_REST_MS);
    element.currentTime = range.end - TARGET_LAG_S;
    play(late);
    expect(element.pause).toHaveBeenCalledTimes(2);
    player.stop();
  });

  it("starts a stream's next connection as far behind as its last one needed, for a while", () => {
    let range = { start: 5, end: 10 };
    const first = lateFrames(() => range);
    first.element.currentTime = 10 - TARGET_LAG_S;
    first.update();
    vi.advanceTimersByTime(VIEW_REST_MS);
    first.play([...onTime(17), 0.2, 0.2, 0.2]);
    expect(first.element.pause).toHaveBeenCalledTimes(1);
    first.player.stop();

    // The same stream again: it starts where the late frames were on time.
    range = { start: 0, end: TARGET_LAG_S + 0.2 };
    const second = lateFrames(() => range);
    second.element.paused = true;
    second.update();
    expect(second.element.play).not.toHaveBeenCalled();
    range = { start: 0, end: TARGET_LAG_S + 0.21 + LATE_MARGIN_S };
    second.update();
    expect(second.element.play).toHaveBeenCalledTimes(1);
    second.player.stop();

    // Later it starts at the usual distance and finds out again.
    vi.advanceTimersByTime(LAG_MEMORY_MS);
    range = { start: 0, end: TARGET_LAG_S + 0.01 };
    const third = lateFrames(() => range);
    third.element.paused = true;
    third.update();
    expect(third.element.play).toHaveBeenCalledTimes(1);
    third.player.stop();
  });

  it("gives way to MSE when WebRTC connects but never shows a frame", () => {
    vi.stubGlobal("RTCPeerConnection", FakePeer);
    vi.stubGlobal("MediaSource", FakeMediaSource);
    const player = make();
    player.start();
    FakePeer.all[0].state("connected");
    vi.advanceTimersByTime(STALL_MS);
    expect(FakeSocket.all[1].url).toContain("/live/mse/");
    player.stop();
  });

  it("retries when neither WebRTC nor MSE exists", () => {
    const player = make();
    player.start();
    expect(states).toEqual(["connecting", "retrying"]);
    expect(FakeSocket.all).toHaveLength(0);
    player.stop();
  });
});
