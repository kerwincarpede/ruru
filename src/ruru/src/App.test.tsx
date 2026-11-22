import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { emit } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { Camera } from "./app/frigate";
import type { SavedLayout, Settings } from "./app/settings";
import { findUpdate } from "./app/updates";
import { mockCommands, type CommandHandlers } from "./test/mockCommands";

vi.mock("./app/updates", () => ({ findUpdate: vi.fn() }));

const findUpdateMock = vi.mocked(findUpdate);

const URL_SAVED = "http://frigate:5000";
const empty: Settings = { frigateUrl: null, fullScreen: false, layouts: {} };
const connected: Settings = { ...empty, frigateUrl: URL_SAVED };
const camera = (name: string): Camera => ({ name, enabled: true, mainStream: name, subStream: `${name}_sub` });
const cameras = [camera("maingate"), camera("garage")];

function backend(handlers: CommandHandlers = {}) {
  return mockCommands({
    app_info: () => ({ name: "Ruru", version: "0.1.0" }),
    get_settings: () => empty,
    ...handlers,
  });
}

function wall(handlers: CommandHandlers = {}) {
  return backend({
    get_settings: () => connected,
    frigate_cameras: () => cameras,
    save_layout: () => null,
    set_full_screen: () => null,
    ...handlers,
  });
}

