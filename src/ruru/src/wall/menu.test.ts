import { describe, expect, it, vi } from "vitest";
import { tileMenu, type TileMenuOptions } from "./menu";

const options = (overrides: Partial<TileMenuOptions> = {}): TileMenuOptions => ({
  label: "Garage",
  maximised: false,
  twoStreams: true,
  choice: undefined,
  automatic: "sub",
  streamInfo: false,
  onMaximise: vi.fn(),
  onReconnect: vi.fn(),
  onHide: vi.fn(),
  onStreamInfo: vi.fn(),
  onStream: vi.fn(),
  ...overrides,
});

const labels = (sections: ReturnType<typeof tileMenu>) => sections.map((section) => section.items.map((item) => item.label));

describe("tileMenu", () => {
  it("heads the camera's actions with its name, then its stream choices", () => {
    const sections = tileMenu(options());
    expect(sections.map((section) => section.label)).toEqual(["Garage", undefined]);
    expect(sections[1].name).toBe("Stream");
    expect(labels(sections)).toEqual([
      ["Maximise", "Reconnect", "Hide", "Show stream info"],
      ["Automatic (Sub)", "Main stream", "Sub stream"],
    ]);
    expect(sections[1].items.map((item) => item.checked)).toEqual([true, false, false]);
    expect(sections[0].items[3]).toMatchObject({ kind: "checkbox", checked: false });
  });

  it("says what Automatic plays, ticks the saved choice and offers Restore when maximised", () => {
    const sections = tileMenu(options({ maximised: true, automatic: "main", choice: "sub", streamInfo: true }));
    expect(labels(sections)[0][0]).toBe("Restore");
    expect(sections[0].items[3].checked).toBe(true);
    expect(sections[1].items.map((item) => [item.label, item.checked])).toEqual([
      ["Automatic (Main)", false],
      ["Main stream", false],
      ["Sub stream", true],
    ]);
  });

  it("leaves out the stream choice for a camera with one stream", () => {
    expect(labels(tileMenu(options({ twoStreams: false })))).toEqual([["Maximise", "Reconnect", "Hide", "Show stream info"]]);
  });

  it("calls the matching action", () => {
    const given = options();
    const [actions, streams] = tileMenu(given);
    actions.items.forEach((item) => item.onSelect());
    streams.items.forEach((item) => item.onSelect());
    expect(given.onMaximise).toHaveBeenCalledOnce();
    expect(given.onReconnect).toHaveBeenCalledOnce();
    expect(given.onHide).toHaveBeenCalledOnce();
    expect(given.onStreamInfo).toHaveBeenCalledOnce();
    expect(vi.mocked(given.onStream).mock.calls).toEqual([[undefined], ["main"], ["sub"]]);
  });
});
