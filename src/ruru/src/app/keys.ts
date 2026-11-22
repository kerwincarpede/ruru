/** Whether Ruru runs on macOS, where shortcuts use ⌘ instead of Ctrl. */
export function isMac(platform = navigator.userAgent): boolean {
  return /Mac|iPhone|iPad/.test(platform);
}

/** What a key press asks for, or null when it is not one of Ruru's shortcuts. */
export type Shortcut = "settings" | "fullScreen";

/** Ctrl+, (⌘ , on macOS) opens Settings; F11 (Ctrl+⌘ F on macOS) toggles full screen. */
export function shortcutFor(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">, mac = isMac()): Shortcut | null {
  if (event.key === "," && (mac ? event.metaKey : event.ctrlKey) && !event.altKey) return "settings";
  if (mac ? event.ctrlKey && event.metaKey && event.key.toLowerCase() === "f" : event.key === "F11") return "fullScreen";
  return null;
}
