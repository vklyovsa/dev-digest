import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentPerf } from "@devdigest/shared";
import agentPerformance from "../../../../../../../messages/en/agentPerformance.json";
import common from "../../../../../../../messages/en/common.json";
import { KpiCards } from "./KpiCards";

type Summary = AgentPerf["summary"];

const summary = (over: Partial<Summary> = {}): Summary => ({
  runs: 253,
  total_cost_usd: 8.74,
  cost_split: { billed_usd: 0, estimated_usd: 8.74, unknown_usd: 0 },
  cost_delta_usd: null,
  unpriced_runs: 0,
  accepted: 25,
  decisions: 41,
  avg_accept_rate: 0.61,
  most_active_agent: "Security Reviewer",
  most_active_agent_id: "a1",
  most_active_runs: 142,
  most_active_accept_rate: 0.78,
  ...over,
});

type Series = AgentPerf["runs_series"];

const DAY = 86_400_000;
const dailySeries: Series = [3, 0, 7, 5].map((runs, i) => ({
  start: new Date(Date.UTC(2026, 9, 1) + i * DAY).toISOString(),
  runs,
}));
const PERIOD = { from: "2026-09-17T00:00:00.000Z", to: "2026-10-17T00:00:00.000Z" };

function mount(s: Summary, series: Series = dailySeries) {
  render(
    <NextIntlClientProvider locale="en" messages={{ agentPerformance, common }}>
      <KpiCards summary={s} series={series} period={PERIOD} periodLabel="30d" />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("KpiCards", () => {
  it("labels every card with the period and fills it from the summary (AC-8, AC-9, AC-10)", () => {
    mount(summary());
    expect(screen.getByText("Total runs (30d)")).toBeTruthy();
    expect(screen.getByText("Total cost (30d)")).toBeTruthy();
    expect(screen.getByText("Avg accept rate (30d)")).toBeTruthy();
    expect(screen.getByText("Most-active agent (30d)")).toBeTruthy();
    expect(screen.getByText("253")).toBeTruthy();
    expect(screen.getByText("$8.74")).toBeTruthy();
    expect(screen.getByText("61%")).toBeTruthy();
    expect(screen.getByText("41 decisions · 253 runs")).toBeTruthy();
    expect(screen.getByText("Security Reviewer")).toBeTruthy();
    expect(screen.getByText("142 runs · 78% accept")).toBeTruthy();
  });

  it("splits the cost by source and leaves out a zero part (AC-38)", () => {
    mount(summary({ cost_split: { billed_usd: 4.1, estimated_usd: 0.6, unknown_usd: 0 } }));
    expect(screen.getByText("Billed $4.10")).toBeTruthy();
    expect(screen.getByText("Estimate $0.600")).toBeTruthy();
    expect(screen.queryByText(/Unknown source/)).toBeNull();
  });

  it("states what a billed amount is (AC-55)", () => {
    mount(summary());
    expect(screen.getByText(/not a figure read from the provider's account/)).toBeTruthy();
  });

  it("shows the signed cost change and names the comparison (AC-60)", () => {
    mount(summary({ cost_delta_usd: -1.2 }));
    expect(screen.getByText("\u2212$1.20 vs previous 30d")).toBeTruthy();
  });

  it("says there is no earlier period when the change is null (AC-61)", () => {
    mount(summary({ cost_delta_usd: null }));
    expect(screen.getByText("No earlier period to compare")).toBeTruthy();
    expect(screen.queryByText(/vs previous/)).toBeNull();
  });

  it("draws one point per bucket and names the bucket size and peak (AC-58)", () => {
    mount(summary());
    const img = screen.getByRole("img", { name: "Runs per day, peak 7" });
    const d = img.querySelector("path")!.getAttribute("d")!;
    expect(d.match(/[ML]/g)).toHaveLength(dailySeries.length);
  });

  it("names hourly buckets when they are one hour apart (AC-58)", () => {
    const hourly: Series = [1, 4].map((runs, i) => ({
      start: new Date(Date.UTC(2026, 9, 1) + i * 3_600_000).toISOString(),
      runs,
    }));
    mount(summary(), hourly);
    expect(screen.getByRole("img", { name: "Runs per hour, peak 4" })).toBeTruthy();
  });

  it("states how many runs the total leaves out (AC-39)", () => {
    mount(summary({ unpriced_runs: 3 }));
    expect(screen.getByText("3 runs without a cost left out")).toBeTruthy();
  });

  it("does not mention unpriced runs when there are none", () => {
    mount(summary());
    expect(screen.queryByText(/without a cost/)).toBeNull();
  });

  it("groups digits above 999 (NFR-3)", () => {
    mount(summary({ runs: 1234 }));
    expect(screen.getByText("1,234")).toBeTruthy();
  });

  it("shows a dash instead of a made-up zero when nothing is known", () => {
    mount(
      summary({
        total_cost_usd: null,
        avg_accept_rate: null,
        most_active_agent: null,
        most_active_agent_id: null,
        most_active_runs: 0,
        most_active_accept_rate: null,
      }),
    );
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.queryByText("$0.00")).toBeNull();
  });
});
