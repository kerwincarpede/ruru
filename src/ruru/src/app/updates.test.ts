import { emit } from "@tauri-apps/api/event";
import { clearMocks } from "@tauri-apps/api/mocks";
import { describe, expect, it, vi } from "vitest";
import { checkForUpdate, fakeUpdate, findUpdate, onUpdateStatus, versionLabel } from "./updates";
import { mockCommands } from "../test/mockCommands";

describe("fakeUpdate", () => {
  it("returns the version fake_update offers", async () => {
    const calls = mockCommands({ fake_update: () => "99.0.0" });
    await expect(fakeUpdate()).resolves.toBe("99.0.0");
    expect(calls.map((call) => call.cmd)).toEqual(["fake_update"]);
  });
});

describe("versionLabel", () => {
  const info = { name: "Ruru", version: "0.3.0" };

  it("names the version, and says Edge on the Edge channel", () => {
    expect(versionLabel(info, "stable")).toBe("Ruru 0.3.0");
    expect(versionLabel(info, "edge")).toBe("Ruru 0.3.0 · Edge");
  });
});

describe("checkForUpdate", () => {
  it("offers the fake update without checking, and installing it does nothing", async () => {
    const calls = mockCommands({ fake_update: () => "99.0.0" });
    const update = await checkForUpdate();
    expect(update?.version).toBe("99.0.0");
    await update?.install();
    expect(calls.map((call) => call.cmd)).toEqual(["fake_update"]);
  });

  it("offers the release check_update finds, which install_update installs", async () => {
    const calls = mockCommands({ fake_update: () => null, check_update: () => "0.4.0", install_update: () => null });
    const update = await checkForUpdate();
    expect(update?.version).toBe("0.4.0");
    expect(calls.map((call) => call.cmd)).toEqual(["fake_update", "check_update"]);
    await update?.install();
    expect(calls.map((call) => call.cmd)).toEqual(["fake_update", "check_update", "install_update"]);
  });

  it("rejects with why an install failed", async () => {
    mockCommands({
      fake_update: () => null,
      check_update: () => "0.4.0",
      install_update: () => {
        throw "The update could not be installed: bad signature";
      },
    });
    const update = await checkForUpdate();
    await expect(update?.install()).rejects.toBe("The update could not be installed: bad signature");
  });

  it("offers nothing when this copy is up to date", async () => {
    mockCommands({ fake_update: () => null, check_update: () => null });
    await expect(checkForUpdate()).resolves.toBeNull();
  });

  it("rejects with why the check failed", async () => {
    mockCommands({
      fake_update: () => null,
      check_update: () => {
        throw "Could not find Edge releases: timed out";
      },
    });
    await expect(checkForUpdate()).rejects.toBe("Could not find Edge releases: timed out");
  });
});

describe("findUpdate", () => {
  it("offers what the check finds", async () => {
    mockCommands({ fake_update: () => null, check_update: () => "0.4.0" });
    await expect(findUpdate()).resolves.toMatchObject({ version: "0.4.0" });
  });

  it("stays silent when the check fails", async () => {
    mockCommands({
      fake_update: () => null,
      check_update: () => {
        throw "Could not check for updates: 404 Not Found";
      },
    });
    await expect(findUpdate()).resolves.toBeNull();
  });

  it("stays silent when the backend cannot answer", async () => {
    mockCommands({});
    await expect(findUpdate()).resolves.toBeNull();
  });
});

describe("onUpdateStatus", () => {
  it("hands over what the update is doing", async () => {
    mockCommands({});
    const handler = vi.fn();
    const stop = await onUpdateStatus(handler);
    await emit("update-status", { state: "downloading", version: "0.4.1", percent: 7 });
    expect(handler).toHaveBeenCalledWith({ state: "downloading", version: "0.4.1", percent: 7 });
    stop();
  });

  it("gives a no-op without a backend", async () => {
    clearMocks();
    const stop = await onUpdateStatus(vi.fn());
    expect(() => stop()).not.toThrow();
  });
});
