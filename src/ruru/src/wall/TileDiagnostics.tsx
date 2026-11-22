import { useEffect, useState, type RefObject } from "react";
import { frameRate, sampleFrames, type FrameSample } from "./diagnostics";
import type { Go2rtcPlayer, PlayerState } from "./player";

interface Props {
  player: RefObject<Pick<Go2rtcPlayer, "connection"> | null>;
  video: RefObject<HTMLVideoElement | null>;
  stream: string;
  state: PlayerState;
}

/** Reads the already playing tile, without restarting it or polling Frigate. */
export default function TileDiagnostics({ player, video, stream, state }: Props) {
  const [sample, setSample] = useState<{ transport: string; rate?: ReturnType<typeof frameRate>; resolution?: string; buffer?: number }>();
  useEffect(() => {
    let previous: FrameSample | undefined;
    let generation: number | undefined;
    const update = () => {
      const element = video.current;
      const link = player.current?.connection();
      if (!element || !link) return;
      const frames = sampleFrames(element);
      const rate = link.transport && generation === link.generation ? frameRate(previous, frames) : undefined;
      previous = frames;
      generation = link.generation;
      const ranges = element.buffered;
      setSample({
        transport: link.transport ? `${link.transport}${link.fallback ? " fallback" : ""} · ${link.status}` : "Offline",
        rate,
        resolution: element.videoWidth ? `${element.videoWidth}×${element.videoHeight}` : undefined,
        buffer: link.transport === "MSE" && ranges.length ? Math.max(0, ranges.end(ranges.length - 1) - element.currentTime) : undefined,
      });
    };
    // Defer the first read until the parent has attached the player.
    const first = setTimeout(update, 0);
    const timer = setInterval(update, 1000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [player, video]);
  return (
    <aside className="tile-debug" aria-label="Playback diagnostics">
      <strong>{sample?.rate ? sample.rate.fps.toFixed(1) : "—"} fps</strong> · {state}
      <div>{sample?.transport ?? "Connecting…"}</div>
      <div className="debug-stream" title={stream}>{stream}{sample?.resolution && ` · ${sample.resolution}`}</div>
      <div>{[sample?.rate && `${sample.rate.dropped} dropped / sample`, sample?.buffer !== undefined && `${sample.buffer.toFixed(1)} s buffered`].filter(Boolean).join(" · ")}</div>
    </aside>
  );
}
