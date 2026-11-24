import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HostControlsStatus } from "../app/api";
import { mockCommands } from "../test/mockCommands";
import HostControls from "./HostControls";

const available: HostControlsStatus = {
  supported: true,
  enabled: false,
  connected: false,
  cleanupPending: false,
  message: null,
};

describe("Settings, host controls", () => {
  it("tests separate credentials and requires consent before enabling the service", async () => {
    const calls = mockCommands({
      host_controls_status: () => available,
      test_host_controls: () => null,
      enable_host_controls: () => null,
    });
    render(<HostControls mqttEnabled />);
    fireEvent.click(await screen.findByRole("button", { name: "Enable host controls" }));
    const enable = screen.getByRole("button", { name: "Enable and restart Ruru" });
    expect(enable).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Host controls MQTT username"), { target: { value: "agent" } });
    fireEvent.change(screen.getByLabelText("Host controls MQTT password"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "Test host controls connection" }));
    expect(await screen.findByText("Connected with the host controls account.")).toBeVisible();
    expect(enable).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Let Ruru manage its user service/ }));
    fireEvent.click(enable);
    await waitFor(() => expect(calls).toContainEqual({
      cmd: "enable_host_controls",
      payload: { credentials: { username: "agent", password: "password" }, consent: true },
    }));
    expect(calls).toContainEqual({
      cmd: "test_host_controls",
      payload: { credentials: { username: "agent", password: "password" } },
    });
  });

  it("shows when the agent is connected and lets the user turn it off", async () => {
    let status = { ...available, enabled: true, connected: true };
    mockCommands({
      host_controls_status: () => status,
      disable_host_controls: () => {
        status = available;
        return status;
      },
    });
    render(<HostControls mqttEnabled />);
    expect(await screen.findByText("Host controls connected")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Disable host controls" }));
    expect(await screen.findByRole("button", { name: "Enable host controls" })).toBeEnabled();
  });
});
