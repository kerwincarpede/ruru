import { afterEach, expect, it, vi } from "vitest";

import { mockCommands } from "../test/mockCommands";
import { forgetPlayback, openPlaybackCounter, REPORT_MS } from "./playbackLog";

afterEach(() => {
  forgetPlayback();
  vi.useRealTimers();
});

it("reports anonymous stream counters once a minute and joins reconnects", async () => {
  vi.useFakeTimers();
  const report = vi.fn(() => null);
  mockCommands({ report_playback: report });

  const old = openPlaybackCounter("garage");
  old.connected();
  old.paused("start");
  old.arrived();
  old.presented(1);
  old.close();

  const current = openPlaybackCounter("garage");
  current.connected();
  current.paused("late");
  current.paused("missing");
  current.paused("close");
  current.skipped();
  current.arrived();
  current.presented(2);
  current.late(0.043);
  current.late(0.052);
  current.lag(0.6, 0.05);

  await vi.advanceTimersByTimeAsync(REPORT_MS - 1);
  expect(report).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(report).toHaveBeenCalledExactlyOnceWith({
    streams: [{
      connections: 2,
      pausesStart: 1,
      pausesLate: 1,
      pausesMissing: 1,
      pausesClose: 1,
      skips: 1,
      arrived: 2,
      presented: 3,
      late: 2,
      worstLateMs: 52,
      lagS: 0.6,
      lagFrames: 12,
    }],
  });

  current.arrived();
  current.close();
  await vi.advanceTimersByTimeAsync(REPORT_MS);
  expect(report).toHaveBeenLastCalledWith({
    streams: [expect.objectContaining({ connections: 0, arrived: 1, late: 0, lagS: 0.6, lagFrames: 12 })],
  });
  await vi.advanceTimersByTimeAsync(REPORT_MS);
  expect(report).toHaveBeenCalledTimes(2);
});
