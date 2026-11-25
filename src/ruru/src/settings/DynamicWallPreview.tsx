import type { SavedLayout } from "../app/api";
import { cameraLabel } from "../app/frigate";
import { heroItems, type WallSize } from "../wall/dynamic";
import { COLUMNS, ROW_RATIO, gridRows, toGridItems, wallPlacements } from "../wall/layout";

interface DynamicWallPreviewProps {
  cameras: string[];
  layout: SavedLayout | undefined;
  heroSlots: string[];
  priority: string[];
  size: WallSize;
}

/**
 * The wall as the Dynamic wall would draw it at the wall area's size, with
 * the hero slots, or the first two cameras, as heroes. With fewer than two
 * cameras, or feeds too small to read, it shows the saved layout and says why.
 */
export default function DynamicWallPreview({ cameras, layout, heroSlots, priority, size }: DynamicWallPreviewProps) {
  const saved = toGridItems(wallPlacements(cameras, layout));
  const custom = heroSlots.length === 2 && heroSlots[0] !== heroSlots[1] && heroSlots.every((slot) => cameras.includes(slot));
  const heroes = custom ? heroSlots : cameras.slice(0, 2);
  const moved = cameras.length >= 2 ? heroItems(saved, heroSlots, heroes, size) : null;
  const items = moved ?? saved;
  const rows = Math.max(1, gridRows(items));
  const note =
    cameras.length < 2
      ? "Heroes need at least two cameras on the wall, so the wall keeps its layout."
      : moved
        ? null
        : "On this screen the other cameras would be too small, so the wall keeps its layout.";
  return (
    <div className="dynamic-preview">
      <div className="dynamic-preview-screen" style={{ aspectRatio: `${Math.max(1, size.width)} / ${Math.max(1, size.height)}` }}>
        <div className="dynamic-preview-grid" role="img" aria-label="Dynamic wall preview" style={{ aspectRatio: `${COLUMNS} / ${rows * ROW_RATIO}` }}>
          {items.map((item) => {
            const hero = moved !== null && heroes.includes(item.i);
            return (
              <span
                key={item.i}
                className={`dynamic-preview-tile${hero ? " is-hero" : ""}${priority.includes(item.i) ? " is-priority" : ""}`}
                data-camera={item.i}
                style={{ left: `${(item.x / COLUMNS) * 100}%`, top: `${(item.y / rows) * 100}%`, width: `${(item.w / COLUMNS) * 100}%`, height: `${(item.h / rows) * 100}%` }}
              >
                {cameraLabel(item.i)}
              </span>
            );
          })}
        </div>
      </div>
      {note && <p className="field-hint">{note}</p>}
    </div>
  );
}
