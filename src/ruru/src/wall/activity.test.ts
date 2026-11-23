import { describe, expect, it } from "vitest";
import { objectChip } from "./activity";

describe("objectChip", () => {
  it("names objects as people read them, with a count for more than one", () => {
    expect(objectChip("person", 1)).toBe("Person");
    expect(objectChip("license_plate", 3)).toBe("License plate ×3");
  });
});
