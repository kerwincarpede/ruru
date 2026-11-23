import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./wall.css";
import { useEffect, useMemo, useRef, useState } from "react";
import GridLayout from "react-grid-layout";
import type { Camera } from "../app/frigate";
import type { Activity, ActivityStyle, SavedLayout } from "../app/api";
import { COLUMNS, GAP, ROW_RATIO, fitWidth, fromGridItems, gridRows, hideCamera, rowHeight, toGridItems, wallPlacements, type GridItem } from "./layout";
import type { StreamKind } from "./streams";
import Tile from "./Tile";

interface WallProps {
  base: string;
  cameras: Camera[];
  layout: SavedLayout | undefined;
  /** False while the window is hidden: every stream stops. */
  live: boolean;
  editing: boolean;
  lockRatio?: boolean;
  /** Shrink the grid so the whole wall fits the window's height as well as its width. */
  fitToWindow?: boolean;
  streamInfo?: boolean;
  /** What Frigate says is happening on each camera; undefined draws no activity. */
  activity?: Activity;
  /** How a tile marks motion and alerts. */
  activityStyle?: ActivityStyle;
  refresh: number;
  /** The camera filling the window, if any. */
  maximised?: string | null;
  onMaximise?: (camera: string | null) => void;
  /** Bumped per camera to reconnect its tile. */
  reconnects?: Record<string, number>;
  /** Told what Automatic plays on each camera's tile. */
  onAutomatic?: (camera: string, stream: StreamKind) => void;
  /** Told whether each camera's tile has a problem, while the window is shown. */
  onProblem?: (camera: string, problem: boolean) => void;
  /** Told each time a camera's tile starts playing video. */
  onPlaying?: (camera: string) => void;
  /** The layout changed in Edit layout mode and should be saved. */
  onLayout: (layout: SavedLayout) => void;
}

/** The wall's size, followed as the window resizes. */
function useSize() {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [box, size] as const;
}

/**
 * Every camera's tile on a grid. In Edit layout mode tiles drag, resize and
 * hide; otherwise a double-click maximises a tile. A maximised tile is the
 * same tile drawn over the window, so its picture keeps moving and the
 * other tiles keep playing behind it.
 */
export default function Wall({
  base,
  cameras,
  layout,
  live,
  editing,
  lockRatio = true,
  fitToWindow = false,
  streamInfo = false,
  activity,
  activityStyle = "ring",
  refresh,
  maximised = null,
  onMaximise,
  reconnects = {},
  onAutomatic,
  onProblem,
  onPlaying,
  onLayout,
}: WallProps) {
  const [box, size] = useSize();
  const names = useMemo(() => cameras.map((camera) => camera.name), [cameras]);
  const items = useMemo(() => toGridItems(wallPlacements(names, layout)), [names, layout]);
  const byName = useMemo(() => new Map(cameras.map((camera) => [camera.name, camera])), [cameras]);
  const hidden = layout?.hidden ?? [];
  const open = maximised && items.some((item) => item.i === maximised) ? maximised : null;
  const width = fitToWindow ? fitWidth(size.width, size.height, gridRows(items)) : size.width;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onMaximise?.(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onMaximise]);

  const save = (next: GridItem[]) => onLayout(fromGridItems(next, hidden, layout));
  const choiceFor = (camera: Camera) => layout?.tiles.find((tile) => tile.camera === camera.name)?.stream;

  return (
    <div ref={box} className={`wall activity-${activityStyle}${editing ? " is-editing" : ""}${fitToWindow ? " is-fit" : ""}`}>
      <div className="wall-fit" style={fitToWindow ? { width } : undefined}>
        <GridLayout
          className={lockRatio ? "wall-grid lock-ratio" : "wall-grid"}
          width={width}
          cols={COLUMNS}
          rowHeight={rowHeight(width)}
          margin={[GAP, GAP * ROW_RATIO]}
          containerPadding={[GAP, GAP]}
          layout={items}
          // Positioned without transforms, so a maximised tile can be fixed to the window.
          useCSSTransforms={false}
          isDraggable={editing && !open}
          isResizable={editing && !open}
          draggableCancel=".tile-hide"
          onDragStop={save}
          onResize={(_items, _old, tile, placeholder) => {
            if (!lockRatio) return;
            tile.h = tile.w;
            if (placeholder) placeholder.h = tile.h;
          }}
          onResizeStop={save}
        >
          {items.map((item) => {
            const camera = byName.get(item.i) as Camera;
            // The cell carries the activity too: the Outline between tiles style draws in the gap around it.
            const seen = activity?.[camera.name];
            const cell = ["wall-cell", item.i === open && "is-maximised", seen?.motion && "has-motion", seen?.review === "alert" && "is-alert"].filter(Boolean).join(" ");
            return (
              <div key={item.i} className={cell}>
                <Tile
                  base={base}
                  camera={camera}
                  choice={choiceFor(camera)}
                  live={live}
                  maximised={item.i === open}
                  reconnect={reconnects[camera.name] ?? 0}
                  refresh={refresh}
                  editing={editing}
                  streamInfo={streamInfo}
                  activity={activity?.[camera.name]}
                  onOpen={() => onMaximise?.(item.i === open ? null : camera.name)}
                  onHide={() => onLayout(hideCamera(fromGridItems(items, hidden, layout), camera.name))}
                  onAutomatic={onAutomatic && ((stream) => onAutomatic(camera.name, stream))}
                  onProblem={onProblem && ((problem) => onProblem(camera.name, problem))}
                  onPlaying={onPlaying && (() => onPlaying(camera.name))}
                />
              </div>
            );
          })}
        </GridLayout>
      </div>
    </div>
  );
}
