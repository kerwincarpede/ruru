import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UpdateNotice from "./UpdateNotice";

describe("UpdateNotice", () => {
  it("shows how far the download is, with nothing to choose", () => {
    render(<UpdateNotice status={{ state: "downloading", version: "0.4.1", percent: 42 }} onClose={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Downloading Ruru 0.4.1: 42%. Ruru will restart when it’s done.");
    expect(screen.getByRole("progressbar", { name: "Downloading Ruru 0.4.1" })).toHaveAttribute("value", "42");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a download of unknown size as under way", () => {
    render(<UpdateNotice status={{ state: "downloading", version: "0.4.1", percent: null }} onClose={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Downloading Ruru 0.4.1… Ruru will restart when it’s done.");
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
  });

  it("says the update is installing, with nothing to choose", () => {
    render(<UpdateNotice status={{ state: "installing", version: "0.4.1" }} onClose={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Installing Ruru 0.4.1. Ruru will restart in a moment.");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says why an automatic install failed, and OK puts it away", () => {
    const onClose = vi.fn();
    render(
      <UpdateNotice
        status={{ state: "failed", version: "0.4.1", message: "The update could not be installed: bad signature", automatic: true }}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Ruru 0.4.1 could not be installed. Ruru will try again later.");
    expect(screen.getByRole("alert")).toHaveTextContent("bad signature");
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("promises no retry for an install someone asked for", () => {
    render(<UpdateNotice status={{ state: "failed", version: "0.4.1", message: "Cancelled", automatic: false }} onClose={vi.fn()} />);
    expect(screen.getByRole("alert")).not.toHaveTextContent("try again later");
  });
});
