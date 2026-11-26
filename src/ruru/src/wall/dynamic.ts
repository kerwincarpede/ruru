import { COLUMNS, GAP, ROW_RATIO, fitWidth, gridRows, type GridItem } from "./layout";

/** The narrowest, in pixels, a feed below the heroes may be before the wall keeps its saved layout. */
export const MIN_FEED_WIDTH = 160;
/** A row of feeds this much narrower than the widest fit still counts, so larger feeds win. */
const FIT_SLACK = 0.95;

/** The wall area, in pixels. */
export interface WallSize {
  width: number;
  height: number;
}

/** How many grid columns divide evenly into feeds of one size. */
const PER_ROW = [1, 2, 3, 4, 6, 8, 12, 24].filter((count) => COLUMNS % count === 0);

/** The width in pixels of a tile `span` columns wide on a grid `width` pixels wide. */
export function spanWidth(width: number, span: number, columns = COLUMNS): number {
  const column = (width - GAP * (columns + 1)) / columns;
  return span * column + (span - 1) * GAP;
}

/** Wide walls put the heroes side by side; tall ones stack them. */
export function heroesSideBySide(size: WallSize): boolean {
  return size.width >= size.height;
}

/** A layout and the width it is drawn at. */
interface Fit {
  items: GridItem[];
  width: number;
}

/** How much of the wall, in square pixels, `items` cover on a grid `width` pixels wide. */
function coverage(items: GridItem[], width: number): number {
  return items.reduce((sum, item) => sum + spanWidth(width, item.w) * spanWidth(width, item.h) * ROW_RATIO, 0);
}

/**
 * One hero in the top-left corner of a wide wall, `hero` columns square, with
 * the other cameras in `rest` as feeds `span` columns wide: down its right
 * side first, then in full rows below it. Null when the feeds would be too
 * narrow to read.
 */
function cornerItems(camera: string, rest: string[], hero: number, span: number, size: WallSize): Fit | null {
  const beside = (COLUMNS - hero) / span;
  const besideRows = hero / span;
  const perRow = COLUMNS / span;
  const items: GridItem[] = [{ i: camera, x: 0, y: 0, w: hero, h: hero }];
  rest.forEach((name, index) => {
    if (index < beside * besideRows) {
      const row = Math.floor(index / beside);
      items.push({ i: name, x: hero + (index % beside) * span, y: row * span, w: span, h: span });
    } else {
      const below = index - beside * besideRows;
      items.push({ i: name, x: (below % perRow) * span, y: hero + Math.floor(below / perRow) * span, w: span, h: span });
    }
  });
  const width = fitWidth(size.width, size.height, gridRows(items));
  return spanWidth(width, span) >= MIN_FEED_WIDTH ? { items, width } : null;
}

/**
 * The automatic hero layout: up to two `heroes` large at the top, side by
 * side on a wide wall or stacked on a tall one, and every other camera in
 * `cameras` (the saved wall order) in an even grid below. The grid uses the
 * largest feeds that still fit the wall. A single hero on a wide wall goes
 * in the top-left corner instead, with the other feeds around it, when that
 * shows it at least as large with the same feeds and covers more of the wall. Null when no hero
 * is on the wall, or when the other feeds would be narrower than
 * {@link MIN_FEED_WIDTH}, so the wall keeps its saved layout instead.
 */
export function automaticHeroItems(cameras: string[], heroes: string[], size: WallSize): GridItem[] | null {
  const shown = [...new Set(heroes)].filter((camera) => cameras.includes(camera)).slice(0, 2);
  if (shown.length === 0 || size.width <= 0 || size.height <= 0) return null;
  const above = aboveItems(cameras, shown, size);
  if (!above || above.length < 2 || shown.length > 1 || !heroesSideBySide(size)) return above;

  // Corner layouts with the same feeds as the grid below, and a hero no smaller than the centred one.
  const [camera] = shown;
  const rest = cameras.filter((name) => name !== camera);
  const span = above[1].w;
  const centred = { items: above, width: fitWidth(size.width, size.height, gridRows(above)) };
  const heroWidth = (fit: Fit) => spanWidth(fit.width, fit.items[0].w);
  const corners = Array.from({ length: COLUMNS / span - 1 }, (_, index) => cornerItems(camera, rest, (index + 1) * span, span, size)).filter(
    (fit): fit is Fit => fit !== null && fit.items[0].w > span && heroWidth(fit) >= heroWidth(centred),
  );
  // The layout that covers the most of the wall; the centred one when none covers more.
  return [centred, ...corners].reduce((best, fit) => (coverage(fit.items, fit.width) > coverage(best.items, best.width) ? fit : best)).items;
}

