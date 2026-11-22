import { describe, expect, it } from "vitest";
import { ExpiringSet } from "./memory";

describe("ExpiringSet", () => {
  it("remembers a key until its time runs out, then forgets it", () => {
    let now = 1000;
    const set = new ExpiringSet(500, () => now);
    expect(set.has("a")).toBe(false);
    set.add("a");
    now += 499;
    expect(set.has("a")).toBe(true);
    expect(set.has("b")).toBe(false);
    now += 1;
    expect(set.has("a")).toBe(false);
    // Adding again starts a fresh period.
    set.add("a");
    expect(set.has("a")).toBe(true);
    set.clear();
    expect(set.has("a")).toBe(false);
  });
});
