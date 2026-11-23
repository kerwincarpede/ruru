import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach } from "vitest";
import { emit } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App, { CONNECTING_MS } from "./App";
import { RETRY_DELAYS_MS, type Camera } from "./app/frigate";
import { DEFAULT_MQTT_SETTINGS, DEFAULT_WALL_OPTIONS, type Activity, type SavedLayout, type Settings } from "./app/api";
import { findUpdate } from "./app/updates";
import { mockCommands, type CommandHandlers } from "./test/mockCommands";
import { forgetFailures } from "./wall/player";

// Only the startup check is faked; Settings › Updates checks through the mocked commands.
vi.mock("./app/updates", async (importOriginal) => ({ ...(await importOriginal<typeof import("./app/updates")>()), findUpdate: vi.fn() }));

const findUpdateMock = vi.mocked(findUpdate);

const URL_SAVED = "http://frigate:5000";
const empty: Settings = { frigateUrl: null, fullScreen: false, wall: DEFAULT_WALL_OPTIONS, updateChannel: "stable", autoUpdate: false, mqtt: DEFAULT_MQTT_SETTINGS, layouts: {} };
const connected: Settings = { ...empty, frigateUrl: URL_SAVED };
const camera = (name: string): Camera => ({ name, enabled: true, mainStream: name, subStream: `${name}_sub` });
const cameras = [camera("maingate"), camera("garage")];

function backend(handlers: CommandHandlers = {}) {
  return mockCommands({
    app_info: () => ({ name: "Ruru", version: "0.1.0" }),
    get_settings: () => empty,
    camera_activity: () => ({}),
    ...handlers,
  });
}

