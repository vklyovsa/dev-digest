import { describe, it, expect } from "vitest";
import {
  formatCost,
  localToday,
  parsePeriod,
  periodRange,
  periodSearch,
  sortByAcceptRate,
  validateCustom,
} from "./helpers";

const NOW = new Date(2026, 9, 17, 12, 0, 0).getTime();
const DAY = 86_400_000;

describe("periodRange", () => {
  it("1d is the 24 hours before now", () => {
    expect(periodRange({ kind: "1d" }, NOW)).toEqual({
      from: new Date(NOW - DAY).toISOString(),
      to: new Date(NOW).toISOString(),
    });
  });

  it("30d is 30 x 24 hours before now", () => {
    expect(periodRange({ kind: "30d" }, NOW)).toEqual({
      from: new Date(NOW - 30 * DAY).toISOString(),
      to: new Date(NOW).toISOString(),
    });
  });

  it("custom runs from the start of the first local date to the start of the day after the last", () => {
    expect(periodRange({ kind: "custom", start: "2026-10-01", end: "2026-10-03" }, NOW)).toEqual({
      from: new Date(2026, 9, 1).toISOString(),
      to: new Date(2026, 9, 4).toISOString(),
    });
  });
});

describe("validateCustom", () => {
  it("flags a range that ends before it starts", () => {
    expect(validateCustom("2026-10-05", "2026-10-01", "2026-10-17")).toBe("inverted");
  });

  it("flags a range that ends after today", () => {
    expect(validateCustom("2026-10-05", "2026-10-18", "2026-10-17")).toBe("future");
  });

  it("accepts a range ending today", () => {
    expect(validateCustom("2026-10-05", "2026-10-17", "2026-10-17")).toBeNull();
  });
});

describe("parsePeriod", () => {
  const today = localToday(NOW);

  it("defaults to 30d with no period", () => {
    expect(parsePeriod(new URLSearchParams(""), today)).toEqual({ kind: "30d" });
  });

  it("falls back to 30d on an invalid period or an invalid custom range", () => {
    expect(parsePeriod(new URLSearchParams("period=week"), today)).toEqual({ kind: "30d" });
    expect(
      parsePeriod(new URLSearchParams("period=custom&start=2026-10-05&end=2026-10-01"), today),
    ).toEqual({ kind: "30d" });
    expect(parsePeriod(new URLSearchParams("period=custom&start=nope&end=x"), today)).toEqual({
      kind: "30d",
    });
  });

  it("reads 1d and a valid custom range, and round-trips through periodSearch", () => {
    expect(parsePeriod(new URLSearchParams("period=1d"), today)).toEqual({ kind: "1d" });
    const custom = { kind: "custom", start: "2026-10-01", end: "2026-10-03" } as const;
    expect(parsePeriod(new URLSearchParams(periodSearch(custom)), today)).toEqual(custom);
  });
});

describe("sortByAcceptRate", () => {
  const rows = [
    { agent_name: "small", accept_rate: 1, small_sample: true },
    { agent_name: "sixty", accept_rate: 0.6, small_sample: false },
    { agent_name: "none", accept_rate: null, small_sample: true },
    { agent_name: "ninety", accept_rate: 0.9, small_sample: false },
  ];

  it("orders rated rows by rate, then small-sample and unrated rows, descending", () => {
    expect(sortByAcceptRate(rows, "desc").map((r) => r.agent_name)).toEqual([
      "ninety",
      "sixty",
      "small",
      "none",
    ]);
  });

  it("keeps small-sample and unrated rows last when ascending", () => {
    expect(sortByAcceptRate(rows, "asc").map((r) => r.agent_name)).toEqual([
      "sixty",
      "ninety",
      "small",
      "none",
    ]);
  });
});

describe("formatCost", () => {
  it("groups digits and uses two decimals from a dollar up", () => {
    expect(formatCost(1234.5)).toBe("$1,234.50");
  });

  it("uses more decimals for small costs", () => {
    expect(formatCost(0.0013)).toBe("$0.0013");
    expect(formatCost(0.25)).toBe("$0.250");
  });

  it("shows a dash for a missing cost", () => {
    expect(formatCost(null)).toBe("—");
  });
});
