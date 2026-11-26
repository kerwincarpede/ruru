import { describe, expect, it } from "vitest";
import type { Activity } from "../app/api";
import { HERO_GRACE_MS, HERO_HOLD_MS, IDLE, dismissDynamic, dynamicView, nextExpiry, seesObjects, stepDynamic, type DynamicState } from "./heroes";

const cameras = ["maingate", "garage", "yard", "drive"];
const objects = (counts: Record<string, number>) => ({ motion: true, objects: counts, review: "detection" as const });
const car = objects({ car: 1 });
const person = objects({ person: 1 });

/** Steps through `events` in order, each at its time. */
function run(events: [number, Activity][], priority: string[] = [], start: DynamicState = IDLE): DynamicState {
  return events.reduce((state, [now, activity]) => stepDynamic(state, { cameras, activity, priority, now }), start);
}

describe("stepDynamic", () => {
  it("counts only positive object counts", () => {
    expect(seesObjects(objects({ car: 0 }))).toBe(false);
    expect(seesObjects({ motion: true, objects: {}, review: "alert" })).toBe(false);
    expect(seesObjects(car)).toBe(true);
  });

  it("ignores the left-out objects when picking heroes", () => {
    expect(seesObjects(objects({ dog: 1 }), ["dog"])).toBe(false);
    expect(seesObjects(objects({ dog: 1, car: 1 }), ["dog"])).toBe(true);
    const dog = objects({ dog: 2 });
    const state = stepDynamic(IDLE, { cameras, activity: { yard: dog, drive: car }, priority: [], ignored: ["dog"], now: 0 });
    expect(dynamicView(state)).toEqual({ kind: "heroes", heroes: ["drive"] });
    // A takeover still needs a person, whatever is left out.
    const gate = stepDynamic(IDLE, { cameras, activity: { maingate: person }, priority: ["maingate"], ignored: ["person"], now: 0 });
    expect(dynamicView(gate)).toEqual({ kind: "takeover", camera: "maingate" });
  });

  it("picks two active cameras in wall order and keeps the pair when more arrive", () => {
    let state = run([[0, { yard: car, garage: car }]]);
    expect(dynamicView(state)).toEqual({ kind: "heroes", heroes: ["garage", "yard"] });
    state = run([[1000, { yard: car, garage: car, maingate: car }]], [], state);
    expect(dynamicView(state)).toEqual({ kind: "heroes", heroes: ["garage", "yard"] });
  });

  it("holds a hero for the minimum hold and the clearing grace, then fills its place", () => {
    let state = run([[0, { garage: car, yard: car }]]);
    // Cleared after 8 s: the grace from then outlasts the 10 s hold.
    state = run([[8000, { yard: car }]], [], state);
    expect(dynamicView(state)).toEqual({ kind: "heroes", heroes: ["garage", "yard"] });
    expect(nextExpiry(state, { cameras, activity: { yard: car }, priority: [], now: 8000 })).toBe(Math.max(HERO_HOLD_MS, 8000 + HERO_GRACE_MS));
    // Cleared after the hold: the grace lasts 5 s from when it cleared.
    state = run([[2000, { garage: car, yard: car }], [12_000, { garage: car, yard: car }], [13_000, { yard: car, drive: car }]]);
    expect(dynamicView(state)).toEqual({ kind: "heroes", heroes: ["garage", "yard"] });
    state = run([[13_000 + HERO_GRACE_MS - 1, { yard: car, drive: car }]], [], state);
    expect(dynamicView(state)).toEqual({ kind: "heroes", heroes: ["garage", "yard"] });
    state = run([[13_000 + HERO_GRACE_MS, { yard: car, drive: car }]], [], state);
    // The garage's place goes to the drive; the yard keeps its own.
    expect(dynamicView(state)).toEqual({ kind: "heroes", heroes: ["drive", "yard"] });
    state = run([[30_000, {}], [30_000 + HERO_GRACE_MS, {}]], [], state);
    expect(dynamicView(state)).toEqual({ kind: "overview" });
    expect(nextExpiry(state, { cameras, activity: {}, priority: [], now: 35_000 })).toBeNull();
  });

  it("starts the grace when a camera clears, however long it was busy without a change", () => {
    let state = run([[0, { garage: car }]], ["garage"]);
    state = run([[30_000, {}]], ["garage"], state);
    expect(dynamicView(state)).toEqual({ kind: "heroes", heroes: ["garage"] });
    expect(nextExpiry(state, { cameras, activity: {}, priority: [], now: 30_000 })).toBe(30_000 + HERO_GRACE_MS);
    state = run([[30_000 + HERO_GRACE_MS, {}]], ["garage"], state);
    expect(dynamicView(state)).toEqual({ kind: "overview" });
    // A priority camera's takeover gets the same grace.
    state = run([[0, { yard: person }], [30_000, {}]], ["yard"]);
    expect(dynamicView(state)).toEqual({ kind: "takeover", camera: "yard" });
    state = run([[30_000 + HERO_GRACE_MS, {}]], ["yard"], state);
    expect(dynamicView(state)).toEqual({ kind: "overview" });
  });

  it("forgets cameras that leave the wall", () => {
    const state = run([[0, { garage: car }]]);
    expect(dynamicView(stepDynamic(state, { cameras: ["maingate"], activity: { garage: car }, priority: [], now: 1 }))).toEqual({ kind: "overview" });
  });

  it("lets a person at a priority camera take the wall, breaking ties in wall order", () => {
    const state = run([[0, { yard: person, drive: person, garage: car }]], ["drive", "yard"]);
    expect(dynamicView(state)).toEqual({ kind: "takeover", camera: "yard" });
    // A person at a camera that is not a priority camera only makes it a hero.
    expect(dynamicView(run([[0, { garage: person }]]))).toEqual({ kind: "heroes", heroes: ["garage"] });
  });

  it("holds the current priority camera, then returns to the heroes", () => {
    let state = run([[0, { drive: person }], [9000, { drive: person, yard: person, garage: car }]], ["drive", "yard"]);
    expect(dynamicView(state)).toEqual({ kind: "takeover", camera: "drive" });
    state = run([[12_000, { yard: person, garage: car }]], ["drive", "yard"], state);
    expect(dynamicView(state)).toEqual({ kind: "takeover", camera: "drive" });
    state = run([[12_000 + HERO_GRACE_MS, { yard: person, garage: car }]], ["drive", "yard"], state);
    expect(dynamicView(state)).toEqual({ kind: "takeover", camera: "yard" });
    state = run([[40_000, { garage: car }], [50_000, { garage: car }]], ["drive", "yard"], state);
    expect(dynamicView(state)).toEqual({ kind: "heroes", heroes: ["garage"] });
  });

  it("dismisses the takeover, then the heroes, until their activity clears", () => {
    const busy = { yard: person, garage: car };
    let state = run([[0, busy]], ["yard"]);
    state = dismissDynamic(state, { cameras, activity: busy, priority: ["yard"] });
    expect(dynamicView(state)).toEqual({ kind: "heroes", heroes: ["garage", "yard"] });
    state = run([[1000, busy]], ["yard"], state);
    expect(dynamicView(state)).toEqual({ kind: "heroes", heroes: ["garage", "yard"] });
    state = dismissDynamic(state, { cameras, activity: busy, priority: ["yard"] });
    expect(dynamicView(state)).toEqual({ kind: "overview" });
    expect(dismissDynamic(state, { cameras, activity: busy, priority: ["yard"] })).toBe(state);
    state = run([[2000, busy]], ["yard"], state);
    expect(dynamicView(state)).toEqual({ kind: "overview" });
    // Once the activity clears, new activity counts again.
    state = run([[3000, {}], [4000, { yard: person }]], ["yard"], state);
    expect(dynamicView(state)).toEqual({ kind: "takeover", camera: "yard" });
  });

  it("dismisses every camera busy when Esc is pressed, not only the ones shown", () => {
    const busy = { garage: car, yard: person, drive: person };
    const priority = ["yard", "drive"];
    let state = run([[0, busy]], priority);
    expect(dynamicView(state)).toEqual({ kind: "takeover", camera: "yard" });
    state = dismissDynamic(state, { cameras, activity: busy, priority });
    // The drive also sees a person, so it does not take over in the yard's place.
    state = run([[1000, busy]], priority, state);
    expect(dynamicView(state)).toEqual({ kind: "heroes", heroes: ["garage", "yard"] });
    state = dismissDynamic(state, { cameras, activity: busy, priority });
    // The drive was busy too, so it does not fill a freed hero place.
    state = run([[2000, busy]], priority, state);
    expect(dynamicView(state)).toEqual({ kind: "overview" });
    // A camera that gets busy after Esc still counts.
    state = run([[3000, { ...busy, maingate: car }]], priority, state);
    expect(dynamicView(state)).toEqual({ kind: "heroes", heroes: ["maingate"] });
  });
});
