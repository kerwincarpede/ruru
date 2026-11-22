import type { SavedLayout, TilePlacement } from "../app/api";

/** The wall's grid is this many columns wide. */
export const COLUMNS = 24;
/** Grid rows are this fraction of a column tall, so a square of units is 16:9. */
export const ROW_RATIO = 9 / 16;
/** The gap between tiles, in pixels. */
export const GAP = 4;

/** A layout with nothing saved: every camera, in Frigate's order. */
export const EMPTY_LAYOUT: SavedLayout = { tiles: [], hidden: [] };

/**
 * Places `cameras` in Frigate's order on an even grid: as many per row as a
 * square-ish wall needs, each the same size.
 */
export function defaultPlacements(cameras: string[], columns = COLUMNS): TilePlacement[] {
  if (cameras.length === 0) return [];
  const perRow = Math.min(Math.ceil(Math.sqrt(cameras.length)), columns);
  const size = Math.max(1, Math.floor(columns / perRow));
  return cameras.map((camera, index) => ({
    camera,
    x: (index % perRow) * size,
    y: Math.floor(index / perRow) * size,
    w: size,
    h: size,
  }));
}

/**
 * The tiles to show: each camera that is not hidden, where the saved layout
 * puts it. Cameras the layout does not know yet, such as one just added to
 * Frigate, go below the rest in the default size.
 */
export function wallPlacements(cameras: string[], saved: SavedLayout | undefined, columns = COLUMNS): TilePlacement[] {
  const layout = saved ?? EMPTY_LAYOUT;
  const hidden = new Set(layout.hidden);
  const visible = cameras.filter((camera) => !hidden.has(camera));
  if (layout.tiles.length === 0) return defaultPlacements(visible, columns);

  const known = new Map(layout.tiles.map((tile) => [tile.camera, tile]));
  const size = defaultPlacements(visible, columns)[0]?.w ?? columns;
  let bottom = layout.tiles.reduce((max, tile) => Math.max(max, tile.y + tile.h), 0);
  let x = 0;
  return visible.map((camera) => {
    const tile = known.get(camera);
    if (tile) return { ...tile, w: Math.min(tile.w, columns), x: Math.min(tile.x, columns - Math.min(tile.w, columns)) };
    if (x + size > columns) {
      x = 0;
      bottom += size;
    }
    const placed = { camera, x, y: bottom, w: size, h: size };
    x += size;
    return placed;
  });
}

/** react-grid-layout's item, as far as the wall uses it. */
export interface GridItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The grid items for `placements`. */
export function toGridItems(placements: TilePlacement[]): GridItem[] {
  return placements.map(({ camera, x, y, w, h }) => ({ i: camera, x, y, w, h }));
}

/** The layout to save after the grid changed: its items and the hidden cameras. */
export function fromGridItems(items: GridItem[], hidden: string[], saved?: SavedLayout): SavedLayout {
  return {
    tiles: items.map(({ i, x, y, w, h }) => ({ camera: i, x, y, w, h, stream: saved?.tiles.find((tile) => tile.camera === i)?.stream })),
    hidden: [...hidden],
  };
}

/** `layout` with `camera` hidden, its tile removed. */
export function hideCamera(layout: SavedLayout, camera: string): SavedLayout {
  return {
    tiles: layout.tiles.filter((tile) => tile.camera !== camera),
    hidden: layout.hidden.includes(camera) ? layout.hidden : [...layout.hidden, camera],
  };
}

/** `layout` with `camera` shown again; it goes below the other tiles. */
export function showCamera(layout: SavedLayout, camera: string): SavedLayout {
  return { tiles: layout.tiles, hidden: layout.hidden.filter((name) => name !== camera) };
}

/** The height of one grid row for a wall `width` pixels wide. */
export function rowHeight(width: number, columns = COLUMNS): number {
  return Math.max(4, ((width - GAP * (columns + 1)) / columns) * ROW_RATIO);
}

/** How many grid rows `items` use. */
export function gridRows(items: { y: number; h: number }[]): number {
  return items.reduce((rows, item) => Math.max(rows, item.y + item.h), 0);
}

/** The height of a grid `width` pixels wide holding `rows` rows, padding included. */
export function gridHeight(width: number, rows: number, columns = COLUMNS): number {
  if (rows <= 0) return 0;
  return rows * rowHeight(width, columns) + (rows - 1) * GAP * ROW_RATIO + 2 * GAP;
}

/**
 * The width to draw the grid at so `rows` rows fit in `height` as well as
 * `width`. Tiles keep their shape, so a wall too tall for the window is
 * drawn narrower instead of scrolling.
 */
export function fitWidth(width: number, height: number, rows: number, columns = COLUMNS): number {
  if (rows <= 0 || height <= 0 || gridHeight(width, rows, columns) <= height) return width;
  const row = (height - 2 * GAP - (rows - 1) * GAP * ROW_RATIO) / rows;
  const fitted = (row / ROW_RATIO) * columns + GAP * (columns + 1);
  // A window too short for any picture still gets a usable grid.
  return Math.max(Math.min(width, fitted), Math.min(width, GAP * (columns + 1) + columns * 4));
}
