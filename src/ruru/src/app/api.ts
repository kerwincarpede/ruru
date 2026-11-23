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
  /** Tiles show Frigate's motion, objects and alerts. */
  activity: boolean;
  /** How a tile marks motion and alerts. */
  activityStyle: ActivityStyle;
}

/** Mirrors `ActivityStyle` in src-tauri/src/settings.rs: how a tile marks motion and alerts. */
export type ActivityStyle = "ring" | "outline" | "corners" | "strip" | "caption";

/** The wall options before any are saved, as Rust defaults them. */
export const DEFAULT_WALL_OPTIONS: WallOptions = { lockRatio: true, fitToWindow: true, streamInfo: false, activity: true, activityStyle: "ring" };

/** Mirrors `UpdateChannel` in src-tauri/src/settings.rs: which releases Ruru updates to. */
export type UpdateChannel = "stable" | "edge";

/** Mirrors `PasswordStorage` in src-tauri/src/settings.rs: where the broker password is kept. */
export type PasswordStorage = "none" | "keychain" | "file";

/** Mirrors `MqttSettings` in src-tauri/src/settings.rs: the Home Assistant connection. The password never reaches the page. */
export interface MqttSettings {
  enabled: boolean;
  host: string;
  port: number;
  tls: boolean;
  username: string;
  discoveryPrefix: string;
  frigatePrefix: string;
  /** This install's id in MQTT topics; empty until the connection is first saved. */
  deviceId: string;
  passwordStorage: PasswordStorage;
}

/** The Home Assistant connection before any is saved, as Rust defaults it. */
export const DEFAULT_MQTT_SETTINGS: MqttSettings = {
  enabled: false,
  host: "",
  port: 1883,
  tls: false,
  username: "",
  discoveryPrefix: "homeassistant",
  frigatePrefix: "frigate",
  deviceId: "",
  passwordStorage: "none",
};

/** Mirrors `Settings` in src-tauri/src/settings.rs. */
export interface Settings {
  frigateUrl: string | null;
  fullScreen: boolean;
  wall: WallOptions;
  updateChannel: UpdateChannel;
  mqtt: MqttSettings;
  /** Updates install, and Ruru restarts on them, without asking. */
  autoUpdate: boolean;
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

/** Saves the update channel and returns the new settings. */
export function setUpdateChannel(channel: UpdateChannel): Promise<Settings> {
  return invoke<Settings>("set_update_channel", { channel });
}

/**
 * Saves whether updates install by themselves and returns the new settings.
 * Turning it on makes the backend check straight away.
 */
export function setAutoUpdate(enabled: boolean): Promise<Settings> {
  return invoke<Settings>("set_auto_update", { enabled });
}

/** Turns full screen on or off and remembers it for the next launch. */
export function setFullScreen(fullScreen: boolean): Promise<void> {
  return invoke<void>("set_full_screen", { fullScreen });
}

/** Saves the wall's layout for one Frigate server. */
export function saveLayout(server: string, layout: SavedLayout): Promise<void> {
  return invoke<void>("save_layout", { server, layout });
}

/** Saves how the wall is drawn: Lock to 16:9, Fit to window, stream info, activity and its style. */
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

/** Mirrors `MqttInput` in src-tauri/src/mqtt.rs: the Home Assistant connection as the page sends it. */
export type MqttInput = Omit<MqttSettings, "deviceId" | "passwordStorage">;

/** Connects to the broker once with `input`, for Test connection. A null `password` uses the saved one. */
export function testMqtt(input: MqttInput, password: string | null): Promise<void> {
  return invoke<void>("test_mqtt", { input, password });
}

/**
 * Saves the Home Assistant connection and connects with it, or disconnects
 * when it is off, and returns the new settings. A null `password` keeps the
 * saved one; an empty username removes it.
 */
export function saveMqtt(input: MqttInput, password: string | null): Promise<Settings> {
  return invoke<Settings>("save_mqtt", { input, password });
}

/** Mirrors `WallReport` in src-tauri/src/mqtt.rs: what Home Assistant hears about the wall. */
export interface WallReport {
  maximised: string | null;
  fullScreen: boolean;
  windowShown: boolean;
  /** The tiles play their streams, rather than showing snapshots. */
  streams: boolean;
  /** Every camera on the Frigate server, in Frigate's order. */
  cameras: string[];
}

/** Tells the backend the wall's state, for Home Assistant. */
export function reportWallState(report: WallReport): Promise<void> {
  return invoke<void>("report_wall_state", { report });
}

/** Mirrors `Review` in src-tauri/src/mqtt/activity.rs: how far Frigate's review of a camera has got. */
export type ReviewStatus = "none" | "detection" | "alert";

/** Mirrors `CameraActivity` in src-tauri/src/mqtt/activity.rs: what Frigate says is happening on one camera. */
export interface CameraActivity {
  motion: boolean;
  /** How many objects of each label are moving in view; labels with none are left out. */
  objects: Record<string, number>;
  review: ReviewStatus;
}

/** Mirrors `Activity` in src-tauri/src/mqtt/activity.rs: every camera's activity by name. Quiet cameras are left out. */
export type Activity = Record<string, CameraActivity>;

/** Every camera's activity as Frigate last told it over the Home Assistant connection. */
export function cameraActivity(): Promise<Activity> {
  return invoke<Activity>("camera_activity");
}

/**
 * Calls `handler` with every camera's activity whenever Frigate says any of
 * it changed. Resolves to a function that stops listening; a backend
 * without events gives a no-op.
 */
export async function onCameraActivity(handler: (activity: Activity) => void): Promise<() => void> {
  try {
    return await listen<Activity>("camera-activity", (event) => handler(event.payload));
  } catch {
    return () => {};
  }
}

/** Tells the backend whether a tile has a problem, for Home Assistant. */
export function reportTileProblem(camera: string, problem: boolean): Promise<void> {
  return invoke<void>("report_tile_problem", { camera, problem });
}

/** Mirrors `WallCommand` in src-tauri/src/mqtt/commands.rs: a change Home Assistant asks the wall for. */
export type WallCommand =
  | { kind: "maximise"; camera: string }
  | { kind: "restore" }
  | { kind: "fullScreen"; on: boolean }
  | { kind: "streams"; on: boolean };

/**
 * Calls `handler` with each command Home Assistant sends the wall. Resolves
 * to a function that stops listening; a backend without events gives a no-op.
 */
export async function onWallCommand(handler: (command: WallCommand) => void): Promise<() => void> {
  try {
    return await listen<WallCommand>("wall-command", (event) => handler(event.payload));
  } catch {
    return () => {};
  }
}
