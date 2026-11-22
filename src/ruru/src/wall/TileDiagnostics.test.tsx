import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import TileDiagnostics from "./TileDiagnostics";

afterEach(() => vi.useRealTimers());

it("measures displayed frames rather than counting drops, and starts a fresh sample on reconnect", () => {
  vi.useFakeTimers();
  const element = document.createElement("video");
  let frames = 100, drops = 5, generation = 1;
  element.getVideoPlaybackQuality = () => ({ totalVideoFrames: frames, droppedVideoFrames: drops }) as VideoPlaybackQuality;
  const probe = vi.fn(() => ({ transport: "MSE", status: "connected" as const, generation, fallback: true }));
  const { unmount } = render(<TileDiagnostics video={{ current: element }} player={{ current: { connection: probe } }} stream="example_sub" state="playing" />);
  act(() => vi.advanceTimersByTime(0));
  expect(screen.getByText("MSE fallback · connected")).toBeInTheDocument();
  frames += 16;
  drops += 1;
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByText("15.0 fps")).toBeInTheDocument();
  expect(screen.getByText("1 dropped / sample")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByText("0.0 fps")).toBeInTheDocument();
  generation++;
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByText("— fps")).toBeInTheDocument();
  unmount();
  probe.mockClear();
  vi.advanceTimersByTime(1000);
  expect(probe).not.toHaveBeenCalled();
});
