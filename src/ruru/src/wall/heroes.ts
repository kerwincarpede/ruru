import type { Activity, CameraActivity } from "../app/api";

/** The shortest a camera stays a hero, or keeps the wall, once picked. */
export const HERO_HOLD_MS = 10_000;
/** How long a hero, or a takeover, stays after Frigate stops seeing its objects. */
export const HERO_GRACE_MS = 5_000;

/**
 * A camera the Dynamic wall picked: when it was picked, when it last
 * qualified (or stopped qualifying, which starts the grace), and whether it
 * qualified at the last step.
 */
export interface Pick {
  camera: string;
  since: number;
  seen: number;
  qualified: boolean;
}

/** What the Dynamic wall shows and what it was told to put away. */
export interface DynamicState {
  /** Two hero places; a hero keeps its place while it stays. */
  heroes: [Pick | null, Pick | null];
  /** The priority camera filling the wall, if any. */
  takeover: Pick | null;
  /** Cameras put away with `Esc`, until their activity clears. */
  dismissed: { heroes: string[]; takeover: string[] };
}

/** Nothing picked. */
export const IDLE: DynamicState = { heroes: [null, null], takeover: null, dismissed: { heroes: [], takeover: [] } };

/** What Frigate says, and where, for one step. */
export interface DynamicInput {
  /** The cameras on the wall, in the saved wall order. */
  cameras: string[];
  activity: Activity;
  /** The cameras that take the wall while Frigate sees a person. */
  priority: string[];
  now: number;
}

/** Frigate sees at least one object on the camera. */
export function seesObjects(activity: CameraActivity | undefined): boolean {
  return Object.values(activity?.objects ?? {}).some((count) => count > 0);
}

/** Frigate sees at least one person on the camera. */
export function seesPerson(activity: CameraActivity | undefined): boolean {
  return (activity?.objects.person ?? 0) > 0;
}

/** A pick stays while it qualifies, through the grace after it clears, and for the minimum hold. */
function stays(pick: Pick, qualifies: boolean, now: number): boolean {
  return qualifies || now - pick.seen < HERO_GRACE_MS || now - pick.since < HERO_HOLD_MS;
}

function qualifiers({ cameras, activity, priority }: Omit<DynamicInput, "now">) {
  const onWall = new Set(cameras);
  return {
    hero: (camera: string) => onWall.has(camera) && seesObjects(activity[camera]),
    takeover: (camera: string) => onWall.has(camera) && priority.includes(camera) && seesPerson(activity[camera]),
  };
}

/**
 * The next state for what Frigate says now. Heroes keep their places while
 * they stay, and free places fill with active cameras in wall order. The
 * current takeover holds while it stays; otherwise the first priority
 * camera with a person, in wall order, takes the wall.
 */
export function stepDynamic(state: DynamicState, input: DynamicInput): DynamicState {
  const { now, cameras } = input;
  const qualifies = qualifiers(input);
  const dismissed = { heroes: state.dismissed.heroes.filter(qualifies.hero), takeover: state.dismissed.takeover.filter(qualifies.takeover) };
  const keep = (pick: Pick | null, test: (camera: string) => boolean, put: string[]): Pick | null => {
    if (!pick || !cameras.includes(pick.camera) || put.includes(pick.camera)) return null;
    const qualifying = test(pick.camera);
    // Activity only arrives when it changes, so the grace runs from the step
    // that saw the camera clear, not from the last step before it.
    const next = qualifying || pick.qualified ? { ...pick, seen: now, qualified: qualifying } : pick;
    return stays(next, qualifying, now) ? next : null;
  };
  const heroes = state.heroes.map((pick) => keep(pick, qualifies.hero, dismissed.heroes)) as DynamicState["heroes"];
  for (const camera of cameras) {
    const place = heroes.indexOf(null);
    if (place < 0) break;
    if (qualifies.hero(camera) && !dismissed.heroes.includes(camera) && !heroes.some((pick) => pick?.camera === camera)) {
      heroes[place] = { camera, since: now, seen: now, qualified: true };
    }
  }
  let takeover = keep(state.takeover, qualifies.takeover, dismissed.takeover);
  if (!takeover) {
    const camera = cameras.find((name) => qualifies.takeover(name) && !dismissed.takeover.includes(name));
    if (camera) takeover = { camera, since: now, seen: now, qualified: true };
  }
  return { heroes, takeover, dismissed };
}

/**
 * The state after `Esc`: a takeover is put away with every priority camera
 * that could take over now, or else the heroes are, with every camera that
 * could become one now. Each stays away until its activity clears.
 */
export function dismissDynamic(state: DynamicState, input: Omit<DynamicInput, "now">): DynamicState {
  const qualifies = qualifiers(input);
  const add = (list: string[], more: string[]) => [...list, ...more.filter((camera) => !list.includes(camera))];
  if (state.takeover) {
    const now = input.cameras.filter(qualifies.takeover);
    return { ...state, takeover: null, dismissed: { ...state.dismissed, takeover: add(state.dismissed.takeover, [state.takeover.camera, ...now]) } };
  }
  const shown = state.heroes.flatMap((pick) => (pick ? [pick.camera] : []));
  if (shown.length === 0) return state;
  const now = input.cameras.filter(qualifies.hero);
  return { ...state, heroes: [null, null], dismissed: { ...state.dismissed, heroes: add(state.dismissed.heroes, [...shown, ...now]) } };
}

/** When a pick that no longer qualifies is next due to go, or null when none is. */
export function nextExpiry(state: DynamicState, input: DynamicInput): number | null {
  const qualifies = qualifiers(input);
  const ends = [
    ...state.heroes.flatMap((pick) => (pick && !qualifies.hero(pick.camera) ? [pick] : [])),
    ...(state.takeover && !qualifies.takeover(state.takeover.camera) ? [state.takeover] : []),
  ].map((pick) => Math.max(pick.seen + HERO_GRACE_MS, pick.since + HERO_HOLD_MS));
  return ends.length ? Math.min(...ends) : null;
}

/** What the wall shows: its saved layout, a hero view, or one camera taking it over. */
export type DynamicView =
  | { kind: "overview" }
  | { kind: "heroes"; heroes: string[] }
  | { kind: "takeover"; camera: string };

/** The view `state` shows. A takeover pre-empts the heroes, which return after it. */
export function dynamicView(state: DynamicState): DynamicView {
  if (state.takeover) return { kind: "takeover", camera: state.takeover.camera };
  const heroes = state.heroes.flatMap((pick) => (pick ? [pick.camera] : []));
  return heroes.length ? { kind: "heroes", heroes } : { kind: "overview" };
}
