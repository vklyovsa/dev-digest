import { describe, it, expect } from "vitest";
import type { EvalRun } from "@devdigest/shared";
import {
  completedRuns,
  costDelta,
  deltaPoints,
  directionOf,
  expectedCount,
  formatRunTime,
  metricSparklines,
  nextSelection,
  plottedRuns,
  skillOwner,
  EVAL_NO_HOST_HINT_ID,
  toPercent,
} from "./helpers";

describe("toPercent", () => {
  it("rounds to a whole percent and keeps null", () => {
    expect(toPercent(0.824)).toBe(82);
    expect(toPercent(0.825)).toBe(83);
    expect(toPercent(0)).toBe(0);
    expect(toPercent(null)).toBeNull();
  });
});

describe("deltaPoints", () => {
  it("is the difference of the displayed percentages", () => {
    expect(deltaPoints(0.82, 0.78)).toBe(4);
    expect(deltaPoints(0.91, 0.93)).toBe(-2);
    expect(deltaPoints(0.5, 0.5)).toBe(0);
  });

  it("is null when either side has no value", () => {
    expect(deltaPoints(null, 0.8)).toBeNull();
    expect(deltaPoints(0.8, null)).toBeNull();
  });
});

describe("costDelta", () => {
  it("subtracts, and is null when either cost is unknown", () => {
    expect(costDelta(0.23, 0.21)).toBeCloseTo(0.02, 10);
    expect(costDelta(null, 0.21)).toBeNull();
    expect(costDelta(0.23, null)).toBeNull();
  });
});

describe("directionOf", () => {
  it("names the sign", () => {
    expect(directionOf(4)).toBe("up");
    expect(directionOf(-2)).toBe("down");
    expect(directionOf(0)).toBe("same");
  });
});

describe("nextSelection", () => {
  it("adds one, then two", () => {
    expect(nextSelection([], "a")).toEqual(["a"]);
    expect(nextSelection(["a"], "b")).toEqual(["a", "b"]);
  });

  it("drops the earliest when a third is chosen", () => {
    expect(nextSelection(["a", "b"], "c")).toEqual(["b", "c"]);
  });

  it("toggles an id that is already selected", () => {
    expect(nextSelection(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("completedRuns", () => {
  it("keeps only runs that are done", () => {
    const runs = [
      { id: "1", status: "running" },
      { id: "2", status: "done" },
      { id: "3", status: "failed" },
    ] as EvalRun[];
    expect(completedRuns(runs).map((r) => r.id)).toEqual(["2"]);
  });
});

describe("formatRunTime", () => {
  it("renders date and 24-hour time in the given zone", () => {
    expect(formatRunTime("2026-05-29T09:14:00Z", "UTC")).toBe("2026-05-29 09:14");
    expect(formatRunTime("2026-05-29T23:05:00Z", "UTC")).toBe("2026-05-29 23:05");
  });

  it("returns the input when it is not a date", () => {
    expect(formatRunTime("not a date")).toBe("not a date");
  });
});

function run(id: string, startedAt: string, status: EvalRun["status"], recall: number | null, precision: number | null, citation: number | null) {
  return { id, started_at: startedAt, status, recall, precision, citation_accuracy: citation } as EvalRun;
}

describe("plottedRuns", () => {
  it("keeps the done runs, oldest first, without touching the input", () => {
    const runs = [
      run("c", "2026-05-03T00:00:00Z", "done", 0.9, 0.9, 0.9),
      run("d", "2026-05-04T00:00:00Z", "running", null, null, null),
      run("b", "2026-05-02T00:00:00Z", "failed", null, null, null),
      run("a", "2026-05-01T00:00:00Z", "done", 0.8, 0.8, 0.8),
    ];
    expect(plottedRuns(runs).map((r) => r.id)).toEqual(["a", "c"]);
    expect(runs.map((r) => r.id)).toEqual(["c", "d", "b", "a"]);
  });
});

describe("metricSparklines", () => {
  it("lists non-null values oldest first", () => {
    const runs = [
      run("3", "2026-05-03T00:00:00Z", "done", 0.9, 0.7, 0.6),
      run("2", "2026-05-02T00:00:00Z", "done", 0.8, 0.8, 0.7),
      run("1", "2026-05-01T00:00:00Z", "done", 0.7, 0.9, 0.8),
    ];
    expect(metricSparklines(runs)).toEqual({
      recall: [0.7, 0.8, 0.9],
      precision: [0.9, 0.8, 0.7],
      citation_accuracy: [0.8, 0.7, 0.6],
    });
  });

  it("is null for every metric with one run", () => {
    expect(metricSparklines([run("1", "2026-05-01T00:00:00Z", "done", 0.7, 0.9, 0.8)])).toEqual({
      recall: null,
      precision: null,
      citation_accuracy: null,
    });
  });

  it("is null for a metric with a single non-null value", () => {
    const runs = [
      run("1", "2026-05-01T00:00:00Z", "done", 0.7, null, 0.8),
      run("2", "2026-05-02T00:00:00Z", "done", 0.8, null, 0.8),
      run("3", "2026-05-03T00:00:00Z", "done", 0.9, 0.5, 0.8),
    ];
    expect(metricSparklines(runs).precision).toBeNull();
    expect(metricSparklines(runs).recall).toEqual([0.7, 0.8, 0.9]);
  });
});

describe("expectedCount", () => {
  it("expects one finding for must_find and none for must_not_flag", () => {
    expect(expectedCount("must_find")).toBe(1);
    expect(expectedCount("must_not_flag")).toBe(0);
  });
});

describe("skillOwner", () => {
  it("carries the host agent's id", () => {
    expect(skillOwner({ id: "s1", name: "S", host: { id: "a1", name: "A" } })).toEqual({
      kind: "skill",
      id: "s1",
      hostAgentId: "a1",
    });
  });

  it("has no host agent when none uses the skill", () => {
    expect(skillOwner({ id: "s1", name: "S", host: null })).toEqual({
      kind: "skill",
      id: "s1",
      hostAgentId: null,
    });
    expect(EVAL_NO_HOST_HINT_ID).toBe("eval-no-host-hint");
  });
});
