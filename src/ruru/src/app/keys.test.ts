import { describe, expect, it } from "vitest";
import { isMac, shortcutFor } from "./keys";

const key = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe("shortcutFor", () => {
  it("opens Settings with Ctrl+, and toggles full screen with F11 on Windows and Linux", () => {
    expect(shortcutFor(key(",", { ctrlKey: true }), false)).toBe("settings");
    expect(shortcutFor(key(",", { metaKey: true }), false)).toBeNull();
    expect(shortcutFor(key("F11"), false)).toBe("fullScreen");
    expect(shortcutFor(key("a"), false)).toBeNull();
  });

  it("uses ⌘ , and Ctrl+⌘ F on macOS", () => {
    expect(shortcutFor(key(",", { metaKey: true }), true)).toBe("settings");
    expect(shortcutFor(key(",", { metaKey: true, altKey: true }), true)).toBeNull();
    expect(shortcutFor(key("f", { ctrlKey: true, metaKey: true }), true)).toBe("fullScreen");
    expect(shortcutFor(key("F11"), true)).toBeNull();
  });
});

describe("isMac", () => {
  it("reads the platform from the user agent", () => {
    expect(isMac("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe(true);
    expect(isMac("Mozilla/5.0 (X11; Linux x86_64)")).toBe(false);
  });
});
