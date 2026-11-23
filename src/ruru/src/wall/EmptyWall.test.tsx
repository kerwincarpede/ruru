import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EveryCameraHidden, NoCameras } from "./EmptyWall";

describe("EmptyWall", () => {
  it("says Frigate has no cameras and checks again", () => {
    const onCheck = vi.fn();
    render(<NoCameras onCheck={onCheck} />);
    expect(screen.getByRole("status", { name: "Frigate has no cameras yet" })).toHaveTextContent("Add a camera to Frigate's config.");
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(onCheck).toHaveBeenCalledOnce();
  });

  it("says every camera is hidden and offers to show them or edit the layout", () => {
    const onShowAll = vi.fn();
    const onEdit = vi.fn();
    const { rerender } = render(<EveryCameraHidden count={6} onShowAll={onShowAll} onEdit={onEdit} />);
    expect(screen.getByRole("status", { name: "Every camera is hidden" })).toHaveTextContent("You hid all 6 cameras in Edit layout.");
    fireEvent.click(screen.getByRole("button", { name: "Show all cameras" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));
    expect(onShowAll).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledOnce();
    rerender(<EveryCameraHidden count={1} onShowAll={onShowAll} onEdit={onEdit} />);
    expect(screen.getByRole("status")).toHaveTextContent("You hid the only camera in Edit layout.");
  });
});
