import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Go2rtcPlayer, KEEP_S, RETRY_MAX_MS, STALL_CHECK_MS, STALL_MS, WEBRTC_TIMEOUT_MS, retryDelay, supportedMseCodecs, type PlayerState } from "./player";

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

class FakeMediaSource extends EventTarget {
  static supported = (type: string) => type.includes("avc1");
  static isTypeSupported(type: string) {
    return FakeMediaSource.supported(type);
  }
  static last: FakeMediaSource | null = null;
  readyState = "closed";
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

  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.all = [];
    FakePeer.all = [];
    FakeMediaSource.last = null;
    states = [];
    vi.stubGlobal("WebSocket", FakeSocket);
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const make = (element = video()) =>
    new Go2rtcPlayer({ base: "https://frigate.test", stream: "garage_sub", video: element, onState: (s) => states.push(s) });

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

    const second = make();
    second.start();
    FakeSocket.all[2].onclose?.();
    expect(FakeSocket.all[3].url).toContain("/live/mse/");
    second.stop();

    const third = make();
    third.start();
    FakePeer.all[2].state("failed");
    expect(FakeSocket.all[5].url).toContain("/live/mse/");
    third.stop();
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
    const chunk = new ArrayBuffer(4);
    socket.message(chunk);
    // Bytes are not a picture: the tile plays once the video does.
    expect(states).toEqual(["connecting"]);
    expect(element.play).toHaveBeenCalled();
    element.dispatchEvent(new Event("playing"));
    expect(states).toEqual(["connecting", "playing"]);
    source.open();
    const { type, buffer } = source.buffers[0];
    expect(type).toBe('video/mp4; codecs="avc1.640029"');
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

  it("reconnects an MSE stream whose picture stops moving", () => {
    vi.stubGlobal("MediaSource", FakeMediaSource);
    const element = video();
    const player = make(element);
    player.start();
    element.dispatchEvent(new Event("playing"));
    element.currentTime = 1;
    vi.advanceTimersByTime(STALL_CHECK_MS);
    // Frozen from here on.
    vi.advanceTimersByTime(STALL_MS - STALL_CHECK_MS);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(STALL_CHECK_MS);
    expect(states[states.length - 1]).toBe("retrying");
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

  it("keeps MSE near the live edge and trims the old buffer", () => {
    vi.stubGlobal("MediaSource", FakeMediaSource);
    const element = video();
    let range = { start: 0, end: 30 };
    Object.defineProperty(element, "buffered", {
      get: () => ({ length: 1, start: () => range.start, end: () => range.end }),
    });
    const player = make(element);
    player.start();
    const socket = FakeSocket.all[0];
    const source = FakeMediaSource.last as FakeMediaSource;
    source.open();
    socket.message(JSON.stringify({ type: "mse", value: 'video/mp4; codecs="avc1.640029"' }));
    const { buffer } = source.buffers[0];

    element.currentTime = 2;
    buffer.dispatchEvent(new Event("updateend"));
    // Far behind: it trims to the last few seconds and jumps to their start.
    expect(buffer.removed).toEqual([[0, 30 - KEEP_S]]);
    expect(element.currentTime).toBe(30 - KEEP_S);
    expect(element.playbackRate).toBeCloseTo(1.08);

    range = { start: 25, end: 30 };
    element.currentTime = 29.5;
    buffer.dispatchEvent(new Event("updateend"));
    // Normal headroom: no seek, trim or change in speed.
    expect(buffer.removed).toHaveLength(1);
    expect(element.currentTime).toBe(29.5);
    expect(element.playbackRate).toBe(1);
    element.currentTime = 29.8;
    buffer.dispatchEvent(new Event("updateend"));
    expect(element.playbackRate).toBeCloseTo(0.95);
    player.stop();
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
