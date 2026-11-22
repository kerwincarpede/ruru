import { describe, expect, it } from "vitest";
import { appInfo } from "./api";
import { mockCommands } from "../test/mockCommands";

describe("appInfo", () => {
  it("calls app_info and returns its answer", async () => {
    const calls = mockCommands({ app_info: () => ({ name: "Ruru", version: "0.1.0" }) });
    await expect(appInfo()).resolves.toEqual({ name: "Ruru", version: "0.1.0" });
    expect(calls.map((call) => call.cmd)).toEqual(["app_info"]);
  });
});
