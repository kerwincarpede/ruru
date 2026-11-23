import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SettingsDialog from "./SettingsDialog";
import { DEFAULT_MQTT_SETTINGS, DEFAULT_WALL_OPTIONS, type MqttSettings, type Settings } from "../app/api";
import { mockCommands } from "../test/mockCommands";

const empty: Settings = { frigateUrl: null, fullScreen: false, wall: DEFAULT_WALL_OPTIONS, updateChannel: "stable", autoUpdate: false, mqtt: DEFAULT_MQTT_SETTINGS, layouts: {} };

function openHomeAssistant(mqtt: Partial<MqttSettings> = {}) {
  const onMqttSaved = vi.fn();
  const onActivity = vi.fn();
  const onClose = vi.fn();
  render(
    <SettingsDialog
      settings={{ ...empty, mqtt: { ...DEFAULT_MQTT_SETTINGS, ...mqtt } }}
      info={null}
      onSaved={vi.fn()}
      onChannelSaved={vi.fn()}
      onAutoUpdateSaved={vi.fn()}
      onMqttSaved={onMqttSaved}
      onActivity={onActivity}
      onUpdate={vi.fn()}
      onClose={onClose}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Home Assistant" }));
  return { onMqttSaved, onActivity, onClose };
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("SettingsDialog Home Assistant page", () => {
  it("starts off, with the usual port and prefixes", () => {
    openHomeAssistant();
    expect(screen.getByRole("heading", { name: "Home Assistant" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Connect to Home Assistant" })).not.toBeChecked();
    expect(screen.getByLabelText("Port")).toHaveValue("1883");
    expect(screen.getByLabelText("Discovery prefix")).toHaveValue("homeassistant");
    expect(screen.getByLabelText("Frigate prefix")).toHaveValue("frigate");
    expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
    expect(screen.getByText("Ruru keeps the password in this computer’s keychain if it has one, or else in Ruru’s settings file.")).toBeInTheDocument();
  });

  it("tests the broker with what was typed and says it connected", async () => {
    const calls = mockCommands({ test_mqtt: () => null });
    openHomeAssistant();
    type("Broker", "ha.local");
    type("Username", "ruru");
    type("Password", "secret");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connected to the broker at ha.local:1883.")).toBeInTheDocument();
    expect(calls).toEqual([
      {
        cmd: "test_mqtt",
        payload: {
          input: { enabled: false, host: "ha.local", port: 1883, tls: false, username: "ruru", discoveryPrefix: "homeassistant", frigatePrefix: "frigate" },
          password: "secret",
        },
      },
    ]);
  });

  it("shows why the broker refused", async () => {
    mockCommands({
      test_mqtt: () => {
        throw "The broker at ha.local:1883 refused the username or password.";
      },
    });
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    openHomeAssistant({ host: "ha.local" });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("refused the username or password");
    // The result is scrolled into view, clear of the footer.
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it("refuses a port that is not a number without asking the broker", async () => {
    const calls = mockCommands({});
    openHomeAssistant({ host: "ha.local" });
    type("Port", "70000");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a port from 1 to 65535.");
    expect(calls).toEqual([]);
  });

  it("moves the usual port along with TLS", () => {
    openHomeAssistant();
    fireEvent.click(screen.getByRole("checkbox", { name: "Use TLS" }));
    expect(screen.getByLabelText("Port")).toHaveValue("8883");
    fireEvent.click(screen.getByRole("checkbox", { name: "Use TLS" }));
    expect(screen.getByLabelText("Port")).toHaveValue("1883");
    type("Port", "1884");
    fireEvent.click(screen.getByRole("checkbox", { name: "Use TLS" }));
    expect(screen.getByLabelText("Port")).toHaveValue("1884");
  });

  it("keeps a saved password unless a new one is typed", async () => {
    const saved: Settings = { ...empty, mqtt: { ...DEFAULT_MQTT_SETTINGS, enabled: true, host: "ha.local", username: "ruru", deviceId: "0123456789ab", passwordStorage: "keychain" } };
    const calls = mockCommands({ save_mqtt: () => saved });
    const { onMqttSaved, onClose } = openHomeAssistant({ host: "ha.local", username: "ruru", passwordStorage: "keychain" });
    expect(screen.getByLabelText("Password")).toHaveAttribute("placeholder", "Saved");
    fireEvent.click(screen.getByRole("checkbox", { name: "Connect to Home Assistant" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onMqttSaved).toHaveBeenCalledWith(saved));
    expect(onClose).toHaveBeenCalled();
    expect(calls).toEqual([
      {
        cmd: "save_mqtt",
        payload: {
          input: { enabled: true, host: "ha.local", port: 1883, tls: false, username: "ruru", discoveryPrefix: "homeassistant", frigatePrefix: "frigate" },
          password: null,
        },
      },
    ]);
  });

  it("keeps the saved password when a typed one is cleared again", async () => {
    const calls = mockCommands({ save_mqtt: () => empty });
    openHomeAssistant({ host: "ha.local", username: "ruru", passwordStorage: "keychain" });
    type("Password", "typo");
    type("Password", "");
    expect(screen.getByLabelText("Password")).toHaveAttribute("placeholder", "Saved");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].payload).toMatchObject({ password: null });
  });

  it("says the keychain holds a saved password", () => {
    openHomeAssistant({ host: "ha.local", username: "ruru", passwordStorage: "keychain" });
    expect(screen.getByText("The password is kept in this computer’s keychain.")).toBeInTheDocument();
  });

  it("shows activity by default and saves a change with the connection", async () => {
    mockCommands({ save_mqtt: () => empty });
    const { onActivity, onClose } = openHomeAssistant();
    const option = screen.getByRole("checkbox", { name: "Show activity" });
    expect(option).toBeChecked();
    fireEvent.click(option);
    expect(onActivity).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onActivity).toHaveBeenCalledWith(false);
  });

  it("leaves Show activity alone when it was not changed", async () => {
    mockCommands({ save_mqtt: () => empty });
    const { onActivity, onClose } = openHomeAssistant();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onActivity).not.toHaveBeenCalled();
  });

  it("says when the password is kept in the settings file", () => {
    openHomeAssistant({ host: "ha.local", username: "ruru", passwordStorage: "file" });
    expect(screen.getByText("This computer has no keychain Ruru can use, so the password is kept in Ruru’s settings file.")).toBeInTheDocument();
  });

  it("needs a broker to save a connection that is on, and shows a failed save", async () => {
    mockCommands({
      save_mqtt: () => {
        throw "Enter a discovery prefix without spaces, + or #.";
      },
    });
    const { onClose } = openHomeAssistant();
    fireEvent.click(screen.getByRole("checkbox", { name: "Connect to Home Assistant" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    type("Broker", "ha.local");
    type("Discovery prefix", "home assistant");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a discovery prefix");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("refuses to save a port that is not a number", async () => {
    const calls = mockCommands({});
    openHomeAssistant();
    type("Port", "port");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a port from 1 to 65535.");
    expect(calls).toEqual([]);
  });
});
