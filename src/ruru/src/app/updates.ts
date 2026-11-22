import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

/** An update this copy can install. */
export interface AvailableUpdate {
  version: string;
  /** Downloads and installs the update, then restarts Ruru on it. */
  install: () => Promise<void>;
}

/**
 * The version `fake_update` in src-tauri/src/update.rs offers, or null.
 * Only a debug build run with RURU_FAKE_UPDATE set returns one.
 */
export function fakeUpdate(): Promise<string | null> {
  return invoke<string | null>("fake_update");
}

/**
 * The newer Stable release, or null when there is none. Silent by design: a
 * failed check, including the 404 before the first Stable release, is null.
 */
export async function findUpdate(): Promise<AvailableUpdate | null> {
  try {
    const fake = await fakeUpdate();
    if (fake) {
      // Nothing to download: installing a fake update just closes the prompt.
      return { version: fake, install: async () => {} };
    }
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      install: async () => {
        await update.downloadAndInstall();
        await relaunch();
      },
    };
  } catch {
    return null;
  }
}
