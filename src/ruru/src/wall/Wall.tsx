import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./wall.css";
import { useEffect, useMemo, useRef, useState } from "react";
import GridLayout from "react-grid-layout";
import type { Camera } from "../app/frigate";
import type { SavedLayout } from "../app/settings";
import { COLUMNS, GAP, fromGridItems, hideCamera, rowHeight, toGridItems, wallPlacements, type GridItem } from "./layout";
import Tile from "./Tile";

interface WallProps {
  base: string;
  cameras: Camera[];
  layout: SavedLayout | undefined;
  /** False while the window is hidden: every stream stops. */
  live: boolean;
  editing: boolean;
  refresh: number;
  /** The layout changed in Edit layout mode and should be saved. */
  onLayout: (layout: SavedLayout) => void;
}

/** The wall's width, followed as the window resizes. */
function useWidth() {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [box, width] as const;
}

/**
 * Every camera's tile on a grid. In Edit layout mode tiles drag, resize and
 * hide; otherwise a double-click maximises a tile onto its main stream.
 */
export default function Wall({ base, cameras, layout, live, editing, refresh, onLayout }: WallProps) {
  const [box, width] = useWidth();
  const [maximised, setMaximised] = useState<string | null>(null);
  const names = useMemo(() => cameras.map((camera) => camera.name), [cameras]);
  const items = useMemo(() => toGridItems(wallPlacements(names, layout)), [names, layout]);
  const byName = useMemo(() => new Map(cameras.map((camera) => [camera.name, camera])), [cameras]);
  const hidden = layout?.hidden ?? [];
  const open = maximised ? byName.get(maximised) : undefined;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMaximised(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const save = (next: GridItem[]) => onLayout(fromGridItems(next, hidden));

  return (
    <div ref={box} className={`wall${editing ? " is-editing" : ""}`}>
      <GridLayout
        className="wall-grid"
        width={width}
        cols={COLUMNS}
        rowHeight={rowHeight(width)}
        margin={[GAP, GAP]}
        containerPadding={[GAP, GAP]}
        layout={items}
        isDraggable={editing}
        isResizable={editing}
        draggableCancel=".tile-hide"
        onDragStop={save}
        onResizeStop={save}
      >
        {items.map((item) => {
          const camera = byName.get(item.i) as Camera;
          return (
            <div key={item.i} className="wall-cell">
              <Tile
                base={base}
                camera={camera}
                stream={camera.subStream}
                // The wall's streams pause while one camera fills the window.
                live={live && !open}
                refresh={refresh}
                editing={editing}
                onOpen={() => setMaximised(camera.name)}
                onHide={() => onLayout(hideCamera(fromGridItems(items, hidden), camera.name))}
              />
            </div>
          );
        })}
      </GridLayout>
      {open && (
        <div className="wall-maximised" onDoubleClick={() => setMaximised(null)}>
          <Tile base={base} camera={open} stream={open.mainStream} live={live} refresh={refresh} />
        </div>
      )}
    </div>
  );
}
