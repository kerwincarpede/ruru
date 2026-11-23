import { cameraLabel } from "../app/frigate";

/** An object chip's text: `person` is "Person", two cars are "Car ×2". */
export function objectChip(label: string, count: number): string {
  return count > 1 ? `${cameraLabel(label)} ×${count}` : cameraLabel(label);
}
