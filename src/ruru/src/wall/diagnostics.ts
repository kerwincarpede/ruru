/** Frame counters for one stream, read from the webview without any network request. */
export interface FrameCounts {
  shown: number;
  dropped: number;
}

/** Frame counters taken at a moment, sampled only while the stream info overlay is visible. */
export interface FrameSample extends FrameCounts {
  at: number;
}

/**
 * The video element's own counters. WebKit keeps them at zero for a
 * MediaStream (WebRTC), so WebRTC reads `inboundVideoFrames` instead.
 */
export function videoFrames(video: HTMLVideoElement): FrameCounts | undefined {
  const quality = video.getVideoPlaybackQuality?.();
  if (!quality) return;
  return { shown: quality.totalVideoFrames - quality.droppedVideoFrames, dropped: quality.droppedVideoFrames };
}

/** The decoded and dropped video frames in a WebRTC stats report, or undefined when it has none. */
export function inboundVideoFrames(report: RTCStatsReport): FrameCounts | undefined {
  let counts: FrameCounts | undefined;
  report.forEach((stat: { type?: string; kind?: string; mediaType?: string; framesDecoded?: number; framesDropped?: number }) => {
    if (stat.type !== "inbound-rtp" || (stat.kind ?? stat.mediaType) !== "video" || typeof stat.framesDecoded !== "number") return;
    counts = { shown: stat.framesDecoded, dropped: stat.framesDropped ?? 0 };
  });
  return counts;
}

/** Missing or reset counters need another sample, not a fabricated zero. */
export function frameRate(before?: FrameSample, after?: FrameSample) {
  if (!before || !after || after.at <= before.at || after.shown < before.shown || after.dropped < before.dropped) return;
  return {
    fps: (after.shown - before.shown) * 1000 / (after.at - before.at),
    dropped: after.dropped - before.dropped,
  };
}
