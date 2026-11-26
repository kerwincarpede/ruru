import { describe, expect, it } from "vitest";
import { ExpiringMap, ExpiringSet } from "./memory";

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

describe("ExpiringMap", () => {
  it("remembers a value until its time runs out, then forgets it", () => {
    let now = 1000;
    const map = new ExpiringMap<number>(500, () => now);
    expect(map.get("a")).toBeUndefined();
    map.set("a", 0.2);
    now += 499;
    expect(map.get("a")).toBe(0.2);
    expect(map.get("b")).toBeUndefined();
    now += 1;
    expect(map.get("a")).toBeUndefined();
    // Setting again starts a fresh period.
    map.set("a", 0.4);
    expect(map.get("a")).toBe(0.4);
    map.clear();
    expect(map.get("a")).toBeUndefined();
  });
});
