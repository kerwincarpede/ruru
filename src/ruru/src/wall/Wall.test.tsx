import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Camera } from "../app/frigate";
import type { GridItem } from "./layout";
import { automaticHeroItems, customHeroItems } from "./dynamic";
import { toGridItems, wallPlacements } from "./layout";
import Wall from "./Wall";

type GridProps = {
  children: ReactNode;
  layout: GridItem[];
  compactType: "vertical" | null;
  isDraggable: boolean;
  isResizable: boolean;
  onResize: (layout: GridItem[], old: GridItem, tile: GridItem, placeholder: GridItem) => void;
  onDragStop: (layout: GridItem[]) => void;
  onResizeStop: (layout: GridItem[]) => void;
};

const grid = vi.hoisted(() => ({ props: null as GridProps | null }));

// react-grid-layout measures the DOM to drag, which jsdom cannot; this
// stand-in hands the test the callbacks the wall gives it.
vi.mock("react-grid-layout", () => ({
  default: (props: GridProps) => {
    grid.props = props;
    return <div>{props.children}</div>;
  },
}));

const camera = (name: string): Camera => ({ name, enabled: true, mainStream: name, subStream: `${name}_sub` });

function renderWall(editing: boolean, lockRatio = true) {
  const onLayout = vi.fn();
  render(
    <Wall
      base="http://f"
      cameras={[camera("a"), camera("b")]}
      layout={{ tiles: [], hidden: ["c"] }}
      live={false}
      editing={editing}
      lockRatio={lockRatio}
      refresh={0}
      onLayout={onLayout}
    />,
  );
  return onLayout;
}

describe("Wall", () => {
  it("marks the wall with the activity style and each cell with its camera's activity", () => {
    render(
      <Wall
        base="http://f"
        cameras={[camera("a"), camera("b")]}
        layout={undefined}
        live={false}
        editing={false}
        activity={{ a: { motion: true, objects: {}, review: "alert" } }}
        activityStyle="corners"
        refresh={0}
        onLayout={vi.fn()}
      />,
    );
    const [a, b] = screen.getAllByRole("figure");
    expect(a.closest(".wall")).toHaveClass("activity-corners");
    expect(a.parentElement).toHaveClass("has-motion", "is-alert");
    expect(b.parentElement).not.toHaveClass("has-motion");
    expect(b.parentElement).not.toHaveClass("is-alert");
  });

  it("draws the Dynamic wall's placements exactly as computed, and compacts only the saved layout", () => {
    const names = Array.from({ length: 10 }, (_, index) => `cam${index}`);
    const size = { width: window.innerWidth, height: window.innerHeight };
    const props = { base: "http://f", cameras: names.map(camera), live: false, editing: false, refresh: 0, onLayout: vi.fn() };
    const { rerender } = render(<Wall {...props} layout={undefined} />);
    expect(grid.props?.compactType).toBe("vertical");
    const saved = grid.props?.layout;
    // One hero leaves room beside it, which compacting would fill.
    rerender(<Wall {...props} layout={undefined} dynamic={{ kind: "heroes", heroes: ["cam4"] }} />);
    const one = automaticHeroItems(names, ["cam4"], size);
    expect(one).not.toBeNull();
    expect(grid.props?.layout).toEqual(one);
    expect(grid.props?.compactType).toBeNull();
    rerender(<Wall {...props} layout={undefined} dynamic={{ kind: "heroes", heroes: ["cam4", "cam8"] }} />);
    expect(grid.props?.layout).toEqual(automaticHeroItems(names, ["cam4", "cam8"], size));
    const items = toGridItems(wallPlacements(names, undefined));
    rerender(<Wall {...props} layout={undefined} heroSlots={["cam0", "cam1"]} dynamic={{ kind: "heroes", heroes: ["cam9"] }} />);
    expect(grid.props?.layout).toEqual(customHeroItems(items, ["cam0", "cam1"], ["cam9"]));
    expect(grid.props?.compactType).toBeNull();
    rerender(<Wall {...props} layout={undefined} />);
    expect(grid.props?.layout).toEqual(saved);
    expect(grid.props?.compactType).toBe("vertical");
  });

  it("drags and resizes only in Edit layout mode", () => {
    renderWall(false);
    expect(grid.props?.isDraggable).toBe(false);
    expect(grid.props?.isResizable).toBe(false);
    expect(screen.getAllByRole("figure")).toHaveLength(2);
  });

  it.each([true, false])("constrains the tile and preview only with the lock on (%s)", (locked) => {
    renderWall(true, locked);
    const tile = { i: "a", x: 0, y: 0, w: 8, h: 3 };
    const preview = { ...tile };
    grid.props?.onResize([tile], tile, tile, preview);
    expect(tile.h).toBe(locked ? 8 : 3);
    expect(preview.h).toBe(tile.h);
  });

  it("saves the layout after a drag or a resize, keeping hidden cameras", () => {
    const onLayout = renderWall(true);
    expect(grid.props?.isDraggable).toBe(true);
    const moved = [
      { i: "a", x: 12, y: 0, w: 12, h: 12 },
      { i: "b", x: 0, y: 0, w: 12, h: 12 },
    ];
    grid.props?.onDragStop(moved);
    expect(onLayout).toHaveBeenLastCalledWith({
      tiles: [
        { camera: "a", x: 12, y: 0, w: 12, h: 12 },
        { camera: "b", x: 0, y: 0, w: 12, h: 12 },
      ],
      hidden: ["c"],
    });
    grid.props?.onResizeStop([{ i: "a", x: 0, y: 0, w: 6, h: 4 }]);
    expect(onLayout).toHaveBeenLastCalledWith({ tiles: [{ camera: "a", x: 0, y: 0, w: 6, h: 4 }], hidden: ["c"] });
  });
});
