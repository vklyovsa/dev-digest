import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn, FindingRecord, MultiAgentRun } from "@devdigest/shared";
import runs from "../../../../../../../messages/en/runs.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useParams: () => ({ repoId: "r1" }),
}));

vi.mock("@/lib/hooks/reviews", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hooks/reviews")>()),
  useFindingAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRunEvents: () => ({ events: [], running: false }),
}));

vi.mock("@/components/run-trace-drawer", () => ({
  default: (p: { runId: string; agentName?: string | null; running?: boolean }) => (
    <div data-testid="drawer" data-run-id={p.runId} data-running={String(p.running)}>
      {p.agentName}
    </div>
  ),
}));

import { MultiAgentResults } from "./MultiAgentResults";

let seq = 0;
function finding(over: Partial<FindingRecord> = {}): FindingRecord {
  seq += 1;
  return {
    id: `f${seq}`,
    severity: "WARNING",
    category: "bug",
    title: `finding ${seq}`,
    file: "src/a.ts",
    start_line: 10,
    end_line: 10,
    rationale: "because",
    confidence: 0.5,
    review_id: "rev",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

function column(name: string, over: Partial<AgentColumn> = {}): AgentColumn {
  return {
    run_id: `run-${name}`,
    agent_id: `agent-${name}`,
    agent_name: name,
    provider: "openai",
    model: "gpt-4.1",
    status: "done",
    error: null,
    verdict: "comment",
    score: 80,
    summary: "ok",
    duration_ms: 2000,
    cost_usd: 0.01,
    findings: [],
    ...over,
  };
}

function makeRun(columns: AgentColumn[]): MultiAgentRun {
  return {
    id: "mar-1",
    pr_id: "pr1",
    pr_number: 482,
    pr_title: "Add rate limiting",
    ran_at: "2026-10-18T10:00:00Z",
    agent_count: columns.length,
    total_duration_ms: 4000,
    total_cost_usd: 0.03,
    columns,
    groups: [],
  };
}

function renderResults(run: MultiAgentRun) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ runs }}>
        <MultiAgentResults run={run} repoId="r1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const columnOf = (name: string) => screen.getByText(name).closest("div")!.parentElement!.parentElement!.parentElement!;

beforeEach(() => {
  push.mockReset();
});
afterEach(cleanup);

describe("MultiAgentResults — Columns mode", () => {
  const f1 = finding({ title: "Hardcoded secret", file: "src/config.ts", start_line: 11, end_line: 14 });
  const f2 = finding({ title: "Missing index", file: "src/db.ts", start_line: 5, end_line: 5 });

  it("AC-18: one column per child in the given order with name, status, duration · cost, score, each finding's title and file:line, the count and a View trace button", () => {
    renderResults(
      makeRun([
        column("Alpha", { findings: [f1, f2] }),
        column("Beta", { status: "running", duration_ms: null, cost_usd: null, score: null }),
        column("Gamma", { status: "cancelled", duration_ms: null, cost_usd: null, score: null }),
      ]),
    );

    const names = ["Alpha", "Beta", "Gamma"].map((n) => screen.getByText(n));
    expect(names[0]!.compareDocumentPosition(names[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(names[1]!.compareDocumentPosition(names[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const alpha = within(columnOf("Alpha"));
    expect(alpha.getByText("done")).toBeInTheDocument();
    expect(alpha.getByText("2.0s · $0.010")).toBeInTheDocument();
    expect(alpha.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(alpha.getByText("src/config.ts:11-14")).toBeInTheDocument();
    expect(alpha.getByText("Missing index")).toBeInTheDocument();
    expect(alpha.getByText("src/db.ts:5")).toBeInTheDocument();
    expect(alpha.getByText("2 findings")).toBeInTheDocument();
    expect(alpha.getByRole("button", { name: "View trace" })).toBeInTheDocument();

    expect(within(columnOf("Beta")).getByText("running")).toBeInTheDocument();
    expect(within(columnOf("Gamma")).getByText("cancelled")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "View trace" })).toHaveLength(3);
  });

  it("AC-19: the header shows the PR number and title, the agent count, the longest duration and the summed cost", () => {
    renderResults(makeRun([column("Alpha"), column("Beta"), column("Gamma")]));

    expect(screen.getByText("#482")).toBeInTheDocument();
    expect(screen.getByText("Add rate limiting")).toBeInTheDocument();
    expect(screen.getByText("3 agents · parallel · 4.0s total · $0.030")).toBeInTheDocument();
  });

  it("AC-23: a failed column shows the status failed and the stored error while the other columns keep their findings", () => {
    renderResults(
      makeRun([
        column("Alpha", { findings: [f1] }),
        column("Beta", { status: "failed", error: "provider exploded", score: null }),
        column("Gamma", { findings: [f2] }),
      ]),
    );

    const beta = within(columnOf("Beta"));
    expect(beta.getByText("failed")).toBeInTheDocument();
    expect(beta.getByText("provider exploded")).toBeInTheDocument();
    expect(within(columnOf("Alpha")).getByText("Hardcoded secret")).toBeInTheDocument();
    expect(within(columnOf("Gamma")).getByText("Missing index")).toBeInTheDocument();
  });

  it("AC-24: a column whose agent was deleted is labelled 'Deleted agent'", () => {
    renderResults(makeRun([column("Alpha"), column("", { agent_id: null, agent_name: "", run_id: "run-gone" })]));

    expect(screen.getByText("Deleted agent")).toBeInTheDocument();
  });

  it("NFR-4: markup in a finding title, PR title and agent name renders as text, never as an element", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const run = makeRun([column(evil, { findings: [finding({ title: evil })] })]);
    run.pr_title = evil;
    const { container } = renderResults(run);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getAllByText(evil).length).toBeGreaterThanOrEqual(3);
  });

  it("AC-46: Start new review opens Configure run with the run's PR and its agents preselected, leaving a deleted agent out", () => {
    renderResults(
      makeRun([column("Alpha"), column("Beta"), column("", { agent_id: null, agent_name: "", run_id: "run-gone" })]),
    );

    fireEvent.click(screen.getByRole("button", { name: "Start new review" }));

    expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent/new?pr=pr1&agents=agent-Alpha,agent-Beta");
  });

  it("AC-40 + AC-41: View trace opens the drawer for that child, on the live log when the child is running", () => {
    renderResults(makeRun([column("Alpha"), column("Beta", { status: "running" })]));

    fireEvent.click(within(columnOf("Alpha")).getByRole("button", { name: "View trace" }));
    expect(screen.getByTestId("drawer")).toHaveAttribute("data-run-id", "run-Alpha");
    expect(screen.getByTestId("drawer")).toHaveAttribute("data-running", "false");
    expect(screen.getByTestId("drawer")).toHaveTextContent("Alpha");

    fireEvent.click(within(columnOf("Beta")).getByRole("button", { name: "View trace" }));
    expect(screen.getByTestId("drawer")).toHaveAttribute("data-run-id", "run-Beta");
    expect(screen.getByTestId("drawer")).toHaveAttribute("data-running", "true");
  });

  it("NFR-9: the Columns / Tabs switch is two named buttons", () => {
    renderResults(makeRun([column("Alpha")]));

    expect(screen.getByRole("button", { name: "columns" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "tabs" })).toHaveAttribute("aria-pressed", "false");
  });
});
