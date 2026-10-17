import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentPerfRow } from "@devdigest/shared";
import agentPerformance from "../../../../../../../messages/en/agentPerformance.json";
import common from "../../../../../../../messages/en/common.json";
import type { SortDir } from "../../../../helpers";
import { AgentTable } from "./AgentTable";

function row(over: Partial<AgentPerfRow> = {}): AgentPerfRow {
  return {
    agent_id: "a1",
    agent_name: "Security Reviewer",
    runs: 12,
    accepted: 9,
    dismissed: 3,
    decisions: 12,
    accept_rate: 0.75,
    small_sample: false,
    total_cost_usd: 0.6,
    avg_cost_usd: 0.05,
    unpriced_runs: 0,
    avg_latency_ms: 6200,
    last_run_at: "2026-10-10T10:00:00Z",
    ...over,
  };
}

const ROWS = [
  row(),
  row({ agent_id: "a2", agent_name: "Small Sample", accepted: 3, dismissed: 0, decisions: 3, accept_rate: 1, small_sample: true }),
  row({ agent_id: "a3", agent_name: "Sixty", accepted: 6, dismissed: 4, decisions: 10, accept_rate: 0.6 }),
];

function Harness({ rows, onView }: { rows: AgentPerfRow[]; onView: (id: string) => void }) {
  const [dir, setDir] = React.useState<SortDir>("desc");
  return (
    <AgentTable rows={rows} sortDir={dir} onToggleSort={() => setDir(dir === "desc" ? "asc" : "desc")} onView={onView} />
  );
}

function mount(rows: AgentPerfRow[], onView: (id: string) => void = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ agentPerformance, common }}>
      <Harness rows={rows} onView={onView} />
    </NextIntlClientProvider>,
  );
}

const bodyRows = () => within(screen.getAllByRole("rowgroup")[1]!).getAllByRole("row");
const names = () => bodyRows().map((r) => within(r).getAllByRole("cell")[0]!.textContent);

afterEach(cleanup);

describe("AgentTable", () => {
  it("renders the columns in order, one row per agent (AC-11)", () => {
    mount(ROWS);
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent ?? "");
    expect(heads[0]).toBe("Agent");
    expect(heads[1]).toBe("Runs");
    expect(heads[2]).toContain("Avg cost");
    expect(heads[2]).toContain("DevDigest estimate");
    expect(heads[3]).toBe("Avg duration");
    expect(heads[4]).toContain("Accept rate");
    expect(heads[5]).toBe("Last run");
    expect(heads[6]).toBe("View");
    expect(bodyRows()).toHaveLength(3);
  });

  it("shows the rate with its decisions, and 6.2 s duration (AC-12)", () => {
    mount([row()]);
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("12 decisions")).toBeTruthy();
    expect(screen.getByText("6.2 s")).toBeTruthy();
  });

  it("sorts by accept rate descending first and flags the small sample (AC-13, AC-15)", () => {
    mount(ROWS);
    expect(screen.getAllByRole("columnheader")[4]!.getAttribute("aria-sort")).toBe("descending");
    expect(names()).toEqual(["Security Reviewer", "Sixty", "Small Sample"]);
    expect(screen.getAllByText("small sample")).toHaveLength(1);
  });

  it("keeps the small sample row last when the direction flips (AC-14)", () => {
    mount(ROWS);
    fireEvent.click(screen.getByRole("button", { name: /Accept rate/ }));
    expect(screen.getAllByRole("columnheader")[4]!.getAttribute("aria-sort")).toBe("ascending");
    expect(names()).toEqual(["Sixty", "Security Reviewer", "Small Sample"]);
  });

  it("passes the agent id to onView (AC-16)", () => {
    const onView = vi.fn();
    mount(ROWS, onView);
    fireEvent.click(screen.getByRole("button", { name: "View Sixty" }));
    expect(onView).toHaveBeenCalledWith("a3");
  });

  it("names deleted agents and gives them no View (AC-17)", () => {
    mount([row({ agent_id: null, agent_name: null })]);
    expect(screen.getByText("Deleted agent")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^View/ })).toBeNull();
  });

  it("shows No runs in this period for a zero-run agent, without made-up zeros (AC-37)", () => {
    mount([
      row({
        runs: 0,
        accepted: 0,
        dismissed: 0,
        decisions: 0,
        accept_rate: null,
        small_sample: true,
        avg_cost_usd: null,
        total_cost_usd: null,
        avg_latency_ms: null,
        last_run_at: null,
      }),
    ]);
    expect(screen.getByText("No runs in this period")).toBeTruthy();
    expect(screen.queryByText(/0%/)).toBeNull();
    expect(screen.queryByText(/\$0/)).toBeNull();
    expect(screen.getByRole("button", { name: "View Security Reviewer" })).toBeTruthy();
  });

  it("exposes a long name in full on hover (AC-43)", () => {
    const long = "N".repeat(200);
    mount([row({ agent_name: long })]);
    expect(screen.getByTitle(long)).toBeTruthy();
  });

  it("renders markup in a name as literal text (NFR-5)", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={{ agentPerformance, common }}>
        <Harness rows={[row({ agent_name: evil })]} onView={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getAllByText(evil).length).toBeGreaterThan(0);
  });
});
