import { emit } from "@tauri-apps/api/event";
import { clearMocks } from "@tauri-apps/api/mocks";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MQTT_SETTINGS, DEFAULT_WALL_OPTIONS, appInfo, cameraActivity, getSettings, onCameraActivity, onOpenSettings, onWallCommand, saveFrigateUrl, saveLayout, saveWallOptions, setFullScreen, type Settings } from "./api";
import { mockCommands } from "../test/mockCommands";

describe("appInfo", () => {
  it("calls app_info and returns its answer", async () => {
    const calls = mockCommands({ app_info: () => ({ name: "Ruru", version: "0.1.0" }) });
    await expect(appInfo()).resolves.toEqual({ name: "Ruru", version: "0.1.0" });
    expect(calls.map((call) => call.cmd)).toEqual(["app_info"]);
  });
});

const settings: Settings = { frigateUrl: "http://f", fullScreen: false, wall: DEFAULT_WALL_OPTIONS, updateChannel: "stable", mqtt: DEFAULT_MQTT_SETTINGS, layouts: {} };

describe("settings commands", () => {
  it("calls each command with camelCase arguments", async () => {
    const layout = { tiles: [{ camera: "a", x: 0, y: 0, w: 2, h: 2 }], hidden: [] };
    const calls = mockCommands({
      get_settings: () => settings,
      save_frigate_url: () => settings,
      set_full_screen: () => null,
      save_layout: () => null,
      save_wall_options: () => null,
    });
    await expect(getSettings()).resolves.toEqual(settings);
    await expect(saveFrigateUrl(" http://f/ ")).resolves.toEqual(settings);
    await setFullScreen(true);
    await saveLayout("http://f", layout);
    await saveWallOptions({ lockRatio: false, fitToWindow: true, streamInfo: true, activity: false });
    expect(calls).toEqual([
      { cmd: "get_settings", payload: {} },
      { cmd: "save_frigate_url", payload: { url: " http://f/ " } },
      { cmd: "set_full_screen", payload: { fullScreen: true } },
      { cmd: "save_layout", payload: { server: "http://f", layout } },
      { cmd: "save_wall_options", payload: { options: { lockRatio: false, fitToWindow: true, streamInfo: true, activity: false } } },
    ]);
  });
});

describe("onOpenSettings", () => {
  it("calls the handler when the app menu asks for Settings", async () => {
    mockCommands({});
    const handler = vi.fn();
    const stop = await onOpenSettings(handler);
    await emit("open-settings");
    expect(handler).toHaveBeenCalledOnce();
    stop();
  });

  it("gives a no-op without a backend", async () => {
    clearMocks();
    const stop = await onOpenSettings(vi.fn());
    expect(() => stop()).not.toThrow();
  });
});
describe("camera activity", () => {
  const activity = { garage: { motion: true, objects: { person: 1 }, review: "alert" as const } };

  it("asks for the activity heard so far and hears each change", async () => {
    const calls = mockCommands({ camera_activity: () => activity });
    await expect(cameraActivity()).resolves.toEqual(activity);
    expect(calls.map((call) => call.cmd)).toEqual(["camera_activity"]);
    const handler = vi.fn();
    const stop = await onCameraActivity(handler);
    await emit("camera-activity", activity);
    expect(handler).toHaveBeenCalledWith(activity);
    stop();
  });

  it("gives a no-op without a backend", async () => {
    clearMocks();
    const stop = await onCameraActivity(vi.fn());
    expect(() => stop()).not.toThrow();
  });
});

describe("wall commands", () => {
  it("hears each command Home Assistant sends", async () => {
    mockCommands({});
    const handler = vi.fn();
    const stop = await onWallCommand(handler);
    await emit("wall-command", { kind: "maximise", camera: "garage" });
    expect(handler).toHaveBeenCalledWith({ kind: "maximise", camera: "garage" });
    stop();
  });

  it("gives a no-op without a backend", async () => {
    clearMocks();
    const stop = await onWallCommand(vi.fn());
    expect(() => stop()).not.toThrow();
  });
});
