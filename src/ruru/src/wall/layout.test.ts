import { describe, expect, it } from "vitest";
import {
  COLUMNS,
  defaultPlacements,
  fitWidth,
  fromGridItems,
  gridHeight,
  gridRows,
  hideCamera,
  rowHeight,
  showCamera,
  toGridItems,
  wallPlacements,
} from "./layout";

describe("defaultPlacements", () => {
  it("lays cameras out in Frigate's order on an even, square-ish grid", () => {
    expect(defaultPlacements(["a", "b", "c", "d"])).toEqual([
      { camera: "a", x: 0, y: 0, w: 12, h: 12 },
      { camera: "b", x: 12, y: 0, w: 12, h: 12 },
      { camera: "c", x: 0, y: 12, w: 12, h: 12 },
      { camera: "d", x: 12, y: 12, w: 12, h: 12 },
    ]);
    const ten = defaultPlacements(Array.from({ length: 10 }, (_, i) => `cam${i}`));
    expect(ten.map((tile) => tile.w)).toEqual(Array(10).fill(6));
    expect(ten[4]).toEqual({ camera: "cam4", x: 0, y: 6, w: 6, h: 6 });
  });

  it("places nothing for no cameras", () => {
    expect(defaultPlacements([])).toEqual([]);
  });
});

describe("wallPlacements", () => {
  it("uses the default layout when nothing is saved", () => {
    expect(wallPlacements(["a", "b"], undefined)).toEqual(defaultPlacements(["a", "b"]));
  });

  it("leaves hidden cameras out", () => {
    expect(wallPlacements(["a", "b"], { tiles: [], hidden: ["a"] })).toEqual(defaultPlacements(["b"]));
  });

  it("keeps saved tiles and puts new cameras below them", () => {
    const saved = { tiles: [{ camera: "a", x: 4, y: 0, w: 8, h: 8 }], hidden: [] };
    expect(wallPlacements(["a", "b", "c", "d"], saved)).toEqual([
      { camera: "a", x: 4, y: 0, w: 8, h: 8 },
      { camera: "b", x: 0, y: 8, w: 12, h: 12 },
      { camera: "c", x: 12, y: 8, w: 12, h: 12 },
      { camera: "d", x: 0, y: 20, w: 12, h: 12 },
    ]);
  });

  it("keeps a saved tile inside the grid", () => {
    const saved = { tiles: [{ camera: "a", x: 20, y: 0, w: 30, h: 8 }], hidden: [] };
    expect(wallPlacements(["a"], saved)).toEqual([{ camera: "a", x: 0, y: 0, w: COLUMNS, h: 8 }]);
  });
});

describe("grid items", () => {
  it("round-trips placements through react-grid-layout's items", () => {
    const tiles = [{ camera: "a", x: 1, y: 2, w: 3, h: 4 }];
    expect(toGridItems(tiles)).toEqual([{ i: "a", x: 1, y: 2, w: 3, h: 4 }]);
    expect(fromGridItems(toGridItems(tiles), ["b"])).toEqual({ tiles, hidden: ["b"] });
  });
});

describe("hideCamera and showCamera", () => {
  const layout = { tiles: [{ camera: "a", x: 0, y: 0, w: 4, h: 4 }], hidden: [] };

  it("hides a camera once and shows it again", () => {
    const hidden = hideCamera(layout, "a");
    expect(hidden).toEqual({ tiles: [], hidden: ["a"] });
    expect(hideCamera(hidden, "a")).toEqual(hidden);
    expect(showCamera(hidden, "a")).toEqual({ tiles: [], hidden: [] });
  });
});

describe("rowHeight", () => {
  it("makes a tile as many rows tall as it is columns wide about 16:9", () => {
    const width = 4 + 24 * 44;
    expect(rowHeight(width)).toBeCloseTo((40 * 9) / 16);
    expect(rowHeight(0)).toBe(4);
  });
});

describe("fitWidth", () => {
  it("counts the rows the tiles use", () => {
    expect(gridRows([])).toBe(0);
    expect(gridRows([{ y: 0, h: 12 }, { y: 12, h: 6 }, { y: 0, h: 4 }])).toBe(18);
  });

  it("keeps the full width when the wall already fits the window's height", () => {
    expect(fitWidth(1600, 2000, 12)).toBe(1600);
    expect(gridHeight(1600, 12)).toBeLessThan(2000);
  });

  it("narrows a wall too tall for the window until its height fits exactly", () => {
    // Two rows of 16:9 tiles on a wide but short window.
    const width = fitWidth(1600, 600, 24);
    expect(width).toBeLessThan(1600);
    expect(gridHeight(width, 24)).toBeCloseTo(600, 6);
  });

  it("leaves a usable grid however short the window and ignores an empty wall", () => {
    expect(fitWidth(1600, 10, 48)).toBeGreaterThan(0);
    expect(fitWidth(1600, 600, 0)).toBe(1600);
    expect(fitWidth(1600, 0, 12)).toBe(1600);
  });
});
