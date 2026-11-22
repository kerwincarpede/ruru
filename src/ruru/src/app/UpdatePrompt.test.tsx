import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UpdatePrompt from "./UpdatePrompt";

function prompt(install: () => Promise<void> = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(<UpdatePrompt update={{ version: "0.2.0", install }} onClose={onClose} />);
  return { install, onClose };
}

describe("UpdatePrompt", () => {
  it("asks to install the version and restart", () => {
    prompt();
    expect(screen.getByRole("dialog", { name: "Ruru 0.2.0 is ready. Install and restart?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install and restart" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Not now" })).toBeEnabled();
  });

  it("Not now closes without installing", () => {
    const { install, onClose } = prompt();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(install).not.toHaveBeenCalled();
  });

  it("Install and restart installs, disabling both buttons until it is done", async () => {
    let finish: () => void = () => {};
    const install = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { onClose } = prompt(install);
    fireEvent.click(screen.getByRole("button", { name: "Install and restart" }));
    expect(install).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Installing…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Not now" })).toBeDisabled();
    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("says so when the install fails, and lets the user try again or decline", async () => {
    const install = vi.fn().mockRejectedValueOnce(new Error("bad signature")).mockResolvedValueOnce(undefined);
    const { onClose } = prompt(install);
    fireEvent.click(screen.getByRole("button", { name: "Install and restart" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The update could not be installed.");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Not now" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Install and restart" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
