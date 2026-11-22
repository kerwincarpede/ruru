import { invoke } from "@tauri-apps/api/core";

/** Mirrors `AppInfo` in src-tauri/src/lib.rs. */
export interface AppInfo {
  name: string;
  version: string;
}

/** The app's name and version, as the Rust backend was built with them. */
export function appInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("app_info");
}
