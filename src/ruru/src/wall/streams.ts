/** A camera's feed: its full-size main stream or its smaller sub stream. */
export type StreamKind = "main" | "sub";

/** Automatic plays main once a tile is this many times wider than the sub stream's picture. */
export const AUTO_MAIN_RATIO = 1.5;
/** Until the sub stream's width is known, Automatic plays main on tiles at least this many device pixels wide. */
export const AUTO_MAIN_PX = 960;
/** A tile on main goes back to sub only once it is this much narrower than where it switched up, so it does not flip at the edge. */
export const AUTO_HYSTERESIS = 0.8;
/** Automatic waits for a tile's size to settle this long before choosing again, so a drag does not switch streams. */
export const AUTO_SETTLE_MS = 400;

/**
 * The stream Automatic plays on a tile `devicePx` device pixels wide (its
 * CSS width times the device pixel ratio). `subWidth` is the sub stream's
 * picture width once known, and `previous` what Automatic chose last.
 */
export function automaticStream(devicePx: number, subWidth: number | undefined, previous?: StreamKind): StreamKind {
  const threshold = subWidth ? subWidth * AUTO_MAIN_RATIO : AUTO_MAIN_PX;
  return devicePx >= (previous === "main" ? threshold * AUTO_HYSTERESIS : threshold) ? "main" : "sub";
}

/** Picture widths seen so far, by Frigate URL and stream, so a tile on main still knows its sub stream's width. */
const widths = new Map<string, number>();

export function recordWidth(base: string, stream: string, width: number): void {
  if (width > 0) widths.set(`${base}\n${stream}`, width);
}

export function knownWidth(base: string, stream: string): number | undefined {
  return widths.get(`${base}\n${stream}`);
}

/** Forgets every recorded width. For tests. */
export function forgetWidths(): void {
  widths.clear();
}
