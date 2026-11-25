import { useCallback, useEffect, useState } from "react";
import type { Activity } from "../app/api";
import { IDLE, dismissDynamic, dynamicView, nextExpiry, stepDynamic, type DynamicState, type DynamicView } from "./heroes";

interface DynamicWallOptions {
  /** Dynamic wall is on, Home Assistant is connected and the streams play. */
  enabled: boolean;
  /** The cameras on the wall, in the saved wall order. Keep the same array while it is unchanged. */
  cameras: string[];
  activity: Activity;
  /** When `activity` arrived, in milliseconds since the epoch. */
  activityAt: number;
  /** Keep the same array while it is unchanged. */
  priority: string[];
  /** Changing it, such as for another Frigate server or a lost Home Assistant connection, forgets what was picked. */
  reset: string;
}

/** What the last step saw, and what it picked. */
interface Stepped {
  enabled: boolean;
  cameras: string[];
  activity: Activity;
  priority: string[];
  reset: string;
  now: number;
  state: DynamicState;
}

/**
 * Picks the Dynamic wall's view from Frigate's activity as it changes, and
 * again whenever a pick's hold or grace runs out. Returns the view and a
 * function that dismisses it until its activity clears.
 */
export function useDynamicWall({ enabled, cameras, activity, activityAt, priority, reset }: DynamicWallOptions): [DynamicView, () => void] {
  const [clock, setClock] = useState(activityAt);
  const now = Math.max(clock, activityAt);
  const [stepped, setStepped] = useState<Stepped>({ enabled, cameras, activity, priority, reset, now, state: IDLE });
  if (stepped.enabled !== enabled || stepped.cameras !== cameras || stepped.activity !== activity || stepped.priority !== priority || stepped.reset !== reset || stepped.now !== now) {
    const fresh = !enabled || stepped.reset !== reset;
    const state = fresh ? IDLE : stepDynamic(stepped.state, { cameras, activity, priority, now });
    setStepped({ enabled, cameras, activity, priority, reset, now, state });
  }

  const due = nextExpiry(stepped.state, { cameras, activity, priority, now });
  useEffect(() => {
    if (due === null) return;
    const timer = setTimeout(() => setClock(Math.max(Date.now(), due)), Math.max(0, due - Date.now()));
    return () => clearTimeout(timer);
  }, [due]);

  const dismiss = useCallback(() => setStepped((last) => ({ ...last, state: dismissDynamic(last.state, last) })), []);
  return [enabled ? dynamicView(stepped.state) : { kind: "overview" }, dismiss];
}
