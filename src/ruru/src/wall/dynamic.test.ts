import { describe, expect, it } from "vitest";
import { MIN_FEED_WIDTH, automaticHeroItems, customHeroItems, heroItems, spanWidth } from "./dynamic";
import type { GridItem } from "./layout";

const names = (count: number) => Array.from({ length: count }, (_, index) => `cam${index}`);

describe("automaticHeroItems", () => {
  it("puts two heroes side by side above two rows of four on a wide wall", () => {
    const items = automaticHeroItems(names(10), ["cam3", "cam7"], { width: 1920, height: 1080 });
    expect(items?.slice(0, 2)).toEqual([
      { i: "cam3", x: 0, y: 0, w: 12, h: 12 },
      { i: "cam7", x: 12, y: 0, w: 12, h: 12 },
    ]);
    const rest = items?.slice(2) ?? [];
    expect(rest.map((item) => item.i)).toEqual(["cam0", "cam1", "cam2", "cam4", "cam5", "cam6", "cam8", "cam9"]);
    expect(rest.every((item) => item.w === 6 && item.h === 6)).toBe(true);
    expect(new Set(rest.map((item) => item.y))).toEqual(new Set([12, 18]));
  });

  it("stacks the heroes on a tall wall", () => {
    const items = automaticHeroItems(names(10), ["cam0", "cam1"], { width: 1080, height: 1920 });
    expect(items?.slice(0, 2)).toEqual([
      { i: "cam0", x: 0, y: 0, w: 24, h: 24 },
      { i: "cam1", x: 0, y: 24, w: 24, h: 24 },
    ]);
    expect(items?.slice(2).every((item) => item.y >= 48 && item.w < 24)).toBe(true);
  });

  it("centres a single hero and leaves cameras off the wall out", () => {
    const items = automaticHeroItems(["a", "b"], ["gone", "b"], { width: 1600, height: 900 });
    expect(items?.[0]).toEqual({ i: "b", x: 6, y: 0, w: 12, h: 12 });
    expect(items).toHaveLength(2);
    expect(automaticHeroItems(["a"], ["a"], { width: 1600, height: 900 })).toEqual([{ i: "a", x: 6, y: 0, w: 12, h: 12 }]);
  });

  it("keeps the overview when the other feeds would be too small to read", () => {
    expect(automaticHeroItems(names(30), ["cam0", "cam1"], { width: 1280, height: 720 })).toBeNull();
    expect(automaticHeroItems(names(4), [], { width: 1280, height: 720 })).toBeNull();
    expect(automaticHeroItems(names(4), ["cam0"], { width: 0, height: 0 })).toBeNull();
    expect(spanWidth(1920, 6)).toBeGreaterThan(MIN_FEED_WIDTH);
  });
});

const saved: GridItem[] = [
  { i: "a", x: 0, y: 0, w: 12, h: 12 },
  { i: "b", x: 12, y: 0, w: 12, h: 12 },
  { i: "c", x: 0, y: 12, w: 6, h: 6 },
  { i: "d", x: 6, y: 12, w: 6, h: 6 },
];

describe("customHeroItems", () => {
  it("swaps active cameras into the hero slots and the slots' cameras into their places", () => {
    const items = customHeroItems(saved, ["a", "b"], ["c", "d"]);
    expect(items).toEqual([
      { i: "a", x: 0, y: 12, w: 6, h: 6 },
      { i: "b", x: 6, y: 12, w: 6, h: 6 },
      { i: "c", x: 0, y: 0, w: 12, h: 12 },
      { i: "d", x: 12, y: 0, w: 12, h: 12 },
    ]);
  });

  it("leaves a hero that already sits in a slot where it is", () => {
    expect(customHeroItems(saved, ["a", "b"], ["b", "d"])).toEqual([
      { i: "a", x: 6, y: 12, w: 6, h: 6 },
      saved[1],
      saved[2],
      { i: "d", x: 0, y: 0, w: 12, h: 12 },
    ]);
  });

  it("falls back to Automatic when a slot is unavailable", () => {
    expect(customHeroItems(saved, ["a", "gone"], ["c"])).toBeNull();
    expect(customHeroItems(saved, ["a"], ["c"])).toBeNull();
    expect(customHeroItems(saved, ["a", "a"], ["c"])).toBeNull();
    expect(customHeroItems(saved, ["a", "b"], ["gone"])).toBeNull();
    const automatic = heroItems(saved, ["a", "gone"], ["c"], { width: 1600, height: 900 });
    expect(automatic?.[0]).toEqual({ i: "c", x: 6, y: 0, w: 12, h: 12 });
  });
});
