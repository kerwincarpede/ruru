import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WallMenu, { type MenuSection } from "./WallMenu";

const sections = (onSelect = vi.fn()): MenuSection[] => [
  { label: "Garage", items: [{ label: "Maximise", onSelect }, { label: "Show stream info", kind: "checkbox", checked: true, onSelect }] },
  { name: "Stream", items: [{ label: "Automatic (Sub)", kind: "radio", checked: true, onSelect }, { label: "Main stream", kind: "radio", checked: false, onSelect }] },
  { items: [{ label: "Settings…", onSelect }] },
];

describe("WallMenu", () => {
  it("heads the camera's group with its name and divides the sections", () => {
    render(<WallMenu x={0} y={0} sections={sections()} onClose={() => {}} />);
    const menu = screen.getByRole("menu", { name: "Garage" });
    expect(within(menu).getByRole("group", { name: "Garage" })).toHaveTextContent("MaximiseShow stream info");
    expect(within(menu).getByRole("group", { name: "Stream" })).toBeInTheDocument();
    expect(within(menu).getAllByRole("separator")).toHaveLength(3);
    expect(screen.getByRole("menuitemcheckbox", { name: "Show stream info" })).toBeChecked();
    expect(screen.getByRole("menuitemradio", { name: "Main stream" })).not.toBeChecked();
  });

  it("moves through the items with the arrow keys, Home and End, wrapping at the ends", () => {
    render(<WallMenu x={0} y={0} sections={sections()} onClose={() => {}} />);
    const menu = screen.getByRole("menu");
    const focused = () => document.activeElement?.textContent;
    expect(focused()).toBe("Maximise");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(focused()).toBe("Show stream info");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(focused()).toBe("Automatic (Sub)");
    fireEvent.keyDown(menu, { key: "End" });
    expect(focused()).toBe("Settings…");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(focused()).toBe("Maximise");
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(focused()).toBe("Settings…");
    fireEvent.keyDown(menu, { key: "Home" });
    expect(focused()).toBe("Maximise");
    fireEvent.keyDown(menu, { key: "a" });
    expect(focused()).toBe("Maximise");
  });

  it("closes on Escape without letting the key reach the window, and on a choice", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    render(<WallMenu x={0} y={0} sections={sections(onSelect)} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowKey);
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings…" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("stays inside the window by its measured size", () => {
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 200, height: 300 } as DOMRect);
    render(<WallMenu x={window.innerWidth - 50} y={window.innerHeight - 50} sections={sections()} onClose={() => {}} />);
    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe(`${window.innerWidth - 204}px`);
    expect(menu.style.top).toBe(`${window.innerHeight - 304}px`);
    measure.mockRestore();
  });
});
