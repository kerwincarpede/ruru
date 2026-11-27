import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./wall.css";
import { useEffect, useMemo, useRef, useState } from "react";
import GridLayout from "react-grid-layout";
import type { Camera } from "../app/frigate";
import type { Activity, ActivityStyle, SavedLayout } from "../app/api";
import { heroItems, spanWidth, type WallSize } from "./dynamic";
import type { DynamicView } from "./heroes";
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
  /** Told whether each camera's tile is reconnecting or frozen right now. */
  onReconnecting?: (camera: string, reconnecting: boolean) => void;
  /** The layout changed in Edit layout mode and should be saved. */
  onLayout: (layout: SavedLayout) => void;
  /** What the Dynamic wall shows for now; the saved layout is left as it is. */
  dynamic?: DynamicView;
  /** The Dynamic wall's custom hero slots; empty for the automatic layout. */
  heroSlots?: string[];
  /** Told the wall area's size whenever it changes. */
  onSize?: (size: WallSize) => void;
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
  onReconnecting,
  onLayout,
  dynamic,
  heroSlots = [],
  onSize,
}: WallProps) {
  const [box, size] = useSize();
  useEffect(() => onSize?.(size), [size, onSize]);
  const names = useMemo(() => cameras.map((camera) => camera.name), [cameras]);
  const items = useMemo(() => toGridItems(wallPlacements(names, layout)), [names, layout]);
  const byName = useMemo(() => new Map(cameras.map((camera) => [camera.name, camera])), [cameras]);
  const hidden = layout?.hidden ?? [];
  const open = maximised && items.some((item) => item.i === maximised) ? maximised : null;
  // Maximising a tile and Edit layout come before the Dynamic wall. Its
  // views only move tiles or draw one over the rest, so every tile stays
  // mounted and keeps playing.
  const view = !open && !editing ? dynamic : undefined;
  const heroes = view?.kind === "heroes" || view?.kind === "takeover" ? (view.heroes.length ? view.heroes : null) : null;
  const moved = useMemo(() => (heroes ? heroItems(items, heroSlots, heroes, size) : null), [heroes, items, heroSlots, size]);
  const shown = moved ?? items;
  const takeover = view?.kind === "takeover" && items.some((item) => item.i === view.camera) ? view.camera : null;
  const full = open ?? takeover;
  const overviewWidth = fitToWindow ? fitWidth(size.width, size.height, gridRows(items)) : size.width;
  const width = fitToWindow || moved ? fitWidth(size.width, size.height, gridRows(shown)) : size.width;

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
    <div ref={box} className={`wall activity-${activityStyle}${editing ? " is-editing" : ""}${moved ? " is-dynamic" : ""}`}>
      <div className="wall-fit" style={fitToWindow || moved ? { width } : undefined}>
        <GridLayout
          className={lockRatio ? "wall-grid lock-ratio" : "wall-grid"}
          width={width}
          cols={COLUMNS}
          rowHeight={rowHeight(width)}
          margin={[GAP, GAP * ROW_RATIO]}
          containerPadding={[GAP, GAP]}
          layout={shown}
          // The Dynamic wall's placements are drawn exactly as computed; the
          // saved layout keeps the grid's usual pull towards the top.
          compactType={moved ? null : "vertical"}
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
          {/* Children keep their order as tiles move, so no video element is moved in the page. */}
          {items.map((item) => {
            const camera = byName.get(item.i) as Camera;
            // The cell carries the activity too: the Outline between tiles style draws in the gap around it.
            const seen = activity?.[camera.name];
            const cell = ["wall-cell", item.i === full && "is-maximised", item.i === takeover && "is-takeover", heroes?.includes(item.i) && moved && "is-hero", seen?.motion && "has-motion", seen?.review === "alert" && "is-alert"].filter(Boolean).join(" ");
            return (
              <div key={item.i} className={cell}>
                <Tile
                  base={base}
                  camera={camera}
                  choice={choiceFor(camera)}
                  live={live}
                  maximised={item.i === full}
                  takeover={item.i === takeover}
                  savedWidth={Math.max(0, spanWidth(overviewWidth, item.w))}
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
                  onReconnecting={onReconnecting && ((reconnecting) => onReconnecting(camera.name, reconnecting))}
                />
              </div>
            );
          })}
        </GridLayout>
      </div>
    </div>
  );
}
