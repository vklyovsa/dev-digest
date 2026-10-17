import { describe, it, expect } from "vitest";
import {
  costBasis,
  formatCost,
  localToday,
  parsePeriod,
  periodRange,
  periodSearch,
  seriesUnit,
  signedCost,
  sortByAcceptRate,
  spanDays,
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

describe("costBasis", () => {
  const split = (billed_usd: number, estimated_usd: number, unknown_usd: number) => ({
    billed_usd,
    estimated_usd,
    unknown_usd,
  });

  it("names the one part that holds all of the cost", () => {
    expect(costBasis(split(2, 0, 0))).toBe("billed");
    expect(costBasis(split(0, 2, 0))).toBe("estimate");
    expect(costBasis(split(0, 0, 2))).toBe("unknown");
  });

  it("is mixed when more than one part is above zero", () => {
    expect(costBasis(split(1, 1, 0))).toBe("mixed");
  });

  it("is null when there is no cost", () => {
    expect(costBasis(split(0, 0, 0))).toBeNull();
  });
});

describe("signedCost", () => {
  it("signs a rise with + and a fall with the minus sign", () => {
    expect(signedCost(1.2)).toEqual({ sign: "+", amount: "$1.20" });
    expect(signedCost(-1.2)).toEqual({ sign: "\u2212", amount: "$1.20" });
  });

  it("gives zero no sign", () => {
    expect(signedCost(0).sign).toBe("");
  });
});

describe("seriesUnit", () => {
  it("is hour for one-hour buckets and day otherwise", () => {
    const at = (ms: number) => ({ start: new Date(ms).toISOString(), runs: 0 });
    expect(seriesUnit([at(0), at(3_600_000)])).toBe("hour");
    expect(seriesUnit([at(0), at(DAY)])).toBe("day");
    expect(seriesUnit([at(0)])).toBe("day");
  });
});

describe("spanDays", () => {
  it("rounds a 3-day range that crosses a DST change to 3", () => {
    const from = new Date(2026, 2, 28).toISOString();
    const to = new Date(2026, 2, 31).toISOString();
    expect(spanDays({ from, to })).toBe(3);
  });
});
