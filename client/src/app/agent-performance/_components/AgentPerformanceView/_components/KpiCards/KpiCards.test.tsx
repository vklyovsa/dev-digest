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

function mount(s: Summary) {
  render(
    <NextIntlClientProvider locale="en" messages={{ agentPerformance, common }}>
      <KpiCards summary={s} periodLabel="30d" />
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

  it("marks the cost as an estimate with its note (AC-38)", () => {
    mount(summary());
    expect(screen.getByText("DevDigest estimate")).toBeTruthy();
    expect(screen.getByText(/not billing data/)).toBeTruthy();
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
