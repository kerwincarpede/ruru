import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Mirrors `TilePlacement` in src-tauri/src/settings.rs: a tile's place on the grid, in grid units. */
export interface TilePlacement {
  camera: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Mirrors `SavedLayout` in src-tauri/src/settings.rs: one server's wall. */
export interface SavedLayout {
  tiles: TilePlacement[];
  hidden: string[];
}

/** Mirrors `Settings` in src-tauri/src/settings.rs. */
export interface Settings {
  frigateUrl: string | null;
  fullScreen: boolean;
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
