import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AutoUpdateNotice from "./AutoUpdateNotice";

describe("AutoUpdateNotice", () => {
  it("says the update is installing, with nothing to choose", () => {
    render(<AutoUpdateNotice status={{ state: "installing", version: "0.4.1" }} onClose={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Installing Ruru 0.4.1. Ruru will restart in a moment.");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says why an install failed, and OK puts it away", () => {
    const onClose = vi.fn();
    render(<AutoUpdateNotice status={{ state: "failed", version: "0.4.1", message: "The update could not be installed: bad signature" }} onClose={onClose} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Ruru 0.4.1 could not be installed. Ruru will try again later.");
    expect(screen.getByRole("alert")).toHaveTextContent("bad signature");
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
