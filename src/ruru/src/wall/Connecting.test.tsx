import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Connecting, { MAX_DOTS } from "./Connecting";

const frigate = { stage: "frigate", server: "http://frigate:5000", onRetry: () => {}, onSettings: () => {} } as const;

describe("Connecting", () => {
  it("says it is looking for cameras until Frigate answers", () => {
    render(<Connecting {...frigate} />);
    expect(screen.getByRole("status", { name: "Looking for cameras" })).toHaveTextContent("Asking Frigate at http://frigate:5000");
  });

  it("explains each kind of problem, shows the error and offers Try again and Settings", () => {
    const onRetry = vi.fn();
    const onSettings = vi.fn();
    const { rerender } = render(<Connecting {...frigate} error="Could not reach Frigate at http://frigate:5000: connection refused" onRetry={onRetry} onSettings={onSettings} />);
    const status = screen.getByRole("status", { name: "Ruru can't reach Frigate" });
    expect(status).toHaveTextContent("Nothing answered at http://frigate:5000.");
    expect(status).toHaveTextContent("Could not reach Frigate at http://frigate:5000: connection refused");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onSettings).toHaveBeenCalledOnce();

    rerender(<Connecting {...frigate} error="Frigate at http://frigate:5000 answered with HTTP 401." />);
    expect(screen.getByRole("status", { name: "Frigate turned Ruru away" })).toHaveTextContent("answered with HTTP 401. Check the address");
    rerender(<Connecting {...frigate} error="Frigate's answer was not understood: expected value" />);
    expect(screen.getByRole("status", { name: "That doesn't look like Frigate" })).toHaveTextContent("not with Frigate's camera list");
    rerender(<Connecting {...frigate} error="Waiting for Frigate…" />);
    const waiting = screen.getByRole("status", { name: "Waiting for Frigate…" });
    expect(waiting).toHaveTextContent("isn't answering yet");
    expect(waiting.querySelector(".wall-notice-error")).toBeNull();
  });

  it("lights a dot for each camera as it connects, and counts a single camera as one camera", () => {
    const { rerender } = render(<Connecting stage="cameras" cameras={["garage"]} connected={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("0 of 1 camera connected");
    rerender(<Connecting stage="cameras" cameras={["garage", "front_door"]} connected={["front_door"]} />);
    const dots = within(screen.getByRole("list", { name: "Cameras" })).getAllByRole("listitem");
    expect(dots.map((dot) => dot.getAttribute("aria-label"))).toEqual(["Garage: connecting", "Front door: connected"]);
  });

  it("shows a bar instead of dots for many cameras", () => {
    const cameras = Array.from({ length: MAX_DOTS + 1 }, (_, index) => `cam${index}`);
    render(<Connecting stage="cameras" cameras={cameras} connected={["cam0"]} />);
    expect(screen.queryByRole("list", { name: "Cameras" })).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Cameras connected" })).toHaveAttribute("aria-valuenow", "1");
  });

  it("says how many cameras are reconnecting, with a dot for each", () => {
    render(<Connecting stage="reconnecting" cameras={["garage", "front_door", "bins"]} reconnecting={["garage", "bins"]} />);
    const status = screen.getByRole("status", { name: "Reconnecting to Frigate" });
    expect(status).toHaveTextContent("2 of 3 cameras lost their video. Ruru keeps trying on its own.");
    expect(within(status).getByRole("listitem", { name: "Garage: reconnecting" })).toBeInTheDocument();
    expect(within(status).getByRole("listitem", { name: "Front door: connected" })).toBeInTheDocument();
  });
});
