import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SettingsDialog from "./SettingsDialog";
import { DEFAULT_MQTT_SETTINGS, DEFAULT_WALL_OPTIONS, type Settings } from "../app/api";
import { mockCommands } from "../test/mockCommands";

const empty: Settings = { frigateUrl: null, fullScreen: false, wall: DEFAULT_WALL_OPTIONS, updateChannel: "stable", autoUpdate: false, mqtt: DEFAULT_MQTT_SETTINGS, layouts: {} };

const info = { name: "Ruru", version: "0.3.0" };

function open(settings = empty) {
  const onSaved = vi.fn();
  const onChannelSaved = vi.fn();
  const onAutoUpdateSaved = vi.fn();
  const onUpdate = vi.fn();
  const onClose = vi.fn();
  const onMqttSaved = vi.fn();
  const onWallSaved = vi.fn();
  const props = { info, onSaved, onChannelSaved, onAutoUpdateSaved, onMqttSaved, onWallSaved, onUpdate, onClose };
  const { rerender } = render(<SettingsDialog settings={settings} {...props} />);
  // The window passes the saved settings back in, as App does.
  const passBack = (saved: Settings) => rerender(<SettingsDialog settings={saved} {...props} />);
  onChannelSaved.mockImplementation(passBack);
  onAutoUpdateSaved.mockImplementation(passBack);
  return { onSaved, onChannelSaved, onAutoUpdateSaved, onUpdate, onClose, onWallSaved, field: screen.getByLabelText("Frigate URL") };
}

