import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Camera, FrigateStatus } from "./frigate";

/** Mirrors `AppInfo` in src-tauri/src/lib.rs. */
export interface AppInfo {
  name: string;
  version: string;
}

/** The app's name and version, as the Rust backend was built with them. */
export function appInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("app_info");
}

/** Mirrors `TilePlacement` in src-tauri/src/settings.rs: a tile's place on the grid, in grid units. */
export interface TilePlacement {
  camera: string;
  x: number;
  y: number;
  w: number;
  h: number;
  stream?: "main" | "sub";
}

/** Mirrors `SavedLayout` in src-tauri/src/settings.rs: one server's wall. */
export interface SavedLayout {
  tiles: TilePlacement[];
  hidden: string[];
}

/** Mirrors `WallOptions` in src-tauri/src/settings.rs: how the wall is drawn. */
export interface WallOptions {
  lockRatio: boolean;
  fitToWindow: boolean;
  streamInfo: boolean;
}

/** The wall options before any are saved, as Rust defaults them. */
export const DEFAULT_WALL_OPTIONS: WallOptions = { lockRatio: true, fitToWindow: true, streamInfo: false };

/** Mirrors `Settings` in src-tauri/src/settings.rs. */
export interface Settings {
  frigateUrl: string | null;
  fullScreen: boolean;
  wall: WallOptions;
  layouts: Record<string, SavedLayout>;
}

/** The saved settings, or the defaults when none are saved. */
export function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

/** Saves the Frigate URL, cleaned up by the backend, and returns the new settings. */
export function saveFrigateUrl(url: string): Promise<Settings> {
  return invoke<Settings>("save_frigate_url", { url });
}

/** Turns full screen on or off and remembers it for the next launch. */
export function setFullScreen(fullScreen: boolean): Promise<void> {
  return invoke<void>("set_full_screen", { fullScreen });
}

/** Saves the wall's layout for one Frigate server. */
export function saveLayout(server: string, layout: SavedLayout): Promise<void> {
  return invoke<void>("save_layout", { server, layout });
}

/** Saves how the wall is drawn: Lock to 16:9, Fit to window and stream info. */
export function saveWallOptions(options: WallOptions): Promise<void> {
  return invoke<void>("save_wall_options", { options });
}

/**
 * Calls `handler` with the window's new state whenever it enters or leaves
 * full screen, by Ruru's toggle or any other way. Resolves to a function
 * that stops listening; a backend without events gives a no-op.
 */
export async function onFullScreenChanged(handler: (fullScreen: boolean) => void): Promise<() => void> {
  try {
    return await listen<boolean>("full-screen-changed", (event) => handler(event.payload));
  } catch {
    return () => {};
  }
}

/**
 * Calls `handler` when the macOS app menu's Settings item is chosen. Resolves
 * to a function that stops listening; a backend without events gives a no-op.
 */
export async function onOpenSettings(handler: () => void): Promise<() => void> {
  try {
    return await listen("open-settings", handler);
  } catch {
    return () => {};
  }
}

/** Asks the Frigate server at `url` for its version and camera count. */
export function testFrigate(url: string): Promise<FrigateStatus> {
  return invoke<FrigateStatus>("test_frigate", { url });
}

/** The cameras on the Frigate server at `url`, in Frigate's order. */
export function frigateCameras(url: string): Promise<Camera[]> {
  return invoke<Camera[]>("frigate_cameras", { url });
}