function wall(handlers: CommandHandlers = {}) {
  return backend({
    get_settings: () => connected,
    frigate_cameras: () => cameras,
    save_layout: () => null,
    save_wall_options: () => null,
    set_full_screen: () => null,
    report_wall_state: () => null,
    report_tile_problem: () => null,
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

  it("says Edge by the version in the footer on the Edge channel", async () => {
    backend({ app_info: () => ({ name: "Ruru", version: "1.2.3" }), get_settings: () => ({ ...empty, updateChannel: "edge" }) });
    render(<App />);
    const footer = screen.getByRole("contentinfo", { name: "About Ruru" });
    await waitFor(() => expect(footer).toHaveTextContent("Ruru 1.2.3 · Edge"));
  });

  it("shows the version and channel in Edit layout", async () => {
    wall({ app_info: () => ({ name: "Ruru", version: "1.2.3" }), get_settings: () => ({ ...connected, updateChannel: "edge" }) });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit layout" }));
    expect(within(screen.getByRole("toolbar", { name: "Wall" })).getByText("Ruru 1.2.3 · Edge")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("Ruru 1.2.3 · Edge")).not.toBeInTheDocument();
  });

  it("switching channel in Settings forgets the update the old channel offered", async () => {
    const calls = backend({
      set_update_channel: ({ channel }) => ({ ...empty, updateChannel: channel }),
      fake_update: () => null,
      check_update: () => null,
    });
    findUpdateMock.mockResolvedValue({ version: "0.2.0", install: vi.fn() });
    render(<App />);
    expect(await screen.findByRole("dialog", { name: "Ruru 0.2.0 is ready. Install and restart?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect to Frigate" }));
    fireEvent.click(screen.getByRole("button", { name: "Updates" }));
    fireEvent.change(screen.getByLabelText("Update channel"), { target: { value: "edge" } });
    expect(await screen.findByText("Ruru is up to date.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("contentinfo", { name: "About Ruru" })).toHaveTextContent("Ruru 0.1.0 · Edge");
    expect(calls).toContainEqual({ cmd: "set_update_channel", payload: { channel: "edge" } });
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

  it("leaves the startup check to the backend when updates install automatically", async () => {
    backend({ get_settings: () => ({ ...empty, autoUpdate: true }) });
    render(<App />);
    expect(await screen.findByRole("button", { name: "Connect to Frigate" })).toBeInTheDocument();
    expect(findUpdateMock).not.toHaveBeenCalled();
  });

  it("says when an automatic update installs, in place of the prompt", async () => {
    backend();
    findUpdateMock.mockResolvedValue({ version: "0.2.0", install: vi.fn() });
    render(<App />);
    expect(await screen.findByRole("dialog", { name: "Ruru 0.2.0 is ready. Install and restart?" })).toBeInTheDocument();
    await act(() => emit("auto-update", { state: "installing", version: "0.2.0" }));
    expect(screen.getByRole("status")).toHaveTextContent("Installing Ruru 0.2.0.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("puts away the notice of a failed automatic update", async () => {
    backend();
    render(<App />);
    await waitFor(() => expect(findUpdateMock).toHaveBeenCalledOnce());
    await act(() => emit("auto-update", { state: "failed", version: "0.2.0", message: "bad signature" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Ruru 0.2.0 could not be installed.");
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("turning on automatic updates in Settings puts away the startup prompt", async () => {
    const calls = backend({ set_auto_update: ({ enabled }) => ({ ...empty, autoUpdate: enabled }) });
    findUpdateMock.mockResolvedValue({ version: "0.2.0", install: vi.fn() });
    render(<App />);
    expect(await screen.findByRole("dialog", { name: "Ruru 0.2.0 is ready. Install and restart?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect to Frigate" }));
    fireEvent.click(screen.getByRole("button", { name: "Updates" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Install updates automatically" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Install updates automatically" })).toBeChecked());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls).toContainEqual({ cmd: "set_auto_update", payload: { enabled: true } });
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
      "Stop streams",
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

  it("remembers a camera's stream choice without changing its neighbour", async () => {
    const calls = wall();
    render(<App />);
    const garage = await screen.findByRole("figure", { name: "Garage" });
    fireEvent.contextMenu(garage);
    expect(screen.getByRole("menuitemradio", { name: "Automatic (Sub)" })).toBeChecked();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Main stream" }));
    await waitFor(() => expect(calls).toContainEqual({ cmd: "save_layout", payload: {
      server: URL_SAVED, layout: { tiles: [expect.objectContaining({ camera: "maingate" }), expect.objectContaining({ camera: "garage", stream: "main" })], hidden: [] },
    } }));
    fireEvent.contextMenu(garage);
    expect(screen.getByRole("menuitemradio", { name: "Main stream" })).toBeChecked();
    fireEvent.contextMenu(screen.getByRole("figure", { name: "Maingate" }));
    expect(screen.getByRole("menuitemradio", { name: "Automatic (Sub)" })).toBeChecked();
  });

  it("heads a tile's menu with its camera, then its actions, then the wall's", async () => {
    wall();
    render(<App />);
    fireEvent.contextMenu(await screen.findByRole("figure", { name: "Garage" }));
    const menu = screen.getByRole("menu", { name: "Garage" });
    expect(within(menu).getAllByRole("group").map((group) => Array.from(group.querySelectorAll("button"), (item) => item.textContent))).toEqual([
      ["Maximise", "Reconnect", "Hide", "Show stream info"],
      ["Automatic (Sub)", "Main stream", "Sub stream"],
      ["Settings…", "Edit layout", "Stop streams", "Fit to window", "Enter full screen"],
    ]);
    expect(within(menu).getByRole("group", { name: "Stream" })).toBeInTheDocument();
    expect(within(menu).getByRole("group", { name: "Garage" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Maximise" }));
    expect(screen.getByRole("figure", { name: "Garage" })).toHaveClass("is-maximised");
    fireEvent.contextMenu(screen.getByRole("figure", { name: "Garage" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Restore" }));
    expect(screen.getByRole("figure", { name: "Garage" })).not.toHaveClass("is-maximised");
  });

  it("hides a camera from its right-click menu, restoring it if maximised", async () => {
    const calls = wall();
    render(<App />);
    const garage = await screen.findByRole("figure", { name: "Garage" });
    fireEvent.doubleClick(garage);
    fireEvent.contextMenu(garage);
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide" }));
    expect(screen.queryByRole("figure", { name: "Garage" })).not.toBeInTheDocument();
    await waitFor(() => expect(calls).toContainEqual({ cmd: "save_layout", payload: {
      server: URL_SAVED, layout: { tiles: [expect.objectContaining({ camera: "maingate" })], hidden: ["garage"] },
    } }));
    fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));
    fireEvent.click(screen.getByRole("button", { name: "Show Garage" }));
    expect(await screen.findByRole("figure", { name: "Garage" })).not.toHaveClass("is-maximised");
  });

  it("shows stream info on every tile from the menu at any time, and saves the wall options", async () => {
    const calls = wall({ get_settings: () => ({ ...connected, wall: { ...DEFAULT_WALL_OPTIONS, lockRatio: false, fitToWindow: true, streamInfo: false, activity: true } }) });
    render(<App />);
    fireEvent.contextMenu(await screen.findByRole("figure", { name: "Garage" }));
    expect(screen.queryByRole("complementary", { name: "Stream info" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: "Show stream info" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Show stream info" }));
    expect(screen.getAllByRole("complementary", { name: "Stream info" })).toHaveLength(2);
    fireEvent.contextMenu(screen.getByRole("main"));
    expect(screen.getByRole("menuitemcheckbox", { name: "Fit to window" })).toBeChecked();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Fit to window" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));
    // The saved lock shows in Edit layout, and changing it is saved too.
    expect(screen.getByRole("checkbox", { name: "Lock to 16:9" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Fit to window" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Lock to 16:9" }));
    await waitFor(() => expect(calls.filter((call) => call.cmd === "save_wall_options").map((call) => call.payload)).toEqual([
      { options: { lockRatio: false, fitToWindow: true, streamInfo: true, activity: true, activityStyle: "ring" } },
      { options: { lockRatio: false, fitToWindow: false, streamInfo: true, activity: true, activityStyle: "ring" } },
      { options: { lockRatio: true, fitToWindow: false, streamInfo: true, activity: true, activityStyle: "ring" } },
    ]));
  });

  it("draws Frigate's activity on the tiles as it changes", async () => {
    wall({ camera_activity: () => ({ maingate: { motion: true, objects: {}, review: "none" } }) });
    render(<App />);
    const maingate = await screen.findByRole("figure", { name: "Maingate" });
    const garage = screen.getByRole("figure", { name: "Garage" });
    await waitFor(() => expect(maingate).toHaveClass("has-motion"));
    expect(garage).not.toHaveClass("has-motion");
    await act(() => emit("camera-activity", { garage: { motion: true, objects: { car: 2, person: 1 }, review: "alert" } }));
    expect(garage).toHaveClass("has-motion", "is-alert");
    // The default style draws in the gap around the tile, so its cell knows too.
    expect(garage.parentElement).toHaveClass("wall-cell", "has-motion", "is-alert");
    expect(garage.closest(".wall")).toHaveClass("activity-ring");
    expect(within(garage).getByRole("list", { name: "Objects in view" })).toHaveTextContent("Car ×2Person");
    expect(within(garage).getByText("· Alert")).toBeInTheDocument();
    // Each event holds every camera's activity, so the maingate is quiet now.
    expect(maingate).not.toHaveClass("has-motion");
    await act(() => emit("camera-activity", {}));
    expect(garage).not.toHaveClass("has-motion");
    expect(within(garage).queryByRole("list", { name: "Objects in view" })).not.toBeInTheDocument();
  });

  it("keeps an activity event that arrives before the answer to camera_activity", async () => {
    let answer: (activity: Activity) => void = () => {};
    wall({ camera_activity: () => new Promise<Activity>((resolve) => (answer = resolve)) });
    render(<App />);
    const garage = await screen.findByRole("figure", { name: "Garage" });
    await act(() => emit("camera-activity", {}));
    await act(async () => answer({ garage: { motion: true, objects: {}, review: "alert" } }));
    expect(garage).not.toHaveClass("is-alert");
    expect(garage).not.toHaveClass("has-motion");
  });

  it("offers Show activity while Home Assistant is on, and hides the activity when it is off", async () => {
    const on: Settings = { ...connected, mqtt: { ...DEFAULT_MQTT_SETTINGS, enabled: true, host: "ha.local" } };
    const calls = wall({
      get_settings: () => on,
      camera_activity: () => ({ garage: { motion: true, objects: { person: 1 }, review: "detection" } }),
    });
    render(<App />);
    const garage = await screen.findByRole("figure", { name: "Garage" });
    await waitFor(() => expect(within(garage).getByText("Person")).toBeInTheDocument());
    fireEvent.contextMenu(garage);
    const option = screen.getByRole("menuitemcheckbox", { name: "Show activity" });
    expect(option).toBeChecked();
    fireEvent.click(option);
    expect(garage).not.toHaveClass("has-motion");
    expect(within(garage).queryByText("Person")).not.toBeInTheDocument();
    await waitFor(() => expect(calls).toContainEqual({ cmd: "save_wall_options", payload: { options: { ...DEFAULT_WALL_OPTIONS, activity: false } } }));
    fireEvent.contextMenu(garage);
    expect(screen.getByRole("menuitemcheckbox", { name: "Show activity" })).not.toBeChecked();
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

  it("shows that it is connecting to Frigate until Frigate answers", async () => {
    let answer: (found: Camera[]) => void = () => {};
    wall({ frigate_cameras: () => new Promise<Camera[]>((resolve) => (answer = resolve)) });
    render(<App />);
    const status = await screen.findByRole("status", { name: "Looking for cameras" });
    expect(status).toHaveTextContent("Asking Frigate at http://frigate:5000");
    await act(async () => answer(cameras));
    expect(await screen.findByRole("figure", { name: "Garage" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Looking for cameras" })).not.toBeInTheDocument();
  });

  it("says why cameras could not be found and keeps trying on a backoff until Frigate answers", async () => {
    vi.useFakeTimers();
    try {
      let failing = 2;
      const calls = wall({
        frigate_cameras: () => {
          if (failing > 0) {
            failing -= 1;
            throw "Could not reach Frigate at http://frigate:5000: timed out";
          }
          return cameras;
        },
      });
      const attempts = () => calls.filter((call) => call.cmd === "frigate_cameras").length;
      const advance = (ms: number) =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(ms);
        });
      render(<App />);
      await advance(0);
      const status = screen.getByRole("status", { name: "Ruru can't reach Frigate" });
      expect(status).toHaveTextContent("Nothing answered at http://frigate:5000.");
      expect(status).toHaveTextContent("Could not reach Frigate at http://frigate:5000: timed out");
      expect(attempts()).toBe(1);
      // No focus event: the retries come on their own, 2 s then 5 s apart.
      await advance(RETRY_DELAYS_MS[0] - 1);
      expect(attempts()).toBe(1);
      await advance(1);
      expect(attempts()).toBe(2);
      await advance(RETRY_DELAYS_MS[1] - 1);
      expect(attempts()).toBe(2);
      await advance(1);
      expect(attempts()).toBe(3);
      expect(screen.getByRole("figure", { name: "Garage" })).toBeInTheDocument();
      expect(screen.queryByRole("status", { name: "Ruru can't reach Frigate" })).not.toBeInTheDocument();
      // Once found, Ruru stops asking until the window comes back into focus.
      await advance(RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0) * 2);
      expect(attempts()).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits longer after each failure, then every 30 seconds", async () => {
    vi.useFakeTimers();
    try {
      const calls = wall({
        frigate_cameras: () => {
          throw "Waiting for Frigate…";
        },
      });
      const attempts = () => calls.filter((call) => call.cmd === "frigate_cameras").length;
      const advance = (ms: number) =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(ms);
        });
      render(<App />);
      await advance(0);
      expect(screen.getByRole("status", { name: "Waiting for Frigate…" })).toBeInTheDocument();
      for (const [index, delay] of [2_000, 5_000, 10_000, 30_000, 30_000, 30_000].entries()) {
        await advance(delay - 1);
        expect(attempts()).toBe(index + 1);
        await advance(1);
        expect(attempts()).toBe(index + 2);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("tries again or opens Settings from the can't-reach screen", async () => {
    let reachable = false;
    wall({
      frigate_cameras: () => {
        if (!reachable) throw "timed out";
        return cameras;
      },
    });
    render(<App />);
    const status = await screen.findByRole("status", { name: "Ruru can't reach Frigate" });
    fireEvent.click(within(status).getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    reachable = true;
    fireEvent.click(within(status).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("figure", { name: "Garage" })).toBeInTheDocument();
  });

  it("still says why cameras could not be found once the wall is up", async () => {
    let reachable = true;
    wall({
      frigate_cameras: () => {
        if (!reachable) throw "Could not reach Frigate at http://frigate:5000: timed out";
        return cameras;
      },
    });
    render(<App />);
    await screen.findByRole("figure", { name: "Garage" });
    reachable = false;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach Frigate");
    expect(screen.getByRole("figure", { name: "Garage" })).toBeInTheDocument();
  });

  it("restarts the backoff for a newly saved server and stops retrying the old one", async () => {
    vi.useFakeTimers();
    try {
      const other = "http://other:5000";
      const calls = wall({
        frigate_cameras: () => {
          throw "Waiting for Frigate…";
        },
        save_frigate_url: () => ({ ...connected, frigateUrl: other }),
      });
      const attemptsAt = (server: string) => calls.filter((call) => call.cmd === "frigate_cameras" && (call.payload as { url?: string } | undefined)?.url === server).length;
      const advance = (ms: number) =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(ms);
        });
      render(<App />);
      await advance(0);
      // Past the 10 s step, so the old server would next wait 30 s.
      for (const delay of RETRY_DELAYS_MS.slice(0, 3)) await advance(delay);
      expect(attemptsAt(URL_SAVED)).toBe(4);
      fireEvent.keyDown(window, { key: ",", ctrlKey: true });
      fireEvent.change(screen.getByLabelText("Frigate URL"), { target: { value: other } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await advance(0);
      expect(attemptsAt(other)).toBe(1);
      await advance(RETRY_DELAYS_MS[0] - 1);
      expect(attemptsAt(other)).toBe(1);
      await advance(1);
      expect(attemptsAt(other)).toBe(2);
      await advance(RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] * 2);
      expect(attemptsAt(URL_SAVED)).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a failed discovery once the wall is up and clears the error when Frigate answers", async () => {
    vi.useFakeTimers();
    try {
      let reachable = true;
      const calls = wall({
        frigate_cameras: () => {
          if (!reachable) throw "Waiting for Frigate…";
          return cameras;
        },
      });
      const attempts = () => calls.filter((call) => call.cmd === "frigate_cameras").length;
      const advance = (ms: number) =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(ms);
        });
      render(<App />);
      await advance(0);
      expect(screen.getByRole("figure", { name: "Garage" })).toBeInTheDocument();
      reachable = false;
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await advance(0);
      expect(screen.getByRole("alert")).toHaveTextContent("Waiting for Frigate…");
      const failed = attempts();
      reachable = true;
      await advance(RETRY_DELAYS_MS[0]);
      expect(attempts()).toBe(failed + 1);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      await advance(RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] * 2);
      expect(attempts()).toBe(failed + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says when Frigate has no cameras", async () => {
    wall({ frigate_cameras: () => [] });
    render(<App />);
    expect(await screen.findByRole("status", { name: "Frigate has no cameras yet" })).toBeInTheDocument();
  });

  it("says every camera is hidden, and shows them all again", async () => {
    const calls = wall({ get_settings: () => ({ ...connected, layouts: { [URL_SAVED]: { tiles: [], hidden: ["maingate", "garage"] } } }) });
    render(<App />);
    const status = await screen.findByRole("status", { name: "Every camera is hidden" });
    expect(status).toHaveTextContent("You hid all 2 cameras in Edit layout.");
    fireEvent.click(within(status).getByRole("button", { name: "Edit layout" }));
    expect(screen.queryByRole("status", { name: "Every camera is hidden" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Show all cameras" }));
    expect(await screen.findByRole("figure", { name: "Garage" })).toBeInTheDocument();
    const saved = calls.filter((call) => call.cmd === "save_layout").map((call) => (call.payload as { layout: SavedLayout }).layout);
    expect(saved[saved.length - 1]).toEqual({ tiles: [], hidden: [] });
  });

  it("maximises a double-clicked tile until Escape", async () => {
    wall();
    render(<App />);
    const garage = await screen.findByRole("figure", { name: "Garage" });
    fireEvent.doubleClick(garage);
    expect(garage).toHaveClass("is-maximised");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(garage).not.toHaveClass("is-maximised");
    fireEvent.doubleClick(garage);
    fireEvent.doubleClick(garage);
    expect(garage).not.toHaveClass("is-maximised");
  });

  it("hides a tile, shows it again and resets the layout in Edit layout mode", async () => {
    const saved: SavedLayout[] = [];
    wall({
      save_layout: ({ server, layout }) => {
        // Layouts are kept per server.
        expect(server).toBe(URL_SAVED);
        saved.push(layout);
        return null;
      },
    });
    render(<App />);
    await screen.findByRole("figure", { name: "Garage" });
    fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));
    // Edit layout gives the toolbar its own row, clear of the tiles' Hide buttons.
    expect(screen.getByRole("main")).toHaveClass("is-editing");

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

  it("ignores a discovery for the old server that settles after Save", async () => {
    let finishOld: (cameras: Camera[]) => void = () => {};
    const other = "http://other:5000";
    backendCalls = wall({
      frigate_cameras: ({ url }) =>
        url === URL_SAVED ? new Promise<Camera[]>((resolve) => (finishOld = resolve)) : [camera("porch")],
      save_frigate_url: () => ({ ...connected, frigateUrl: other }),
    });
    render(<App />);
    await waitFor(() => expect(backendCalls.some((call) => call.cmd === "frigate_cameras")).toBe(true));
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    fireEvent.change(screen.getByLabelText("Frigate URL"), { target: { value: other } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("figure", { name: "Porch" })).toBeInTheDocument();
    await act(async () => finishOld(cameras));
    expect(screen.queryByRole("figure", { name: "Garage" })).not.toBeInTheDocument();
    expect(screen.getByRole("figure", { name: "Porch" })).toBeInTheDocument();
  });

  it("keeps the webview's own menu for right-clicks inside a dialog", async () => {
    wall();
    render(<App />);
    await screen.findByRole("figure", { name: "Garage" });
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    const field = screen.getByLabelText("Frigate URL");
    expect(fireEvent.contextMenu(field)).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("follows full screen when it changes outside Ruru's toggle", async () => {
    const calls = wall();
    render(<App />);
    await screen.findByRole("figure", { name: "Garage" });
    await act(() => emit("full-screen-changed", true));
    fireEvent.contextMenu(screen.getByRole("main"));
    expect(screen.getByRole("menuitem", { name: "Exit full screen" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Exit full screen" }));
    await waitFor(() =>
      expect(calls.filter((call) => call.cmd === "set_full_screen").map((call) => call.payload)).toEqual([
        { fullScreen: false },
      ]),
    );
  });
});

/** A WebSocket stand-in that records the stream each tile asks go2rtc for. */
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send() {}
  close() {
    this.closed = true;
  }
  static open(): string[] {
    return FakeSocket.all.filter((socket) => !socket.closed).map((socket) => new URL(socket.url).searchParams.get("src") ?? "");
  }
}

class FakePeer {
  connectionState = "new";
  addTransceiver() {}
  close() {}
}

let backendCalls: ReturnType<typeof mockCommands> = [];

describe("App streams", () => {
  beforeEach(() => {
    findUpdateMock.mockReset().mockResolvedValue(null);
    FakeSocket.all = [];
    // A test that waits out the connecting screen leaves failed streams behind.
    forgetFailures();
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("RTCPeerConnection", FakePeer);
    vi.stubGlobal("MediaStream", class {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  const setVisibility = (state: "hidden" | "visible") => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  };

  it("plays each tile's sub stream, and stops them while the window is hidden", async () => {
    wall();
    render(<App />);
    await screen.findByRole("figure", { name: "Garage" });
    expect(FakeSocket.open().sort()).toEqual(["garage_sub", "maingate_sub"]);
    setVisibility("hidden");
    expect(FakeSocket.open()).toEqual([]);
    setVisibility("visible");
    expect(FakeSocket.open().sort()).toEqual(["garage_sub", "maingate_sub"]);
  });

  it("plays the main stream when maximised and keeps the rest of the wall connected", async () => {
    wall();
    render(<App />);
    fireEvent.doubleClick(await screen.findByRole("figure", { name: "Garage" }));
    // The window is wide enough for Automatic to pick main.
    expect(FakeSocket.open().sort()).toEqual(["garage", "maingate_sub"]);
    const maingate = FakeSocket.all.filter((socket) => socket.url.includes("maingate_sub"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(FakeSocket.open().sort()).toEqual(["garage_sub", "maingate_sub"]);
    // Restoring did not reconnect the other tiles.
    expect(FakeSocket.all.filter((socket) => socket.url.includes("maingate_sub"))).toEqual(maingate);
    expect(maingate).toHaveLength(1);
  });

  it("tells Home Assistant the cameras on the wall, the maximised one, full screen and whether the window is shown", async () => {
    const calls = wall({ get_settings: () => ({ ...connected, layouts: { [URL_SAVED]: { tiles: [], hidden: ["garage"] } } }), frigate_cameras: () => [...cameras, camera("yard")] });
    render(<App />);
    const reports = () => calls.filter((call) => call.cmd === "report_wall_state").map((call) => (call.payload as { report: unknown }).report);
    const last = () => reports()[reports().length - 1];
    await waitFor(() => expect(reports()).toEqual([{ maximised: null, fullScreen: false, windowShown: true, streams: true, cameras: ["maingate", "yard"] }]));
    fireEvent.doubleClick(screen.getByRole("figure", { name: "Yard" }));
    await waitFor(() => expect(last()).toEqual({ maximised: "yard", fullScreen: false, windowShown: true, streams: true, cameras: ["maingate", "yard"] }));
    fireEvent.keyDown(window, { key: "F11" });
    await waitFor(() => expect(last()).toMatchObject({ fullScreen: true }));
    setVisibility("hidden");
    await waitFor(() => expect(last()).toMatchObject({ windowShown: false }));
    setVisibility("visible");
  });

  it("tells Home Assistant when a tile can't play its camera", async () => {
    const porch: Camera = { name: "porch", enabled: true, mainStream: "porch", subStream: "porch" };
    const calls = wall({ frigate_cameras: () => [porch] });
    render(<App />);
    await screen.findByRole("figure", { name: "Porch" });
    const video = () => {
      const element = document.querySelector<HTMLVideoElement>('video[data-stream="porch"]');
      if (!element) throw new Error("No video plays porch");
      Object.defineProperty(element, "error", { configurable: true, value: { code: 3 } });
      return element;
    };
    act(() => {
      video().dispatchEvent(new Event("error"));
    });
    // A decode failure after the first retry gives up on the stream.
    await waitFor(() => {
      act(() => {
        video().dispatchEvent(new Event("error"));
      });
      expect(screen.getByRole("figure", { name: "Porch" })).toHaveTextContent("Can't play this stream");
    }, { timeout: 3000 });
    await waitFor(() => expect(calls).toContainEqual({ cmd: "report_tile_problem", payload: { camera: "porch", problem: true } }));
  });

  it("maximises and restores tiles when Home Assistant asks", async () => {
    const calls = wall();
    render(<App />);
    await screen.findByRole("figure", { name: "Garage" });
    const reports = () => calls.filter((call) => call.cmd === "report_wall_state").map((call) => (call.payload as { report: { maximised: string | null } }).report);
    await act(() => emit("wall-command", { kind: "maximise", camera: "garage" }));
    expect(FakeSocket.open().sort()).toEqual(["garage", "maingate_sub"]);
    // Home Assistant hears the camera it maximised.
    await waitFor(() => expect(reports()[reports().length - 1].maximised).toBe("garage"));
    await act(() => emit("wall-command", { kind: "restore" }));
    expect(FakeSocket.open().sort()).toEqual(["garage_sub", "maingate_sub"]);
    await waitFor(() => expect(reports()[reports().length - 1].maximised).toBeNull());
  });

  it("turns full screen on and off when Home Assistant asks", async () => {
    const calls = wall();
    render(<App />);
    await screen.findByRole("figure", { name: "Garage" });
    const changes = () => calls.filter((call) => call.cmd === "set_full_screen").map((call) => call.payload);
    await act(() => emit("wall-command", { kind: "fullScreen", on: true }));
    await waitFor(() => expect(changes()).toEqual([{ fullScreen: true }]));
    // Asking for the state the window is already in changes nothing.
    await act(() => emit("wall-command", { kind: "fullScreen", on: true }));
    fireEvent.contextMenu(screen.getByRole("main"));
    expect(screen.getByRole("menuitem", { name: "Exit full screen" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await act(() => emit("wall-command", { kind: "fullScreen", on: false }));
    await waitFor(() => expect(changes()).toEqual([{ fullScreen: true }, { fullScreen: false }]));
  });

  it("stops and starts every stream when Home Assistant asks, and tells it so", async () => {
    const calls = wall();
    render(<App />);
    await screen.findByRole("figure", { name: "Garage" });
    const reports = () => calls.filter((call) => call.cmd === "report_wall_state").map((call) => (call.payload as { report: { streams: boolean } }).report);
    expect(FakeSocket.open().sort()).toEqual(["garage_sub", "maingate_sub"]);
    await act(() => emit("wall-command", { kind: "streams", on: false }));
    expect(FakeSocket.open()).toEqual([]);
    expect(screen.getByRole("status", { name: "Streams are off" })).toBeInTheDocument();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    await waitFor(() => expect(reports()[reports().length - 1].streams).toBe(false));
    await act(() => emit("wall-command", { kind: "streams", on: true }));
    expect(FakeSocket.open().sort()).toEqual(["garage_sub", "maingate_sub"]);
    expect(screen.queryByRole("status", { name: "Streams are off" })).not.toBeInTheDocument();
    await waitFor(() => expect(reports()[reports().length - 1].streams).toBe(true));
  });

  /** Makes the tile's video for `stream` start playing: jsdom never decodes. */
  const play = (stream: string) => {
    const video = document.querySelector<HTMLVideoElement>(`video[data-stream="${stream}"]`);
    if (!video) throw new Error(`No video plays ${stream}`);
    Object.defineProperty(video, "readyState", { configurable: true, value: 4 });
    act(() => {
      video.dispatchEvent(new Event("playing"));
    });
  };

  it("covers the wall while its cameras connect, and shows it once every tile plays", async () => {
    wall();
    render(<App />);
    await screen.findByRole("figure", { name: "Garage" });
    const connecting = () => screen.queryByRole("status", { name: "Connecting to your cameras" });
    expect(connecting()).toHaveTextContent("0 of 2 cameras connected");
    play("garage_sub");
    expect(connecting()).toHaveTextContent("1 of 2 cameras connected");
    expect(screen.getByRole("listitem", { name: "Garage: connected" })).toBeInTheDocument();
    play("maingate_sub");
    expect(connecting()).not.toBeInTheDocument();
  });

  it("shows the wall after a while even when a camera never connects", async () => {
    vi.useFakeTimers();
    try {
      wall();
      render(<App />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      play("garage_sub");
      expect(screen.getByRole("status", { name: "Connecting to your cameras" })).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CONNECTING_MS);
      });
      expect(screen.queryByRole("status", { name: "Connecting to your cameras" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops and starts every stream from the wall's menu", async () => {
    wall();
    render(<App />);
    await screen.findByRole("figure", { name: "Garage" });
    fireEvent.contextMenu(screen.getByRole("main"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Stop streams" }));
    expect(FakeSocket.open()).toEqual([]);
    fireEvent.contextMenu(screen.getByRole("main"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Start streams" }));
    expect(FakeSocket.open().sort()).toEqual(["garage_sub", "maingate_sub"]);
  });

  it("shows only how to start the streams while they are off, and starts them from there", async () => {
    wall();
    render(<App />);
    await screen.findByRole("figure", { name: "Garage" });
    fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));
    fireEvent.contextMenu(screen.getByRole("main"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Stop streams" }));
    // Editing stops with the streams, and nothing offers it until they start.
    expect(screen.queryByRole("button", { name: "Edit layout" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole("main"));
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /Edit layout|Done editing/ })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Start streams" }));
    expect(await screen.findByRole("figure", { name: "Garage" })).toBeInTheDocument();
    // The cameras connect again from scratch.
    expect(screen.getByRole("status", { name: "Connecting to your cameras" })).toHaveTextContent("0 of 2");
    expect(FakeSocket.open().sort()).toEqual(["garage_sub", "maingate_sub"]);
  });

  it("reconnects a tile from its right-click menu", async () => {
    wall();
    render(<App />);
    const garage = await screen.findByRole("figure", { name: "Garage" });
    fireEvent.contextMenu(garage);
    fireEvent.click(screen.getByRole("menuitem", { name: "Reconnect" }));
    expect(FakeSocket.all.filter((socket) => socket.url.includes("garage_sub")).map((socket) => socket.closed)).toEqual([true, false]);
    expect(FakeSocket.all.filter((socket) => socket.url.includes("maingate_sub"))).toHaveLength(1);
  });
});