function openUpdates(settings = empty) {
  const opened = open(settings);
  fireEvent.click(screen.getByRole("button", { name: "Updates" }));
  return { ...opened, channel: screen.getByLabelText("Update channel") };
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

  it("closes on Cancel, Close Settings and Escape", () => {
    const { onClose } = open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Close Settings" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe("SettingsDialog Appearance page", () => {
  function openAppearance(settings = empty) {
    const opened = open(settings);
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    return opened;
  }

  it("saves highlighting and tile details without saving the MQTT connection", async () => {
    const calls = mockCommands({ save_wall_options: () => null });
    const { onWallSaved, onClose } = openAppearance({ ...empty, wall: { ...empty.wall, fitToWindow: false } });
    const activity = screen.getByRole("checkbox", { name: "Show activity" });
    const style = screen.getByLabelText("Activity style");
    const save = screen.getByRole("button", { name: "Save" });
    expect(activity).toBeChecked();
    expect(activity).toHaveAccessibleDescription(/Connect to Home Assistant/);
    expect(style).toHaveValue("ring");
    expect(save).toBeDisabled();
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Outline between tiles", "Thin outline", "Corner marks", "Top edge", "Name only"]);
    fireEvent.change(style, { target: { value: "corners" } });
    expect(style).toHaveAccessibleDescription(/four corners only/);
    fireEvent.click(activity);
    expect(style).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show stream info" }));
    expect(calls).toEqual([]);
    fireEvent.click(save);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const options = { ...empty.wall, fitToWindow: false, activity: false, activityStyle: "corners", streamInfo: true };
    expect(calls).toEqual([{ cmd: "save_wall_options", payload: { options } }]);
    expect(onWallSaved).toHaveBeenCalledWith(options);
  });

  it("shows a save error and keeps the draft for retry", async () => {
    mockCommands({
      save_wall_options: () => {
        throw "The settings could not be saved: disk full";
      },
    });
    const { onWallSaved, onClose } = openAppearance({ ...empty, mqtt: { ...empty.mqtt, enabled: true } });
    const activity = screen.getByRole("checkbox", { name: "Show activity" });
    expect(activity).toHaveAccessibleDescription("Mark tiles when Frigate detects motion, objects or alerts.");
    fireEvent.click(activity);
    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.click(save);
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(activity).not.toBeChecked();
    expect(save).toBeEnabled();
    expect(onWallSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("SettingsDialog Updates page", () => {
  it("shows the version and the saved channel", () => {
    const { channel } = openUpdates();
    expect(screen.getByRole("heading", { name: "Updates" })).toBeInTheDocument();
    expect(screen.getByText("Ruru 0.3.0")).toBeInTheDocument();
    expect(channel).toHaveValue("stable");
    expect(channel).toHaveAccessibleDescription("Get updates after they’ve been tried on Edge.");
  });

  it("says Edge by the version on the Edge channel", () => {
    const { channel } = openUpdates({ ...empty, updateChannel: "edge" });
    expect(screen.getByText("Ruru 0.3.0 · Edge")).toBeInTheDocument();
    expect(channel).toHaveValue("edge");
  });

  it("keeps a typed URL when moving between pages", () => {
    const { field } = open();
    fireEvent.change(field, { target: { value: "http://typed" } });
    fireEvent.click(screen.getByRole("button", { name: "Updates" }));
    expect(screen.getByRole("button", { name: "Updates" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Frigate" }));
    expect(screen.getByLabelText("Frigate URL")).toHaveValue("http://typed");
  });

  it("switching to Edge saves it and checks Edge straight away", async () => {
    const calls = mockCommands({
      set_update_channel: ({ channel }) => ({ ...empty, updateChannel: channel }),
      fake_update: () => null,
      check_update: () => "0.4.0",
    });
    const { channel, onChannelSaved, onUpdate } = openUpdates();
    fireEvent.change(channel, { target: { value: "edge" } });
    expect(await screen.findByText("Ruru 0.4.0 is ready.")).toBeInTheDocument();
    expect(onChannelSaved).toHaveBeenCalledWith({ ...empty, updateChannel: "edge" });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ version: "0.4.0" }));
    expect(calls.map((call) => call.cmd)).toEqual(["set_update_channel", "fake_update", "check_update"]);
    expect(calls[0].payload).toEqual({ channel: "edge" });
    expect(screen.getByText("Ruru 0.3.0 · Edge")).toBeInTheDocument();
    expect(screen.getByLabelText("Update channel")).toHaveAccessibleDescription(
      "Get every change as soon as it’s built. You may run into bugs.",
    );
  });

  it("installs the update it found when asked", async () => {
    const calls = mockCommands({ fake_update: () => null, check_update: () => "0.4.0", install_update: () => null });
    openUpdates();
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    fireEvent.click(await screen.findByRole("button", { name: "Install and restart" }));
    await waitFor(() => expect(calls.map((call) => call.cmd)).toContain("install_update"));
  });

  it("says why an install failed and lets the user try again", async () => {
    mockCommands({
      fake_update: () => null,
      check_update: () => "0.4.0",
      install_update: () => {
        throw "The update could not be installed: bad signature";
      },
    });
    openUpdates();
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    fireEvent.click(await screen.findByRole("button", { name: "Install and restart" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("bad signature");
    expect(screen.getByRole("button", { name: "Install and restart" })).toBeEnabled();
  });

  it("moving back to Stable says the version is kept until Stable passes it", async () => {
    mockCommands({
      set_update_channel: ({ channel }) => ({ ...empty, updateChannel: channel }),
      fake_update: () => null,
      check_update: () => null,
    });
    const { channel, onUpdate } = openUpdates({ ...empty, updateChannel: "edge" });
    fireEvent.change(channel, { target: { value: "stable" } });
    expect(await screen.findByText("Ruru is up to date.")).toBeInTheDocument();
    expect(onUpdate).toHaveBeenLastCalledWith(null);
    expect(screen.getByLabelText("Update channel")).toHaveAccessibleDescription(/keep your version until a newer Stable release is out/);
  });

  it("shows why a check failed", async () => {
    mockCommands({
      fake_update: () => null,
      check_update: () => {
        throw "Could not find Edge releases: timed out";
      },
    });
    const { onUpdate } = openUpdates({ ...empty, updateChannel: "edge" });
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not find Edge releases: timed out");
    expect(onUpdate).toHaveBeenLastCalledWith(null);
  });

  it("keeps the channel when saving it fails", async () => {
    const calls = mockCommands({
      set_update_channel: () => {
        throw "The settings could not be saved: disk full";
      },
    });
    const { channel, onChannelSaved } = openUpdates();
    fireEvent.change(channel, { target: { value: "edge" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(onChannelSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Update channel")).toHaveValue("stable");
    expect(calls.map((call) => call.cmd)).toEqual(["set_update_channel"]);
  });

  it("installs updates by asking first until automatic updates are turned on", () => {
    openUpdates();
    const box = screen.getByRole("checkbox", { name: "Install updates automatically" });
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription(/installs the update and restarts without asking/);
  });

  it("turning on automatic updates saves it and puts away an update found by hand", async () => {
    const calls = mockCommands({
      fake_update: () => null,
      check_update: () => "0.4.0",
      set_auto_update: ({ enabled }) => ({ ...empty, autoUpdate: enabled }),
    });
    const { onAutoUpdateSaved, onUpdate } = openUpdates();
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("Ruru 0.4.0 is ready.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Install updates automatically" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Install updates automatically" })).toBeChecked());
    expect(onAutoUpdateSaved).toHaveBeenCalledWith({ ...empty, autoUpdate: true });
    expect(onUpdate).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText("Ruru 0.4.0 is ready.")).not.toBeInTheDocument();
    expect(calls).toContainEqual({ cmd: "set_auto_update", payload: { enabled: true } });
  });

  it("turning off automatic updates saves it", async () => {
    const calls = mockCommands({ set_auto_update: ({ enabled }) => ({ ...empty, autoUpdate: enabled }) });
    openUpdates({ ...empty, autoUpdate: true });
    const box = screen.getByRole("checkbox", { name: "Install updates automatically" });
    expect(box).toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Install updates automatically" })).not.toBeChecked());
    expect(calls).toEqual([{ cmd: "set_auto_update", payload: { enabled: false } }]);
  });

  it("keeps automatic updates as they were when saving fails", async () => {
    mockCommands({
      set_auto_update: () => {
        throw "The settings could not be saved: disk full";
      },
    });
    const { onAutoUpdateSaved } = openUpdates();
    fireEvent.click(screen.getByRole("checkbox", { name: "Install updates automatically" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(onAutoUpdateSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "Install updates automatically" })).not.toBeChecked();
  });

  it("closes on Close", () => {
    const { onClose } = openUpdates();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
