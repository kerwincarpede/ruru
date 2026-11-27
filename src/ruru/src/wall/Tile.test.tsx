import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Camera } from "../app/frigate";
import { forgetFailures, retryDelay, STALE_MS, STALL_CHECK_MS, STALL_MS } from "./player";
import { AUTO_SETTLE_MS, forgetWidths } from "./streams";
import Tile, { HANDOVER_RETIRE_MS, KEEP_FROZEN_MS, PROBLEM_AFTER_MS } from "./Tile";

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  binaryType = "blob";
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send() {}
  close() {
    this.closed = true;
  }
  static open(): string[] {
    return FakeSocket.all.filter((socket) => !socket.closed).map((socket) => new URL(socket.url).searchParams.get("src") ?? "");
  }
}

class FakeMediaSource extends EventTarget {
  static isTypeSupported = () => true;
  readyState = "closed";
}

/** A ResizeObserver whose sizes the test reports. */
class FakeResizeObserver {
  static last: FakeResizeObserver | null = null;
  constructor(public callback: () => void) {
    FakeResizeObserver.last = this;
  }
  observe() {}
  disconnect() {}
}

const camera: Camera = { name: "cam", enabled: true, mainStream: "cam", subStream: "cam_sub" };
const base = "http://frigate";

/** The tile's video playing `stream`, made to report a picture: jsdom never decodes. */
function videoFor(stream: string): HTMLVideoElement {
  const video = document.querySelector<HTMLVideoElement>(`video[data-stream="${stream}"]`);
  if (!video) throw new Error(`No video plays ${stream}`);
  Object.defineProperty(video, "readyState", { configurable: true, value: 4 });
  return video;
}

/** Gives `video` a decoded picture, so the tile can keep its last frame. */
function withPicture(video: HTMLVideoElement) {
  vi.spyOn(video, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 180));
  Object.defineProperty(video, "videoWidth", { configurable: true, value: 640 });
  Object.defineProperty(video, "videoHeight", { configurable: true, value: 360 });
}

