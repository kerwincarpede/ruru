import { beforeEach, describe, expect, it, vi } from "vitest";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { fakeUpdate, findUpdate } from "./updates";
import { mockCommands } from "../test/mockCommands";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

const checkMock = vi.mocked(check);
const relaunchMock = vi.mocked(relaunch);

function realUpdate(version: string, downloadAndInstall = vi.fn().mockResolvedValue(undefined)) {
  return { version, downloadAndInstall } as unknown as Update;
}

describe("fakeUpdate", () => {
  it("returns the version fake_update offers", async () => {
    const calls = mockCommands({ fake_update: () => "99.0.0" });
    await expect(fakeUpdate()).resolves.toBe("99.0.0");
    expect(calls.map((call) => call.cmd)).toEqual(["fake_update"]);
  });
});

describe("findUpdate", () => {
  beforeEach(() => {
    checkMock.mockReset();
    relaunchMock.mockReset().mockResolvedValue(undefined);
  });

  it("offers the fake update without checking, and installing it does nothing", async () => {
    mockCommands({ fake_update: () => "99.0.0" });
    const update = await findUpdate();
    expect(update?.version).toBe("99.0.0");
    await update?.install();
    expect(checkMock).not.toHaveBeenCalled();
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("offers a newer Stable release, which installs and then restarts", async () => {
    mockCommands({ fake_update: () => null });
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    checkMock.mockResolvedValue(realUpdate("0.2.0", downloadAndInstall));
    const update = await findUpdate();
    expect(update?.version).toBe("0.2.0");
    expect(relaunchMock).not.toHaveBeenCalled();
    await update?.install();
    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunchMock).toHaveBeenCalledOnce();
  });

  it("does not restart when the install fails", async () => {
    mockCommands({ fake_update: () => null });
    checkMock.mockResolvedValue(realUpdate("0.2.0", vi.fn().mockRejectedValue(new Error("bad signature"))));
    const update = await findUpdate();
    await expect(update?.install()).rejects.toThrow("bad signature");
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("offers nothing when this copy is up to date", async () => {
    mockCommands({ fake_update: () => null });
    checkMock.mockResolvedValue(null);
    await expect(findUpdate()).resolves.toBeNull();
  });

  it("stays silent when the check fails, as it does before the first Stable release", async () => {
    mockCommands({ fake_update: () => null });
    checkMock.mockRejectedValue(new Error("404 Not Found"));
    await expect(findUpdate()).resolves.toBeNull();
  });

  it("stays silent when the backend cannot answer", async () => {
    mockCommands({});
    await expect(findUpdate()).resolves.toBeNull();
    expect(checkMock).not.toHaveBeenCalled();
  });
});