/** The heroes above an even grid of the other cameras; see {@link automaticHeroItems}. */
function aboveItems(cameras: string[], shown: string[], size: WallSize): GridItem[] | null {
  const wide = heroesSideBySide(size);
  const hero = wide ? COLUMNS / 2 : COLUMNS;
  const offset = wide ? (COLUMNS - hero * shown.length) / 2 : 0;
  const items: GridItem[] = shown.map((camera, index) =>
    wide ? { i: camera, x: offset + index * hero, y: 0, w: hero, h: hero } : { i: camera, x: 0, y: index * hero, w: hero, h: hero },
  );
  const top = wide ? hero : hero * shown.length;
  const rest = cameras.filter((camera) => !shown.includes(camera));
  if (rest.length === 0) return items;

  // Every even grid of feeds smaller than a hero, with no more empty columns than it needs.
  const sizes = PER_ROW.filter((perRow) => COLUMNS / perRow < hero);
  const enough = sizes.find((perRow) => perRow >= rest.length);
  const fits = sizes.filter((perRow) => perRow <= rest.length || perRow === enough).map((perRow) => {
    const span = COLUMNS / perRow;
    const rows = top + Math.ceil(rest.length / perRow) * span;
    const width = fitWidth(size.width, size.height, rows);
    return { perRow, span, width, readable: spanWidth(width, span) >= MIN_FEED_WIDTH };
  });
  const widest = Math.max(0, ...fits.map((fit) => fit.width));
  const best = fits.find((fit) => fit.readable && fit.width >= widest * FIT_SLACK);
  if (!best) return null;
  return [
    ...items,
    ...rest.map((camera, index) => {
      const row = Math.floor(index / best.perRow);
      // A short last row sits in the middle.
      const inRow = Math.min(best.perRow, rest.length - row * best.perRow);
      const indent = Math.floor(((best.perRow - inRow) * best.span) / 2);
      return { i: camera, x: indent + (index % best.perRow) * best.span, y: top + row * best.span, w: best.span, h: best.span };
    }),
  ];
}

/**
 * The saved layout `items` with `heroes` moved into the tiles of the two
 * `slots` cameras. A hero already in a slot stays; each other hero swaps
 * places with the camera in a free slot, which takes the hero's tile for
 * now. Null when the slots are not two cameras on the wall, so the wall
 * uses the automatic layout instead.
 */
export function customHeroItems(items: GridItem[], slots: string[], heroes: string[]): GridItem[] | null {
  const on = (camera: string) => items.some((item) => item.i === camera);
  if (slots.length !== 2 || slots[0] === slots[1] || !slots.every(on)) return null;
  const shown = [...new Set(heroes)].filter(on).slice(0, 2);
  if (shown.length === 0) return null;
  const place = new Map(items.map((item) => [item.i, item]));
  const moved = new Map<string, GridItem>();
  const free = slots.filter((slot) => !shown.includes(slot));
  for (const hero of shown.filter((camera) => !slots.includes(camera))) {
    const slot = free.shift() as string;
    const from = place.get(hero) as GridItem;
    const to = place.get(slot) as GridItem;
    moved.set(hero, { ...to, i: hero });
    moved.set(slot, { ...from, i: slot });
  }
  return items.map((item) => moved.get(item.i) ?? item);
}

/**
 * The hero layout for the wall: the custom `slots` when both are on the
 * wall, otherwise the automatic one. Null keeps the saved layout.
 */
export function heroItems(items: GridItem[], slots: string[], heroes: string[], size: WallSize): GridItem[] | null {
  return (
    customHeroItems(items, slots, heroes) ??
    automaticHeroItems(
      items.map((item) => item.i),
      heroes,
      size,
    )
  );
}
