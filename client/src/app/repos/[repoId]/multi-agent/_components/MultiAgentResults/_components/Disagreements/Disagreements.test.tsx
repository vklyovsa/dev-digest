import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn, ConflictTake, FindingGroup } from "@devdigest/shared";
import runs from "../../../../../../../../../messages/en/runs.json";
import { Disagreements } from "./Disagreements";

afterEach(cleanup);

function column(name: string, status: AgentColumn["status"] = "done"): AgentColumn {
  return {
    run_id: `run-${name}`,
    agent_id: `agent-${name}`,
    agent_name: name,
    provider: "openai",
    model: "gpt-4.1",
    status,
    error: null,
    verdict: null,
    score: null,
    summary: null,
    duration_ms: 1000,
    cost_usd: 0.01,
    findings: [],
  };
}

function take(name: string, verdict: ConflictTake["verdict"], over: Partial<ConflictTake> = {}): ConflictTake {
  return {
    run_id: `run-${name}`,
    agent_id: `agent-${name}`,
    agent_name: name,
    finding_ids: verdict === "ignored" ? [] : [`f-${name}`],
    verdict,
    note: verdict === "ignored" ? "" : "note",
    ...over,
  };
}

const CONFLICT: FindingGroup = {
  file: "src/config.ts",
  start_line: 11,
  end_line: 14,
  title: "Hardcoded Stripe secret key",
  conflict: true,
  takes: [take("Security", "CRITICAL"), take("Style", "ignored")],
};

const AGREEMENT: FindingGroup = {
  file: "src/db.ts",
  start_line: 5,
  end_line: 5,
  title: "Missing index",
  conflict: false,
  takes: [take("Security", "WARNING"), take("Style", "WARNING")],
};

function renderIt(groups: FindingGroup[], columns: AgentColumn[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs }}>
      <Disagreements groups={groups} columns={columns} />
    </NextIntlClientProvider>,
  );
}

const TWO_DONE = [column("Security"), column("Style")];
const rowOf = (label: string) => screen.getByText(label).closest("div")!.parentElement!;

describe("Disagreements", () => {
  it("AC-37: one row per group with file:line and title, and a cell per take naming the agent, 'did not flag' for an ignored take", () => {
    renderIt([CONFLICT, AGREEMENT], TWO_DONE);

    expect(screen.getByText("Where agents disagree")).toBeInTheDocument();
    const row = rowOf("src/config.ts:11-14");
    expect(within(row).getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
    expect(within(row).getByText("Security")).toBeInTheDocument();
    expect(within(row).getByText("Style")).toBeInTheDocument();
    expect(within(row).getByText("did not flag")).toBeInTheDocument();
    expect(screen.getByText("src/db.ts:5")).toBeInTheDocument();
  });

  it("AC-37: a flagged take names its severity as text, not by an icon alone", () => {
    renderIt([CONFLICT], TWO_DONE);
    const row = rowOf("src/config.ts:11-14");
    expect(within(row).getByText(/critical/i)).toBeInTheDocument();
  });

  it("AC-38: turning on 'Show only conflicts' hides every group whose conflict is false", () => {
    renderIt([CONFLICT, AGREEMENT], TWO_DONE);
    expect(screen.getByText("src/config.ts:11-14")).toBeInTheDocument();
    expect(screen.getByText("src/db.ts:5")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Show only conflicts" }));

    expect(screen.getByText("src/config.ts:11-14")).toBeInTheDocument();
    expect(screen.queryByText("src/db.ts:5")).not.toBeInTheDocument();
  });

  it("AC-39 + EC-9: with fewer than two finished children it says so in place of the rows", () => {
    renderIt([CONFLICT], [column("Security"), column("Style", "failed")]);

    expect(screen.getByText("Needs at least two finished agents")).toBeInTheDocument();
    expect(screen.queryByText("src/config.ts:11-14")).not.toBeInTheDocument();
  });

  it("labels a take of a deleted agent 'Deleted agent'", () => {
    const group: FindingGroup = {
      ...CONFLICT,
      takes: [take("Security", "CRITICAL", { agent_id: null, agent_name: "" }), take("Style", "ignored")],
    };
    renderIt([group], TWO_DONE);

    expect(screen.getByText("Deleted agent")).toBeInTheDocument();
  });
});
