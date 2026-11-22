/** Video element counters, sampled only while the edit overlay is visible. */
export interface FrameSample {
  at: number;
  shown: number;
  dropped: number;
}

export function sampleFrames(video: HTMLVideoElement): FrameSample | undefined {
  const quality = video.getVideoPlaybackQuality?.();
  if (!quality) return;
  return { at: performance.now(), shown: quality.totalVideoFrames - quality.droppedVideoFrames, dropped: quality.droppedVideoFrames };
}

/** Missing or reset counters need another sample, not a fabricated zero. */
export function frameRate(before?: FrameSample, after?: FrameSample) {
  if (!before || !after || after.at <= before.at || after.shown < before.shown || after.dropped < before.dropped) return;
  return {
    fps: (after.shown - before.shown) * 1000 / (after.at - before.at),
    dropped: after.dropped - before.dropped,
  };
}
