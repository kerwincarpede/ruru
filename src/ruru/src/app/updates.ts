import { invoke } from "@tauri-apps/api/core";
import type { AppInfo, UpdateChannel } from "./api";

/** An update this copy can install. */
export interface AvailableUpdate {
  version: string;
  /** Downloads and installs the update, then restarts Ruru on it. */
  install: () => Promise<void>;
}

/** The update channels, in the order Settings lists them, with what each one means. */
export const UPDATE_CHANNELS: { value: UpdateChannel; title: string; hint: string }[] = [
  { value: "stable", title: "Stable", hint: "Get updates after they’ve been tried on Edge." },
  { value: "edge", title: "Edge", hint: "Get every change as soon as it’s built. You may run into bugs." },
];

/** "Ruru 0.3.0", with "· Edge" after it on the Edge channel. */
export function versionLabel(info: AppInfo, channel: UpdateChannel): string {
  const label = `${info.name} ${info.version}`;
  return channel === "edge" ? `${label} · Edge` : label;
}

/**
 * The version `fake_update` in src-tauri/src/update.rs offers, or null.
 * Only a debug build run with RURU_FAKE_UPDATE set returns one.
 */
export function fakeUpdate(): Promise<string | null> {
  return invoke<string | null>("fake_update");
}

/**
 * The newer release on the saved update channel, or null when this copy is
 * up to date. Rejects with the reason when the check fails.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  const fake = await fakeUpdate();
  if (fake) {
    // Nothing to download: installing a fake update just closes the prompt.
    return { version: fake, install: async () => {} };
  }
  const version = await invoke<string | null>("check_update");
  if (!version) return null;
  // A real update restarts Ruru before install_update returns.
  return { version, install: () => invoke<void>("install_update") };
}

/** The startup check: like `checkForUpdate`, but a failed check is null. */
export async function findUpdate(): Promise<AvailableUpdate | null> {
  try {
    return await checkForUpdate();
  } catch {
    return null;
  }
}
