import type { StreamKind } from "./streams";

/** One choice in the right-click menu. `kind` makes it a radio button or a checkbox. */
export interface MenuItem {
  label: string;
  onSelect: () => void;
  checked?: boolean;
  kind?: "radio" | "checkbox";
}

/**
 * A group of menu items. A `label` shows as a heading above the group;
 * `name` only names it for assistive technology.
 */
export interface MenuSection {
  label?: string;
  name?: string;
  items: MenuItem[];
}

export interface TileMenuOptions {
  /** The camera's name as people read it. */
  label: string;
  maximised: boolean;
  /** The camera has separate main and sub streams to choose between. */
  twoStreams: boolean;
  /** The saved stream choice; undefined is Automatic. */
  choice: StreamKind | undefined;
  /** What Automatic plays on this tile right now. */
  automatic: StreamKind;
  streamInfo: boolean;
  onMaximise: () => void;
  onReconnect: () => void;
  onHide: () => void;
  onStreamInfo: () => void;
  onStream: (choice: StreamKind | undefined) => void;
}

const STREAM_NAMES: Record<StreamKind, string> = { main: "Main", sub: "Sub" };

/** The right-click menu's sections for one camera's tile, above the wall's own items. */
export function tileMenu(options: TileMenuOptions): MenuSection[] {
  const sections: MenuSection[] = [
    {
      label: options.label,
      items: [
        { label: options.maximised ? "Restore" : "Maximise", onSelect: options.onMaximise },
        { label: "Reconnect", onSelect: options.onReconnect },
        { label: "Hide", onSelect: options.onHide },
        { label: "Show stream info", kind: "checkbox", checked: options.streamInfo, onSelect: options.onStreamInfo },
      ],
    },
  ];
  if (options.twoStreams) {
    sections.push({
      name: "Stream",
      items: ([undefined, "main", "sub"] as const).map((stream) => ({
        label: stream ? `${STREAM_NAMES[stream]} stream` : `Automatic (${STREAM_NAMES[options.automatic]})`,
        kind: "radio" as const,
        checked: stream === options.choice,
        onSelect: () => options.onStream(stream),
      })),
    });
  }
  return sections;
}
