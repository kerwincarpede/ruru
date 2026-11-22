import { describe, expect, it } from "vitest";
import { frameRate, inboundVideoFrames, videoFrames } from "./diagnostics";

const report = (...stats: object[]) => new Map(stats.map((stat, index) => [String(index), stat])) as unknown as RTCStatsReport;

describe("inboundVideoFrames", () => {
  it("reads the decoded and dropped frames of the inbound video", () => {
    expect(inboundVideoFrames(report(
      { type: "candidate-pair", framesDecoded: 9 },
      { type: "inbound-rtp", kind: "audio", framesDecoded: 7 },
      { type: "inbound-rtp", kind: "video", framesDecoded: 120, framesDropped: 3 },
    ))).toEqual({ shown: 120, dropped: 3 });
    // Older webviews name the kind `mediaType` and may leave drops out.
    expect(inboundVideoFrames(report({ type: "inbound-rtp", mediaType: "video", framesDecoded: 5 }))).toEqual({ shown: 5, dropped: 0 });
  });

  it("has nothing to say before the video arrives", () => {
    expect(inboundVideoFrames(report({ type: "inbound-rtp", kind: "video" }))).toBeUndefined();
    expect(inboundVideoFrames(report())).toBeUndefined();
  });
});

describe("videoFrames", () => {
  it("reads the element's counters where the webview has them", () => {
    const element = document.createElement("video");
    expect(videoFrames(element)).toBeUndefined();
    element.getVideoPlaybackQuality = () => ({ totalVideoFrames: 50, droppedVideoFrames: 4 }) as VideoPlaybackQuality;
    expect(videoFrames(element)).toEqual({ shown: 46, dropped: 4 });
  });
});

describe("frameRate", () => {
  it("needs two samples whose counters did not reset", () => {
    expect(frameRate(undefined, { at: 1, shown: 1, dropped: 0 })).toBeUndefined();
    expect(frameRate({ at: 0, shown: 10, dropped: 0 }, { at: 1000, shown: 5, dropped: 0 })).toBeUndefined();
    expect(frameRate({ at: 0, shown: 10, dropped: 0 }, { at: 2000, shown: 30, dropped: 2 })).toEqual({ fps: 10, dropped: 2 });
  });
});
