import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DYNAMIC_WALL, DEFAULT_MQTT_SETTINGS, DEFAULT_WALL_OPTIONS, type DynamicWall, type Settings } from "../app/api";
import { mockCommands } from "../test/mockCommands";
import AppearancePage from "./AppearancePage";

const SERVER = "http://frigate:5000";
const ten = ["maingate", "garage", "yard", "drive", "porch", "side", "back", "shed", "pool", "gate"];
const settings: Settings = { frigateUrl: SERVER, fullScreen: false, wall: DEFAULT_WALL_OPTIONS, updateChannel: "stable", autoUpdate: false, mqtt: { ...DEFAULT_MQTT_SETTINGS, enabled: true }, layouts: {}, dynamicWalls: {} };

function page({ cameras = ten, dynamic = DEFAULT_DYNAMIC_WALL, server = SERVER as string | null, dynamicWall = false } = {}) {
  const onSaved = vi.fn();
  const onDynamicSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <AppearancePage
      wall={{ ...DEFAULT_WALL_OPTIONS, dynamicWall }}
      mqttEnabled
      server={server}
      dynamic={dynamic}
      cameras={cameras}
      layout={undefined}
      wallSize={{ width: 1920, height: 1080 }}
      onSaved={onSaved}
      onDynamicSaved={onDynamicSaved}
      onClose={onClose}
    />,
  );
  return { onSaved, onDynamicSaved, onClose };
}

const tiles = () => within(screen.getByRole("img", { name: "Dynamic wall preview" })).getAllByText(/.+/);

describe("AppearancePage Dynamic wall", () => {
  it("is off by default and previews two heroes above two rows of four", () => {
    page();
    const toggle = screen.getByRole("checkbox", { name: "Dynamic wall" });
    expect(toggle).not.toBeChecked();
    expect(screen.getByLabelText("First hero slot")).toBeDisabled();
    expect(screen.getByRole("group", { name: "Priority cameras" })).toBeDisabled();
    const shown = tiles();
    expect(shown).toHaveLength(10);
    expect(shown.filter((tile) => tile.classList.contains("is-hero")).map((tile) => tile.textContent)).toEqual(["Maingate", "Garage"]);
    expect(shown[0]).toHaveStyle({ width: "50%" });
    expect(shown[2]).toHaveStyle({ width: "25%" });
  });

  it("saves the toggle, hero slots and priority cameras together in one command", async () => {
    const saved: Settings = { ...settings, wall: { ...DEFAULT_WALL_OPTIONS, dynamicWall: true } };
    const calls = mockCommands({ save_dynamic_wall: () => saved });
    const { onDynamicSaved, onSaved, onClose } = page();
    fireEvent.click(screen.getByRole("checkbox", { name: "Dynamic wall" }));
    fireEvent.change(screen.getByLabelText("First hero slot"), { target: { value: "yard" } });
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(screen.getByText("Pick two different cameras, or leave both on Automatic.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Second hero slot"), { target: { value: "drive" } });
    expect(save).toBeEnabled();
    // The preview shows the chosen slots as the heroes.
    expect(tiles().filter((tile) => tile.classList.contains("is-hero")).map((tile) => tile.textContent)).toEqual(["Yard", "Drive"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Maingate" }));
    fireEvent.click(save);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const dynamic: DynamicWall = { heroSlots: ["yard", "drive"], priorityCameras: ["maingate"] };
    expect(calls).toEqual([{ cmd: "save_dynamic_wall", payload: { options: { ...DEFAULT_WALL_OPTIONS, dynamicWall: true }, server: SERVER, dynamic } }]);
    expect(onDynamicSaved).toHaveBeenCalledWith(saved);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("never draws a camera twice when both slots pick it", () => {
    page({ dynamicWall: true });
    fireEvent.change(screen.getByLabelText("First hero slot"), { target: { value: "yard" } });
    fireEvent.change(screen.getByLabelText("Second hero slot"), { target: { value: "yard" } });
    const names = tiles().map((tile) => tile.textContent);
    expect(names).toHaveLength(10);
    expect(new Set(names).size).toBe(10);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("changes nothing when the save fails", async () => {
    mockCommands({
      save_dynamic_wall: () => {
        throw "The settings could not be saved: disk full";
      },
    });
    const { onDynamicSaved, onClose } = page({ dynamicWall: true, dynamic: { heroSlots: [], priorityCameras: ["garage"] } });
    expect(screen.getByRole("checkbox", { name: "Garage" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Garage" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(onDynamicSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says heroes need two cameras", () => {
    page({ cameras: ["maingate"] });
    expect(screen.getByText(/Heroes need at least two cameras/)).toBeInTheDocument();
    expect(tiles()).toHaveLength(1);
  });

  it("asks for Frigate before offering hero slots", () => {
    page({ server: null, cameras: [] });
    expect(screen.getByText(/Connect to Frigate to choose hero slots/)).toBeInTheDocument();
    expect(screen.queryByLabelText("First hero slot")).not.toBeInTheDocument();
  });
});
