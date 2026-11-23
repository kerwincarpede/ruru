import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StreamsOff from "./StreamsOff";

describe("StreamsOff", () => {
  it("says the streams are off and starts them from its button", () => {
    const onStart = vi.fn();
    render(<StreamsOff homeAssistant={false} onStart={onStart} />);
    const status = screen.getByRole("status", { name: "Streams are off" });
    expect(status).toHaveTextContent("right-click anywhere and choose Start streams");
    expect(status).not.toHaveTextContent("Home Assistant");
    fireEvent.click(screen.getByRole("button", { name: "Start streams" }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("points to the Home Assistant switch when Home Assistant is connected", () => {
    render(<StreamsOff homeAssistant onStart={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("turn on the Streams switch in Home Assistant");
  });
});
