import { describe, expect, it } from "vitest";
import { AUTO_MAIN_PX, automaticStream, forgetWidths, knownWidth, recordWidth } from "./streams";

describe("automaticStream", () => {
  it("plays main on tiles well wider than the sub stream's picture", () => {
    // A 640-wide sub stream switches at 960 device pixels.
    expect(automaticStream(959, 640)).toBe("sub");
    expect(automaticStream(960, 640)).toBe("main");
    // A 1280-wide sub stream is sharp enough up to 1920.
    expect(automaticStream(1800, 1280)).toBe("sub");
    expect(automaticStream(1920, 1280)).toBe("main");
  });

  it("guesses from the tile's size before the sub stream's width is known", () => {
    expect(automaticStream(AUTO_MAIN_PX - 1, undefined)).toBe("sub");
    expect(automaticStream(AUTO_MAIN_PX, undefined)).toBe("main");
  });

  it("stays on main until the tile is clearly narrower, so it does not flip at the edge", () => {
    expect(automaticStream(900, 640, "main")).toBe("main");
    expect(automaticStream(768, 640, "main")).toBe("main");
    expect(automaticStream(767, 640, "main")).toBe("sub");
    // From sub it still needs the full width.
    expect(automaticStream(900, 640, "sub")).toBe("sub");
  });
});

describe("recordWidth", () => {
  it("remembers each stream's picture width per server", () => {
    forgetWidths();
    recordWidth("http://a", "cam_sub", 640);
    recordWidth("http://a", "cam", 0);
    expect(knownWidth("http://a", "cam_sub")).toBe(640);
    expect(knownWidth("http://a", "cam")).toBeUndefined();
    expect(knownWidth("http://b", "cam_sub")).toBeUndefined();
    forgetWidths();
    expect(knownWidth("http://a", "cam_sub")).toBeUndefined();
  });
});
