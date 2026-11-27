import { reportPlayback, type StreamPlayback } from "../app/api";

/**
 * Playback counters for each MSE stream, sent to Ruru's journal once a
 * minute while any player runs. Numbers only: no camera names, and nothing
 * leaves the computer.
 */

/** How often the counters are sent. */
export const REPORT_MS = 60 * 1000;

/** Why MSE playback paused: a first-frame hold-back, late frames, missing frames, or getting too close to the newest frame. */
export type PauseReason = "start" | "late" | "missing" | "close";

/** One stream's counters, for the player to fill in. */
export interface PlaybackCounter {
  connected(): void;
  paused(reason: PauseReason): void;
  skipped(): void;
  arrived(): void;
  presented(frames: number): void;
  /** A frame shown `bySeconds` after its turn. */
  late(bySeconds: number): void;
  /** How far behind the newest frame playback is, and the stream's frame interval when known. */
  lag(seconds: number, frameInterval?: number): void;
  /** The player stopped: its counters go in the next report, then it is forgotten. */
  close(): void;
}

interface Counts extends StreamPlayback {
  players: number;
}

const empty = (): Counts => ({
  connections: 0,
  pausesStart: 0,
  pausesLate: 0,
  pausesMissing: 0,
  pausesClose: 0,
  skips: 0,
  arrived: 0,
  presented: 0,
  late: 0,
  worstLateMs: 0,
  lagS: 0,
  lagFrames: 0,
  players: 0,
});

const streams = new Map<string, Counts>();
let timer: ReturnType<typeof setInterval> | null = null;

/** Starts counting one player's stream. */
export function openPlaybackCounter(key: string): PlaybackCounter {
  const counts = streams.get(key) ?? empty();
  streams.set(key, counts);
  counts.players++;
  timer ??= setInterval(sendPlayback, REPORT_MS);
  const pauseKeys = { start: "pausesStart", late: "pausesLate", missing: "pausesMissing", close: "pausesClose" } as const;
  return {
    connected: () => void counts.connections++,
    paused: (reason) => void counts[pauseKeys[reason]]++,
    skipped: () => void counts.skips++,
    arrived: () => void counts.arrived++,
    presented: (frames) => {
      if (frames > 0) counts.presented += frames;
    },
    late: (bySeconds) => {
      counts.late++;
      counts.worstLateMs = Math.max(counts.worstLateMs, Math.round(bySeconds * 1000));
    },
    lag: (seconds, frameInterval) => {
      counts.lagS = round(Math.max(0, seconds));
      counts.lagFrames = frameInterval ? round(Math.max(0, seconds) / frameInterval) : 0;
    },
    close: () => {
      counts.players--;
    },
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

/** Sends each stream’s counters since the last report, then starts the counts again. */
function sendPlayback(): void {
  if (streams.size === 0) return;
  const report: StreamPlayback[] = [];
  for (const [key, counts] of streams) {
    const { players, ...numbers } = counts;
    report.push(numbers);
    if (players === 0) streams.delete(key);
    else Object.assign(counts, { ...empty(), players, lagS: counts.lagS, lagFrames: counts.lagFrames });
  }
  if (streams.size === 0) stopTimer();
  // The journal line is housekeeping; a failure must not disturb playback.
  void reportPlayback(report).catch(() => {});
}

function stopTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Forgets every counter and stops the timer. For tests. */
export function forgetPlayback(): void {
  streams.clear();
  stopTimer();
}
