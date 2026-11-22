import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import TileDiagnostics from "./TileDiagnostics";

afterEach(() => vi.useRealTimers());

it("measures displayed frames rather than counting drops, and starts a fresh sample on reconnect", async () => {
  vi.useFakeTimers();
  const element = document.createElement("video");
  let frames = 100, drops = 5, generation = 1;
  const probe = vi.fn(() => ({ transport: "MSE", status: "connected" as const, generation, fallback: true }));
  // The player's counters: the connection's stats for WebRTC, the element's for MSE.
  const counts = vi.fn(async () => ({ shown: frames, dropped: drops }));
  const { unmount } = render(<TileDiagnostics video={{ current: element }} player={{ current: { connection: probe, frames: counts } }} stream="example_sub" state="playing" />);
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText("MSE fallback · connected")).toBeInTheDocument();
  frames += 15;
  drops += 1;
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByText("15.0 fps")).toBeInTheDocument();
  expect(screen.getByText("1 dropped / sample")).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByText("0.0 fps")).toBeInTheDocument();
  generation++;
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByText("— fps")).toBeInTheDocument();
  unmount();
  probe.mockClear();
  await vi.advanceTimersByTimeAsync(1000);
  expect(probe).not.toHaveBeenCalled();
});
