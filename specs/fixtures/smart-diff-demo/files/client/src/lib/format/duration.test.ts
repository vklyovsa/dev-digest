import { describe, expect, it } from "vitest";
import { formatDuration, formatDurationVerbose } from "./duration";

describe("formatDuration", () => {
  it("formats seconds under a minute", () => {
    expect(formatDuration(42_000)).toBe("42s");
  });
});

describe("formatDurationVerbose", () => {
  it("spells the unit out", () => {
    expect(formatDurationVerbose(2_000)).toBe("2 seconds");
  });
});
