import type { InvokeArgs } from "@tauri-apps/api/core";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { AppInfo } from "../app/api";
import type { Camera, FrigateStatus } from "../app/frigate";
import type { SavedLayout, Settings, WallOptions } from "../app/api";

/** The Rust commands the page can call, by name, typed by hand from src-tauri/src/. */
type Commands = {
  app_info: () => AppInfo;
  fake_update: () => string | null;
  get_settings: () => Settings;
  save_frigate_url: (args: { url: string }) => Settings;
  set_full_screen: (args: { fullScreen: boolean }) => null;
  save_layout: (args: { server: string; layout: SavedLayout }) => null;
  save_wall_options: (args: { options: WallOptions }) => null;
  test_frigate: (args: { url: string }) => FrigateStatus;
  frigate_cameras: (args: { url: string }) => Camera[];
};

/** A Rust command the page can call. */
export type CommandName = keyof Commands;

/** What `command` returns when it succeeds. */
export type CommandResult<C extends CommandName> = Awaited<ReturnType<Commands[C]>>;

/** A fake for each command a test needs. Throw to make the command fail. */
export type CommandHandlers = {
  [C in CommandName]?: (args: Parameters<Commands[C]>[0]) => CommandResult<C> | Promise<CommandResult<C>>;
};

/** One call the page made, in the order it made them. */
export type CommandCall = { cmd: string; payload?: InvokeArgs };

/**
 * Fakes the backend over `mockIPC`, with each handler's result typed from the
 * Rust command of the same name. A command without a handler fails, so a test
 * cannot pass on a backend it never set up. Returns the calls the page made.
 */
export function mockCommands(handlers: CommandHandlers): CommandCall[] {
  const calls: CommandCall[] = [];
  const byName = new Map<string, (args: unknown) => unknown>(
    Object.entries(handlers) as [string, (args: unknown) => unknown][],
  );
  mockIPC((cmd, payload) => {
    calls.push({ cmd, payload });
    const handler = byName.get(cmd);
    if (handler) return handler(payload);
    throw new Error(`No mock for the "${cmd}" command`);
    // Events (`listen`, `emit`) are faked too, so a test can `emit` what Rust would.
  }, { shouldMockEvents: true });
  return calls;
}
