/** Mirrors `FrigateStatus` in src-tauri/src/frigate.rs. */
export interface FrigateStatus {
  version: string;
  cameraCount: number;
}

/** Mirrors `Camera` in src-tauri/src/frigate.rs: a camera and its go2rtc stream names. */
export interface Camera {
  name: string;
  enabled: boolean;
  mainStream: string;
  subStream: string;
}

/** The camera's latest snapshot, which shows until its video arrives. */
export function snapshotUrl(base: string, camera: string): string {
  return `${base}/api/${encodeURIComponent(camera)}/latest.webp`;
}

/** go2rtc's WebSocket for a stream, through Frigate's `/live/<kind>/` proxy. */
export function streamSocketUrl(base: string, kind: "webrtc" | "mse", stream: string): string {
  const url = new URL(`${base}/live/${kind}/api/ws`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("src", stream);
  return url.toString();
}

/** A camera name as people read it: `front_yard` is "Front yard". */
export function cameraLabel(name: string): string {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
