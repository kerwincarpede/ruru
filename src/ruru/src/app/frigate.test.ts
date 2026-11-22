import { describe, expect, it } from "vitest";
import { cameraLabel, frigateCameras, snapshotUrl, streamSocketUrl, testFrigate } from "./frigate";
import { mockCommands } from "../test/mockCommands";

describe("Frigate commands", () => {
  it("sends the URL to test_frigate and frigate_cameras", async () => {
    const calls = mockCommands({
      test_frigate: () => ({ version: "0.18.0", cameraCount: 2 }),
      frigate_cameras: () => [],
    });
    await expect(testFrigate("http://f")).resolves.toEqual({ version: "0.18.0", cameraCount: 2 });
    await expect(frigateCameras("http://f")).resolves.toEqual([]);
    expect(calls).toEqual([
      { cmd: "test_frigate", payload: { url: "http://f" } },
      { cmd: "frigate_cameras", payload: { url: "http://f" } },
    ]);
  });
});

describe("Frigate URLs", () => {
  it("points snapshots at the camera's latest.webp", () => {
    expect(snapshotUrl("http://frigate:5000", "front yard")).toBe("http://frigate:5000/api/front%20yard/latest.webp");
  });

  it("opens go2rtc's WebSocket through Frigate, secure when Frigate is", () => {
    expect(streamSocketUrl("https://frigate.test", "webrtc", "garage")).toBe(
      "wss://frigate.test/live/webrtc/api/ws?src=garage",
    );
    expect(streamSocketUrl("http://frigate:5000/sub", "mse", "a b")).toBe(
      "ws://frigate:5000/sub/live/mse/api/ws?src=a+b",
    );
  });

  it("labels cameras in plain words", () => {
    expect(cameraLabel("front_yard")).toBe("Front yard");
    expect(cameraLabel("backyard-right_2")).toBe("Backyard right 2");
  });
});
