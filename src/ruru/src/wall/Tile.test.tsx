import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Camera } from "../app/frigate";
import { forgetFailures, retryDelay, STALE_MS, STALL_CHECK_MS, STALL_MS } from "./player";
import { AUTO_SETTLE_MS, forgetWidths } from "./streams";
import Tile from "./Tile";

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

  it("keeps showing the current stream until the new one shows a frame", () => {
    const { rerender } = render(<Tile base={base} camera={camera} live />);
    fire(videoFor("cam_sub"), "playing");
    expect(screen.getByRole("figure")).toHaveClass("is-playing");

    // Maximised, Automatic wants main: the sub stream plays on meanwhile.
    rerender(<Tile base={base} camera={camera} live maximised />);
    expect(FakeSocket.open()).toEqual(["cam_sub", "cam"]);
    expect(videoFor("cam_sub")).toHaveClass("is-front");
    expect(screen.getByRole("figure")).toHaveClass("is-playing");
    fire(videoFor("cam"), "playing");
    expect(FakeSocket.open()).toEqual(["cam"]);
    expect(videoFor("cam")).toHaveClass("is-front");

    // Back on the wall, the main stream plays until the sub stream is back.
    rerender(<Tile base={base} camera={camera} live />);
    expect(FakeSocket.open()).toEqual(["cam", "cam_sub"]);
    fire(videoFor("cam_sub"), "playing");
    expect(FakeSocket.open()).toEqual(["cam_sub"]);
  });

  it("dims a frozen picture and says how old it is", () => {
    render(<Tile base={base} camera={camera} live />);
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
    expect(figure).toHaveTextContent(/^Cam$/);
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
});
