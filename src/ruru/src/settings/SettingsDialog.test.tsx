import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SettingsDialog from "./SettingsDialog";
import type { Settings } from "../app/api";
import { mockCommands } from "../test/mockCommands";

const empty: Settings = { frigateUrl: null, fullScreen: false, layouts: {} };

function open(settings = empty) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(<SettingsDialog settings={settings} onSaved={onSaved} onClose={onClose} />);
  return { onSaved, onClose, field: screen.getByLabelText("Frigate URL") };
}

describe("SettingsDialog", () => {
  it("shows the Frigate page with the saved URL", () => {
    const { field } = open({ ...empty, frigateUrl: "http://frigate:5000" });
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Frigate" })).toBeInTheDocument();
    expect(field).toHaveValue("http://frigate:5000");
    expect(field).toHaveFocus();
  });

  it("keeps Test connection and Save off until a URL is typed", () => {
    open();
    expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("tests the connection and shows Frigate's version and camera count", async () => {
    const calls = mockCommands({ test_frigate: () => ({ version: "0.18.0", cameraCount: 10 }) });
    const { field } = open();
    fireEvent.change(field, { target: { value: "http://frigate:5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connected to Frigate 0.18.0, with 10 cameras.")).toBeInTheDocument();
    expect(calls).toEqual([{ cmd: "test_frigate", payload: { url: "http://frigate:5000" } }]);
  });

  it("says 1 camera for one camera, and clears the result when the URL changes", async () => {
    mockCommands({ test_frigate: () => ({ version: "0.18.0", cameraCount: 1 }) });
    const { field } = open({ ...empty, frigateUrl: "http://f" });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connected to Frigate 0.18.0, with 1 camera.")).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "http://g" } });
    expect(screen.queryByText(/Connected to Frigate/)).not.toBeInTheDocument();
  });

  it("shows why the connection failed", async () => {
    mockCommands({
      test_frigate: () => {
        throw "Could not reach Frigate at http://f: connection refused";
      },
    });
    open({ ...empty, frigateUrl: "http://f" });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach Frigate at http://f: connection refused");
  });

  it("saves the URL and closes", async () => {
    const saved = { ...empty, frigateUrl: "http://frigate:5000" };
    const calls = mockCommands({ save_frigate_url: () => saved });
    const { field, onSaved, onClose } = open();
    fireEvent.change(field, { target: { value: "http://frigate:5000/" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(calls).toEqual([{ cmd: "save_frigate_url", payload: { url: "http://frigate:5000/" } }]);
  });

  it("keeps the dialog open with the reason when Save fails", async () => {
    mockCommands({
      save_frigate_url: () => {
        throw new Error("Enter a Frigate URL starting with http:// or https://.");
      },
    });
    const { field, onSaved, onClose } = open();
    fireEvent.change(field, { target: { value: "frigate" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("starting with http://");
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("closes on Cancel and on Escape", () => {
    const { onClose } = open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
