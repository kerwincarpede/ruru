import { emit } from "@tauri-apps/api/event";
import { clearMocks } from "@tauri-apps/api/mocks";
import { describe, expect, it, vi } from "vitest";
import { getSettings, onOpenSettings, saveFrigateUrl, saveLayout, setFullScreen, type Settings } from "./settings";
import { mockCommands } from "../test/mockCommands";

const settings: Settings = { frigateUrl: "http://f", fullScreen: false, layouts: {} };

describe("settings commands", () => {
  it("calls each command with camelCase arguments", async () => {
    const layout = { tiles: [{ camera: "a", x: 0, y: 0, w: 2, h: 2 }], hidden: [] };
    const calls = mockCommands({
      get_settings: () => settings,
      save_frigate_url: () => settings,
      set_full_screen: () => null,
      save_layout: () => null,
    });
    await expect(getSettings()).resolves.toEqual(settings);
    await expect(saveFrigateUrl(" http://f/ ")).resolves.toEqual(settings);
    await setFullScreen(true);
    await saveLayout("http://f", layout);
    expect(calls).toEqual([
      { cmd: "get_settings", payload: {} },
      { cmd: "save_frigate_url", payload: { url: " http://f/ " } },
      { cmd: "set_full_screen", payload: { fullScreen: true } },
      { cmd: "save_layout", payload: { server: "http://f", layout } },
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
