import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Camera } from "../app/frigate";
import type { GridItem } from "./layout";
import Wall from "./Wall";

type GridProps = {
  children: ReactNode;
  layout: GridItem[];
  isDraggable: boolean;
  isResizable: boolean;
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

function renderWall(editing: boolean) {
  const onLayout = vi.fn();
  render(
    <Wall
      base="http://f"
      cameras={[camera("a"), camera("b")]}
      layout={{ tiles: [], hidden: ["c"] }}
      live={false}
      editing={editing}
      refresh={0}
      onLayout={onLayout}
    />,
  );
  return onLayout;
}

describe("Wall", () => {
  it("drags and resizes only in Edit layout mode", () => {
    renderWall(false);
    expect(grid.props?.isDraggable).toBe(false);
    expect(grid.props?.isResizable).toBe(false);
    expect(screen.getAllByRole("figure")).toHaveLength(2);
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
