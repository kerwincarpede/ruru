import { describe, expect, it } from "vitest";
import { frigateProblem } from "./frigateProblem";

describe("frigateProblem", () => {
  it("sorts each kind of FrigateError message", () => {
    expect(frigateProblem("Could not reach Frigate at http://frigate:5000: connection refused")).toEqual({ kind: "unreachable" });
    expect(frigateProblem("Frigate at http://frigate:5000 answered with HTTP 401.")).toEqual({ kind: "status", status: 401 });
    expect(frigateProblem("Frigate's answer was not understood: expected value at line 1 column 1")).toEqual({ kind: "unexpected" });
  });

  it("counts any other error as unreachable", () => {
    expect(frigateProblem("Enter a full address")).toEqual({ kind: "unreachable" });
  });
});
