import type { ActivityStyle } from "../app/api";
import { cameraLabel } from "../app/frigate";

/** An object chip's text: `person` is "Person", two cars are "Car ×2". */
export function objectChip(label: string, count: number): string {
  return count > 1 ? `${cameraLabel(label)} ×${count}` : cameraLabel(label);
}

/** Each way a tile can mark motion and alerts, in the order Settings offers them. */
export const ACTIVITY_STYLES: { value: ActivityStyle; title: string; hint: string }[] = [
  { value: "ring", title: "Outline between tiles", hint: "An outline in the gap around the tile, so none of the picture is covered. The name turns red during an alert." },
  { value: "outline", title: "Thin outline", hint: "A thin outline just inside the edge of the picture. The name turns red during an alert." },
  { value: "corners", title: "Corner marks", hint: "Marks on the picture’s four corners only, larger during an alert." },
  { value: "strip", title: "Top edge", hint: "A thin bar along the top of the picture." },
  { value: "caption", title: "Name only", hint: "During an alert the name turns red with a pulsing dot. Motion gets a thin outline." },
];
