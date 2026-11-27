import { fireEvent, render, screen } from "@testing-library/react";
import type { CSSProperties, ReactNode, Ref } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Camera } from "../app/frigate";
import type { GridItem } from "./layout";
import type { StreamKind } from "./streams";
import { automaticHeroItems, customHeroItems } from "./dynamic";
import { fitWidth, gridRows, toGridItems, wallPlacements } from "./layout";
import Wall from "./Wall";

type GridProps = {
  width: number;
  style: CSSProperties;
  innerRef: Ref<HTMLDivElement>;
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
    return <div ref={props.innerRef} style={props.style}>{props.children}</div>;
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

  it("keeps the wall container constant across overview and heroes without toggling is-fit", () => {
    const names = Array.from({ length: 10 }, (_, index) => `cam${index}`);
    const props = { base: "http://f", cameras: names.map(camera), live: false, editing: false, refresh: 0, onLayout: vi.fn() };
    const { rerender } = render(<Wall {...props} layout={undefined} fitToWindow={false} />);
    const wall = screen.getAllByRole("figure")[0].closest(".wall") as HTMLElement;
    const fitted = wall.firstElementChild as HTMLElement;
    expect(wall).not.toHaveClass("is-fit", "is-dynamic", "is-editing");
    expect(fitted.style.width).toBe(`${window.innerWidth}px`);
    expect(grid.props?.width).toBe(window.innerWidth);
    rerender(<Wall {...props} layout={undefined} fitToWindow={false} dynamic={{ kind: "heroes", heroes: ["cam4"] }} />);
    expect(wall).not.toHaveClass("is-fit");
    expect(wall).toHaveClass("is-dynamic");
    expect(fitted.style.width).toBe(`${window.innerWidth}px`);
    expect(fitted.firstElementChild).toHaveStyle({ width: `${grid.props?.width}px` });
    rerender(<Wall {...props} layout={undefined} fitToWindow dynamic={{ kind: "overview" }} />);
    expect(wall).not.toHaveClass("is-fit", "is-dynamic");
    const items = toGridItems(wallPlacements(names, undefined));
    const expected = fitWidth(window.innerWidth, window.innerHeight, gridRows(items));
    expect(fitted.style.width).toBe(`${expected}px`);
    expect(grid.props?.width).toBe(expected);
  });

  it("keeps the active hero layout underneath a takeover", () => {
    const names = Array.from({ length: 10 }, (_, index) => `cam${index}`);
    const size = { width: window.innerWidth, height: window.innerHeight };
    const props = { base: "http://f", cameras: names.map(camera), live: false, editing: false, refresh: 0, onLayout: vi.fn() };
    const heroLayout = automaticHeroItems(names, ["cam4", "cam8"], size);
    const { rerender } = render(<Wall {...props} layout={undefined} dynamic={{ kind: "heroes", heroes: ["cam4", "cam8"] }} />);
    expect(grid.props?.layout).toEqual(heroLayout);

    rerender(<Wall {...props} layout={undefined} dynamic={{ kind: "takeover", camera: "cam4", heroes: ["cam4", "cam8"] }} />);
    expect(grid.props?.layout).toEqual(heroLayout);
    expect(grid.props?.compactType).toBeNull();
    const cam4 = screen.getByRole("figure", { name: "Cam4" });
    expect(cam4).toHaveClass("is-maximised");
    expect(cam4.parentElement).toHaveClass("is-takeover", "is-maximised", "is-hero");

    // A takeover with no active heroes leaves the saved overview layout underneath.
    rerender(<Wall {...props} layout={undefined} dynamic={{ kind: "takeover", camera: "cam4", heroes: [] }} />);
    expect(grid.props?.layout).toEqual(toGridItems(wallPlacements(names, undefined)));
    expect(grid.props?.compactType).toBe("vertical");
    expect(cam4).toHaveClass("is-maximised");
    expect(cam4.parentElement).toHaveClass("is-takeover");
  });

  it("keeps the same takeover cell over the visible wall as the wall scrolls and resizes", () => {
    const props = { base: "http://f", cameras: [camera("a"), camera("b")], live: false, editing: false, layout: undefined, refresh: 0, onLayout: vi.fn() };
    const { rerender } = render(<Wall {...props} />);
    const tile = screen.getByRole("figure", { name: "A" });
    const cell = tile.parentElement!;
    const layoutGrid = cell.parentElement!;
    const wall = tile.closest(".wall")!;
    let viewportWidth = 900;
    let scroll = 60;
    Object.defineProperties(wall, {
      clientWidth: { get: () => viewportWidth },
      clientHeight: { value: 600 },
    });
    vi.spyOn(wall, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 24, 900, 600));
    vi.spyOn(layoutGrid, "getBoundingClientRect").mockImplementation(() => new DOMRect(30, 24 - scroll, 840, 1000));
    rerender(<Wall {...props} dynamic={{ kind: "takeover", camera: "a", heroes: [] }} />);
    expect(screen.getByRole("figure", { name: "A" }).parentElement).toBe(cell);
    expect(cell.style.getPropertyValue("--takeover-left")).toBe("-30px");
    expect(cell.style.getPropertyValue("--takeover-top")).toBe("60px");
    expect(cell.style.getPropertyValue("--takeover-width")).toBe("900px");
    expect(cell.style.getPropertyValue("--takeover-height")).toBe("600px");

    scroll = 120;
    fireEvent.scroll(wall);
    expect(cell.style.getPropertyValue("--takeover-top")).toBe("120px");
    viewportWidth = 1000;
    fireEvent.resize(window);
    expect(cell.style.getPropertyValue("--takeover-width")).toBe("1000px");

    rerender(<Wall {...props} />);
    expect(cell.style.getPropertyValue("--takeover-width")).toBe("");
  });

  it("picks Automatic streams from the saved layout during heroes and takeovers, and from window width on manual maximise", () => {
    const names = Array.from({ length: 10 }, (_, index) => `cam${index}`);
    const automatic = new Map<string, StreamKind>();
    const onAutomatic = (name: string, stream: StreamKind) => { automatic.set(name, stream); };
    const props = { base: "http://f", cameras: names.map(camera), live: false, editing: false, refresh: 0, onLayout: vi.fn(), onAutomatic };
    const { rerender, unmount } = render(<Wall {...props} layout={undefined} />);
    expect(automatic.get("cam4")).toBe("sub");

    // Becoming a large hero or taking over the wall keeps the saved-layout stream.
    rerender(<Wall {...props} layout={undefined} dynamic={{ kind: "heroes", heroes: ["cam4"] }} />);
    expect(automatic.get("cam4")).toBe("sub");
    rerender(<Wall {...props} layout={undefined} dynamic={{ kind: "takeover", camera: "cam4", heroes: ["cam4"] }} />);
    expect(automatic.get("cam4")).toBe("sub");

    // Manually maximising uses window width and switches Automatic to main.
    rerender(<Wall {...props} layout={undefined} maximised="cam4" dynamic={{ kind: "takeover", camera: "cam4", heroes: ["cam4"] }} />);
    expect(automatic.get("cam4")).toBe("main");

    // A tile whose saved layout is already wide enough plays main in overview too.
    const wide = {
      tiles: names.map((name, index) => ({ camera: name, x: 0, y: index * 24, w: 24, h: 24 })),
      hidden: [],
    };
    unmount();
    render(<Wall {...props} layout={wide} />);
    expect(automatic.get("cam4")).toBe("main");
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