describe("App", () => {
  beforeEach(() => {
    findUpdateMock.mockReset().mockResolvedValue(null);
  });

  it("asks to connect to Frigate when no server is saved", async () => {
    backend();
    render(<App />);
    expect(await screen.findByRole("button", { name: "Connect to Frigate" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ruru" })).toBeInTheDocument();
    expect(screen.getByText("Eyes on every camera")).toBeInTheDocument();
  });

  it("shows the name and version from app_info in the footer", async () => {
    const calls = backend({ app_info: () => ({ name: "Ruru", version: "1.2.3" }) });
    render(<App />);
    const footer = screen.getByRole("contentinfo", { name: "About Ruru" });
    await waitFor(() => expect(footer).toHaveTextContent("Ruru 1.2.3"));
    expect(calls.map((call) => call.cmd)).toContain("app_info");
  });

  it("leaves the footer empty when app_info fails", async () => {
    const calls = backend({
      app_info: () => {
        throw new Error("backend unavailable");
      },
      get_settings: () => {
        throw new Error("backend unavailable");
      },
    });
    render(<App />);
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(screen.getByRole("contentinfo", { name: "About Ruru" })).toBeEmptyDOMElement();
    expect(await screen.findByRole("button", { name: "Connect to Frigate" })).toBeInTheDocument();
  });

  it("checks for an update once at startup and shows no prompt without one", async () => {
    backend();
    render(<App />);
    await waitFor(() => expect(findUpdateMock).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers the update it finds, and Not now puts the prompt away", async () => {
    backend();
    const install = vi.fn().mockResolvedValue(undefined);
    findUpdateMock.mockResolvedValue({ version: "0.2.0", install });
    render(<App />);
    expect(await screen.findByRole("dialog", { name: "Ruru 0.2.0 is ready. Install and restart?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(install).not.toHaveBeenCalled();
  });

  it("installs the update it finds when asked", async () => {
    backend();
    const install = vi.fn().mockResolvedValue(undefined);
    findUpdateMock.mockResolvedValue({ version: "0.2.0", install });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Install and restart" }));
    expect(install).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("connects to Frigate from the empty state and shows its cameras", async () => {
    const calls = backend({ save_frigate_url: () => connected, frigate_cameras: () => cameras });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect to Frigate" }));
    fireEvent.change(screen.getByLabelText("Frigate URL"), { target: { value: URL_SAVED } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("figure", { name: "Maingate" })).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: "Garage" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls).toContainEqual({ cmd: "frigate_cameras", payload: { url: URL_SAVED } });
  });

  it("opens Settings from the gear, the shortcut and the app menu", async () => {
    backend();
    render(<App />);
    await screen.findByRole("button", { name: "Connect to Frigate" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await act(() => emit("open-settings"));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  });

  it("hides the toolbar when the pointer rests and shows it when it moves", async () => {
    vi.useFakeTimers();
    try {
      wall();
      render(<App />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const toolbar = screen.getByRole("toolbar", { name: "Wall" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(toolbar).not.toHaveClass("is-shown");
      fireEvent.pointerMove(screen.getByRole("main"));
      expect(toolbar).toHaveClass("is-shown");
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the right-click menu and toggles full screen from it and with F11", async () => {
    const calls = wall();
    render(<App />);
    await screen.findByRole("figure", { name: "Garage" });
    fireEvent.contextMenu(screen.getByRole("main"), { clientX: 10, clientY: 10 });
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Settings…",
      "Edit layout",
      "Enter full screen",
    ]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Enter full screen" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "F11" });
    await waitFor(() =>
      expect(calls.filter((call) => call.cmd === "set_full_screen").map((call) => call.payload)).toEqual([
        { fullScreen: true },
        { fullScreen: false },
      ]),
    );

    fireEvent.contextMenu(screen.getByRole("main"), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings…" }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  });

  it("closes the right-click menu on Escape or a click elsewhere", async () => {
    wall();
    render(<App />);
    await screen.findByRole("figure", { name: "Garage" });
    fireEvent.contextMenu(screen.getByRole("main"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole("main"));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("shows each camera's snapshot and rediscovers cameras when the window regains focus", async () => {
    const calls = wall();
    render(<App />);
    const tile = await screen.findByRole("figure", { name: "Maingate" });
    expect(tile.querySelector("img")?.getAttribute("src")).toMatch(/^http:\/\/frigate:5000\/api\/maingate\/latest\.webp/);
    fireEvent.focus(window);
    await waitFor(() => expect(calls.filter((call) => call.cmd === "frigate_cameras")).toHaveLength(2));
  });

  it("says why cameras could not be found", async () => {
    wall({
      frigate_cameras: () => {
        throw "Could not reach Frigate at http://frigate:5000: timed out";
      },
    });
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach Frigate");
  });

  it("says when Frigate has no cameras", async () => {
    wall({ frigate_cameras: () => [] });
    render(<App />);
    expect(await screen.findByText("Frigate has no cameras yet.")).toBeInTheDocument();
  });

  it("maximises a double-clicked tile until Escape", async () => {
    wall();
    render(<App />);
    fireEvent.doubleClick(await screen.findByRole("figure", { name: "Garage" }));
    expect(screen.getAllByRole("figure", { name: "Garage" })).toHaveLength(2);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getAllByRole("figure", { name: "Garage" })).toHaveLength(1);
  });

  it("hides a tile, shows it again and resets the layout in Edit layout mode", async () => {
    const saved: SavedLayout[] = [];
    wall({
      save_layout: ({ layout }) => {
        saved.push(layout);
        return null;
      },
    });
    render(<App />);
    await screen.findByRole("figure", { name: "Garage" });
    fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));

    fireEvent.click(screen.getByRole("button", { name: "Hide Garage" }));
    expect(screen.queryByRole("figure", { name: "Garage" })).not.toBeInTheDocument();
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].hidden).toEqual(["garage"]);
    expect(saved[0].tiles.map((tile) => tile.camera)).toEqual(["maingate"]);

    fireEvent.click(screen.getByRole("button", { name: "Show Garage" }));
    expect(await screen.findByRole("figure", { name: "Garage" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reset to Frigate order" }));
    await waitFor(() => expect(saved[saved.length - 1]).toEqual({ tiles: [], hidden: [] }));

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("button", { name: "Hide Garage" })).not.toBeInTheDocument();
  });

  it("uses the layout saved for the server", async () => {
    wall({
      get_settings: () => ({
        ...connected,
        layouts: { [URL_SAVED]: { tiles: [{ camera: "garage", x: 0, y: 0, w: 6, h: 6 }], hidden: ["maingate"] } },
      }),
    });
    render(<App />);
    expect(await screen.findByRole("figure", { name: "Garage" })).toBeInTheDocument();
    expect(screen.queryByRole("figure", { name: "Maingate" })).not.toBeInTheDocument();
  });
});