const fire = (target: EventTarget, type: string) => act(() => {
  target.dispatchEvent(new Event(type));
});

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  forgetFailures();
  forgetWidths();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("MediaSource", FakeMediaSource);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:source", revokeObjectURL: () => {} }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([128, 128, 128, 255]) })),
  } as unknown as CanvasRenderingContext2D);
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Tile", () => {
  it("falls back to the other stream when the chosen one cannot be decoded", () => {
    render(<Tile base={base} camera={camera} choice="main" live />);
    expect(FakeSocket.open()).toEqual(["cam"]);
    const main = videoFor("cam");
    Object.defineProperty(main, "error", { configurable: true, value: { code: 3 } });
    fire(main, "error");
    expect(screen.getByRole("figure")).toHaveTextContent("Reconnecting…");
    act(() => vi.advanceTimersByTime(retryDelay(0)));
    fire(main, "error");
    expect(FakeSocket.open()).toEqual(["cam_sub"]);
    expect(screen.getByText("Main stream can't play · showing sub stream")).toBeInTheDocument();
  });

  it("says when a camera's only stream cannot be decoded", () => {
    render(<Tile base={base} camera={{ ...camera, subStream: "cam" }} live />);
    const video = videoFor("cam");
    Object.defineProperty(video, "error", { configurable: true, value: { code: 3 } });
    fire(video, "error");
    act(() => vi.advanceTimersByTime(retryDelay(0)));
    fire(video, "error");
    expect(screen.getByRole("figure")).toHaveTextContent("Cam · Can't play this stream");
    expect(FakeSocket.open()).toEqual([]);
  });

  it("keeps showing the current stream until the new one shows a frame, then retires it briefly", () => {
    const { rerender } = render(<Tile base={base} camera={camera} live />);
    fire(videoFor("cam_sub"), "playing");
    expect(screen.getByRole("figure")).toHaveClass("is-playing");

    // Maximised, Automatic wants main: the sub stream plays on meanwhile.
    rerender(<Tile base={base} camera={camera} live maximised />);
    expect(FakeSocket.open()).toEqual(["cam_sub", "cam"]);
    expect(videoFor("cam_sub")).toHaveClass("is-front");
    expect(screen.getByRole("figure")).toHaveClass("is-playing");
    fire(videoFor("cam"), "playing");
    expect(videoFor("cam")).toHaveClass("is-front");
    expect(videoFor("cam_sub")).toHaveClass("is-retiring");
    expect(FakeSocket.open()).toEqual(["cam_sub", "cam"]);
    act(() => vi.advanceTimersByTime(HANDOVER_RETIRE_MS - 1));
    expect(videoFor("cam_sub")).toHaveClass("is-retiring");
    act(() => vi.advanceTimersByTime(1));
    expect(FakeSocket.open()).toEqual(["cam"]);
    expect(document.querySelector("video.is-retiring")).toBeNull();

    // Back on the wall, the main stream plays until the sub stream is back.
    rerender(<Tile base={base} camera={camera} live />);
    expect(FakeSocket.open()).toEqual(["cam", "cam_sub"]);
    fire(videoFor("cam_sub"), "playing");
    expect(videoFor("cam_sub")).toHaveClass("is-front");
    expect(videoFor("cam")).toHaveClass("is-retiring");
    act(() => vi.advanceTimersByTime(HANDOVER_RETIRE_MS));
    expect(FakeSocket.open()).toEqual(["cam_sub"]);
  });

  it("waits for two requestVideoFrameCallback frames before swapping streams and retires the outgoing video", () => {
    const pending = new Map<HTMLVideoElement, Map<number, VideoFrameRequestCallback>>();
    let nextId = 1;
    const cancel = vi.fn(function (this: HTMLVideoElement, id: number) {
      pending.get(this)?.delete(id);
    });
    const originalRequest = HTMLVideoElement.prototype.requestVideoFrameCallback;
    const originalCancel = HTMLVideoElement.prototype.cancelVideoFrameCallback;
    HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback: VideoFrameRequestCallback) {
      const id = nextId++;
      const map = pending.get(this) ?? new Map<number, VideoFrameRequestCallback>();
      map.set(id, callback);
      pending.set(this, map);
      return id;
    };
    HTMLVideoElement.prototype.cancelVideoFrameCallback = cancel;
    const flushFrame = (video: HTMLVideoElement) => {
      const entries = [...(pending.get(video)?.entries() ?? [])];
      pending.get(video)?.clear();
      act(() => {
        for (const [, callback] of entries) callback(0, {} as VideoFrameCallbackMetadata);
      });
    };

    try {
      const { rerender } = render(<Tile base={base} camera={camera} live />);
      const sub = videoFor("cam_sub");
      fire(sub, "playing");
      flushFrame(sub);
      expect(screen.getByRole("figure")).toHaveClass("is-playing");

      rerender(<Tile base={base} camera={camera} live maximised />);
      const main = videoFor("cam");
      fire(main, "playing");
      // One frame makes the player report playing, but the handover waits for a second painted frame.
      flushFrame(main);
      expect(sub).toHaveClass("is-front");
      expect(main).not.toHaveClass("is-front");
      expect(sub).not.toHaveClass("is-retiring");

      // Second painted frame swaps main in front and keeps sub opaque as the retiring underlay.
      flushFrame(main);
      expect(main).toHaveClass("is-front");
      expect(sub).not.toHaveClass("is-front");
      expect(sub).toHaveClass("is-retiring");
      expect(FakeSocket.open()).toEqual(["cam_sub", "cam"]);

      act(() => vi.advanceTimersByTime(HANDOVER_RETIRE_MS));
      expect(sub).not.toHaveClass("is-retiring");
      expect(FakeSocket.open()).toEqual(["cam"]);

      // Changing back mid-handover cancels the pending callback cleanly.
      rerender(<Tile base={base} camera={camera} live />);
      flushFrame(videoFor("cam_sub"));
      rerender(<Tile base={base} camera={camera} live maximised />);
      expect(cancel).toHaveBeenCalled();
      expect(main).toHaveClass("is-front");

      // Going hidden clears a retiring underlay immediately.
      rerender(<Tile base={base} camera={camera} live />);
      const subAgain = videoFor("cam_sub");
      fire(subAgain, "playing");
      flushFrame(subAgain);
      flushFrame(subAgain);
      expect(main).toHaveClass("is-retiring");
      rerender(<Tile base={base} camera={camera} live={false} />);
      expect(main).not.toHaveClass("is-retiring");
    } finally {
      HTMLVideoElement.prototype.requestVideoFrameCallback = originalRequest;
      HTMLVideoElement.prototype.cancelVideoFrameCallback = originalCancel;
    }
  });

  it("shows the owl at once when the frozen-frame canvas draws transparent", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) })),
    } as unknown as CanvasRenderingContext2D);
    render(<Tile base={base} camera={camera} live />);
    withPicture(videoFor("cam_sub"));
    fire(videoFor("cam_sub"), "playing");
    const figure = screen.getByRole("figure");
    act(() => vi.advanceTimersByTime(STALL_MS));
    expect(figure).toHaveClass("is-reconnecting", "is-lost");
    expect(figure).toHaveTextContent("Reconnecting…");
    expect(figure.querySelector("figcaption")).toHaveTextContent(/^Cam$/);
    const canvas = figure.querySelector("canvas")!;
    expect(canvas).not.toHaveClass("is-shown");
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it("keeps the saved-layout stream during takeovers and uses window width only for manual maximise", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const onAutomatic = vi.fn();
    const { rerender } = render(<Tile base={base} camera={camera} live savedWidth={400} onAutomatic={onAutomatic} />);
    expect(onAutomatic).toHaveBeenLastCalledWith("sub");
    expect(FakeSocket.open()).toEqual(["cam_sub"]);
    fire(window, "resize");
    expect(onAutomatic).toHaveBeenLastCalledWith("sub");

    // A Dynamic wall takeover fills the window visually without switching Automatic to main.
    rerender(<Tile base={base} camera={camera} live maximised takeover savedWidth={400} onAutomatic={onAutomatic} />);
    expect(screen.getByRole("figure")).toHaveClass("is-maximised");
    expect(onAutomatic).toHaveBeenLastCalledWith("sub");
    expect(FakeSocket.open()).toEqual(["cam_sub"]);

    // Manual maximise uses the window width and switches Automatic to main.
    rerender(<Tile base={base} camera={camera} live maximised savedWidth={400} onAutomatic={onAutomatic} />);
    expect(onAutomatic).toHaveBeenLastCalledWith("main");
  });

  it("waits for the saved-layout width to settle before switching Automatic streams", () => {
    const onAutomatic = vi.fn();
    const props = { base, camera, live: true, onAutomatic };
    const { rerender } = render(<Tile {...props} savedWidth={400} />);
    expect(FakeSocket.open()).toEqual(["cam_sub"]);

    rerender(<Tile {...props} savedWidth={1000} />);
    act(() => vi.advanceTimersByTime(AUTO_SETTLE_MS - 1));
    expect(FakeSocket.open()).toEqual(["cam_sub"]);
    rerender(<Tile {...props} savedWidth={400} />);
    act(() => vi.advanceTimersByTime(AUTO_SETTLE_MS));
    expect(FakeSocket.open()).toEqual(["cam_sub"]);

    rerender(<Tile {...props} savedWidth={1000} />);
    act(() => vi.advanceTimersByTime(AUTO_SETTLE_MS));
    expect(onAutomatic).toHaveBeenLastCalledWith("main");
    expect(FakeSocket.open()).toEqual(["cam"]);
  });

  it("dims a frozen picture and says how old it is", () => {
    render(<Tile base={base} camera={camera} live />);
    withPicture(videoFor("cam_sub"));
    fire(videoFor("cam_sub"), "playing");
    const figure = screen.getByRole("figure");
    act(() => vi.advanceTimersByTime(STALE_MS));
    expect(figure).toHaveClass("is-stale");
    expect(figure).toHaveTextContent("Cam · Frozen · 4 s old");
    act(() => vi.advanceTimersByTime(STALL_MS - STALE_MS));
    expect(figure).toHaveTextContent("Cam · Reconnecting · 10 s old");
    act(() => vi.advanceTimersByTime(STALL_CHECK_MS));
    expect(figure).toHaveTextContent("Cam · Reconnecting · 12 s old");
    // A new frame ends it.
    fire(videoFor("cam_sub"), "playing");
    expect(figure).not.toHaveClass("is-stale");
    expect(figure.querySelector("canvas")!.width).toBe(0);
    expect(figure).toHaveTextContent(/^Cam$/);
  });

  it("swaps a frozen picture for the owl once it is old, and never falls back to the snapshot", () => {
    render(<Tile base={base} camera={camera} live />);
    withPicture(videoFor("cam_sub"));
    fire(videoFor("cam_sub"), "playing");
    const figure = screen.getByRole("figure");
    act(() => vi.advanceTimersByTime(STALL_MS));
    expect(figure).toHaveClass("is-reconnecting");
    expect(figure).toHaveTextContent("Cam · Reconnecting · 10 s old");
    const canvas = figure.querySelector("canvas")!;
    expect(canvas).toHaveClass("is-shown");
    expect([canvas.width, canvas.height]).toEqual([320, 180]);
    act(() => vi.advanceTimersByTime(KEEP_FROZEN_MS - STALL_MS));
    expect(figure).toHaveClass("is-lost");
    expect(figure).toHaveTextContent("Reconnecting…");
    // The caption no longer gives an age, since no old picture is shown.
    expect(figure.querySelector("figcaption")).toHaveTextContent(/^Cam$/);
    expect(canvas).not.toHaveClass("is-shown");
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    // Video coming back puts the owl away.
    fire(videoFor("cam_sub"), "playing");
    expect(figure).not.toHaveClass("is-lost");
    expect(figure).not.toHaveClass("is-reconnecting");
  });

  it("discards the last frame when a reconnecting tile stops streaming", () => {
    const { rerender } = render(<Tile base={base} camera={camera} live />);
    const video = videoFor("cam_sub");
    withPicture(video);
    fire(video, "playing");
    fire(video, "error");
    const canvas = screen.getByRole("figure").querySelector("canvas")!;
    expect(canvas.width).toBe(320);
    rerender(<Tile base={base} camera={camera} live={false} />);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    rerender(<Tile base={base} camera={camera} live />);
    expect(canvas).not.toHaveClass("is-shown");
  });

  it("shows the owl at once when it reconnects with no frame of its own", () => {
    const onReconnecting = vi.fn();
    render(<Tile base={base} camera={camera} live onReconnecting={onReconnecting} />);
    expect(onReconnecting).toHaveBeenLastCalledWith(false);
    act(() => FakeSocket.all[0].onclose?.());
    const figure = screen.getByRole("figure");
    expect(figure).toHaveClass("is-lost");
    expect(figure).toHaveTextContent("Reconnecting…");
    expect(onReconnecting).toHaveBeenLastCalledWith(true);
    act(() => vi.advanceTimersByTime(retryDelay(0)));
    withPicture(videoFor("cam_sub"));
    fire(videoFor("cam_sub"), "playing");
    expect(onReconnecting).toHaveBeenLastCalledWith(false);
  });

  it("reports a problem once a tile has been frozen or reconnecting for a while", () => {
    const onProblem = vi.fn();
    render(<Tile base={base} camera={camera} live onProblem={onProblem} />);
    expect(onProblem).toHaveBeenLastCalledWith(false);
    fire(videoFor("cam_sub"), "playing");
    act(() => vi.advanceTimersByTime(STALL_MS));
    expect(onProblem).not.toHaveBeenCalledWith(true);
    act(() => vi.advanceTimersByTime(PROBLEM_AFTER_MS));
    expect(onProblem).toHaveBeenLastCalledWith(true);
    // A new frame ends it, and the next spell of trouble waits again.
    fire(videoFor("cam_sub"), "playing");
    expect(onProblem).toHaveBeenLastCalledWith(false);
    act(() => vi.advanceTimersByTime(STALL_MS));
    expect(onProblem).toHaveBeenLastCalledWith(false);
  });

  it("reports a problem at once when a tile can't play, and nothing while the window is hidden", () => {
    const onProblem = vi.fn();
    const only = { ...camera, subStream: "cam" };
    const { rerender } = render(<Tile base={base} camera={only} live onProblem={onProblem} />);
    const video = videoFor("cam");
    Object.defineProperty(video, "error", { configurable: true, value: { code: 3 } });
    fire(video, "error");
    act(() => vi.advanceTimersByTime(retryDelay(0)));
    fire(video, "error");
    expect(onProblem).toHaveBeenLastCalledWith(true);
    onProblem.mockClear();
    rerender(<Tile base={base} camera={only} live={false} onProblem={onProblem} />);
    expect(onProblem).not.toHaveBeenCalled();
  });

  it("chooses the stream for the tile's size once the size settles", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    let width = 1000;
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width }) as DOMRect);
    const onAutomatic = vi.fn();
    render(<div><Tile base={base} camera={camera} live onAutomatic={onAutomatic} /></div>);
    // Nothing plays until the tile is measured.
    expect(FakeSocket.open()).toEqual([]);
    act(() => FakeResizeObserver.last?.callback());
    expect(FakeSocket.open()).toEqual(["cam"]);
    expect(onAutomatic).toHaveBeenLastCalledWith("main");

    // A little narrower stays on main; it waits for the size to settle.
    width = 800;
    act(() => FakeResizeObserver.last?.callback());
    act(() => vi.advanceTimersByTime(AUTO_SETTLE_MS));
    expect(onAutomatic).toHaveBeenLastCalledWith("main");
    width = 600;
    act(() => FakeResizeObserver.last?.callback());
    act(() => vi.advanceTimersByTime(AUTO_SETTLE_MS - 1));
    expect(onAutomatic).toHaveBeenLastCalledWith("main");
    act(() => vi.advanceTimersByTime(1));
    expect(onAutomatic).toHaveBeenLastCalledWith("sub");
    expect(FakeSocket.open()).toEqual(["cam_sub"]);

    // Once the sub stream is known to be 320 wide, 600 device pixels is worth main.
    const sub = videoFor("cam_sub");
    Object.defineProperty(sub, "videoWidth", { configurable: true, value: 320 });
    fire(sub, "loadedmetadata");
    expect(onAutomatic).toHaveBeenLastCalledWith("main");
    measure.mockRestore();
  });

  it("shows the stream info overlay when asked", () => {
    const { rerender } = render(<Tile base={base} camera={camera} live />);
    expect(screen.queryByRole("complementary", { name: "Stream info" })).not.toBeInTheDocument();
    rerender(<Tile base={base} camera={camera} live streamInfo />);
    expect(screen.getByRole("complementary", { name: "Stream info" })).toHaveTextContent("cam_sub");
  });

  it("outlines motion, shows a chip per moving object and highlights an alert", () => {
    const { rerender } = render(<Tile base={base} camera={camera} live />);
    const tile = screen.getByRole("figure", { name: "Cam" });
    expect(tile).not.toHaveClass("has-motion");
    rerender(<Tile base={base} camera={camera} live activity={{ motion: true, objects: { person: 1, license_plate: 0 }, review: "detection" }} />);
    expect(tile).toHaveClass("has-motion");
    expect(tile).not.toHaveClass("is-alert");
    // A label with no moving objects gets no chip.
    expect(screen.getAllByRole("listitem").map((chip) => chip.textContent)).toEqual(["Person"]);
    rerender(<Tile base={base} camera={camera} live activity={{ motion: false, objects: { person: 2, dog: 1 }, review: "alert" }} />);
    expect(tile).toHaveClass("is-alert");
    expect(tile).not.toHaveClass("has-motion");
    expect(screen.getAllByRole("listitem").map((chip) => chip.textContent)).toEqual(["Person ×2", "Dog"]);
    expect(screen.getByText("· Alert")).toBeInTheDocument();
    rerender(<Tile base={base} camera={camera} live activity={{ motion: false, objects: {}, review: "none" }} />);
    expect(tile).not.toHaveClass("is-alert");
    expect(screen.queryByRole("list", { name: "Objects in view" })).not.toBeInTheDocument();
  });

  it("shows a quiet owl while it has neither a snapshot nor video", () => {
    render(<Tile base={base} camera={camera} live />);
    const snapshot = document.querySelector("img.tile-snapshot") as HTMLImageElement;
    fire(snapshot, "error");
    expect(screen.getByRole("figure")).toHaveTextContent("Waiting for a picture");
    fire(snapshot, "load");
    expect(screen.getByRole("figure")).not.toHaveTextContent("Waiting for a picture");
    fire(snapshot, "error");
    fire(videoFor("cam_sub"), "playing");
    expect(screen.getByRole("figure")).not.toHaveTextContent("Waiting for a picture");
  });
});
