import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalCase, EvalCaseOutcome, EvalRun, EvalRunCompare, EvalRunDetail } from "@devdigest/shared";
import evalMessages from "../../../../../../messages/en/eval.json";
import { createQueryClient } from "@/lib/providers";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/eval/a1",
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { AgentEvalView } from "./AgentEvalView";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function run(over: Partial<EvalRun> = {}): EvalRun {
  return {
    id: "r2",
    agent_id: "a1",
    agent_version: 7,
    skill_id: null,
    skill_version: null,
    status: "done",
    started_at: "2026-05-29T09:14:00Z",
    duration_ms: 1200,
    recall: 0.82,
    precision: 0.91,
    citation_accuracy: 0.95,
    cases_total: 20,
    cases_passed: 17,
    cases_failed: 3,
    cases_errored: 0,
    findings_total: 30,
    findings_grounded: 28,
    cost_usd: 0.23,
    provider: "openrouter",
    model: "m",
    skills: [],
    case_ids: [],
    error: null,
    ...over,
  };
}

const agent = (id: string, name: string, model: string): Agent =>
  ({ id, name, model, description: "", provider: "openrouter", system_prompt: "", enabled: true, version: 7 }) as Agent;

const evalCase = (id: string): EvalCase =>
  ({ id, owner_kind: "agent", owner_id: "a1", name: id, last_result: null }) as unknown as EvalCase;

const outcome = (over: Partial<EvalCaseOutcome>): EvalCaseOutcome => ({
  case_id: "c1",
  case_name: "no-stripe-key",
  case_revision: 1,
  expectation_type: "must_not_flag",
  status: "pass",
  matched: 0,
  findings: [],
  error: null,
  ...over,
});

const side = (r: EvalRun, prompt: string) => ({
  run_id: r.id,
  agent_version: r.agent_version,
  system_prompt: prompt,
  provider: "p",
  model: "m",
  skills: [],
  started_at: r.started_at,
  recall: r.recall,
  precision: r.precision,
  citation_accuracy: r.citation_accuracy,
  cost_usd: r.cost_usd,
  cases_total: r.cases_total,
  cases_passed: r.cases_passed,
});

const LATEST = run({ id: "r2", agent_version: 7, precision: 0.91 });
const PREVIOUS = run({
  id: "r1",
  agent_version: 6,
  started_at: "2026-05-27T16:40:00Z",
  recall: 0.78,
  precision: 0.93,
  citation_accuracy: 0.94,
  cases_passed: 16,
  cost_usd: 0.21,
});

const fetchMock = vi.fn();
let qc: QueryClient;
let runs: EvalRun[];
let details: Record<string, EvalRunDetail>;

function route(url: string, init?: RequestInit) {
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  if (init?.method === "POST") return json({ ...run({ id: "r3", status: "running" }), recall: null });
  if (path.includes("/eval-runs/compare")) {
    const compare: EvalRunCompare = {
      base: side(PREVIOUS, "old"),
      head: side(LATEST, "new"),
      cases_only_in_base: [],
      cases_only_in_head: [],
      cases_edited: [],
    };
    return json(compare);
  }
  if (path === "/agents/a1/eval-runs") return json(runs);
  if (path === "/agents/a1/eval-cases") return json([evalCase("c1"), evalCase("c2"), evalCase("c3")]);
  if (path === "/agents/a1") return json(agent("a1", "Security Reviewer", "gpt-4.1"));
  if (path === "/agents") return json([agent("a1", "Security Reviewer", "gpt-4.1"), agent("a2", "Custom Mentor", "gpt-4o")]);
  const detailId = /^\/eval-runs\/(\w+)$/.exec(path)?.[1];
  if (detailId && details[detailId]) return json(details[detailId]);
  return json({ error: { message: "not found" } }, 404);
}

function mount() {
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <AgentEvalView agentId="a1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const detailCalls = () =>
  fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => /\/eval-runs\/r\d$/.test(u));

beforeEach(() => {
  runs = [LATEST, PREVIOUS];
  details = {
    r2: { ...LATEST, results: [outcome({ case_id: "c1", status: "fail" })] },
    r1: { ...PREVIOUS, results: [outcome({ case_id: "c1", status: "pass" })] },
  };
  push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => route(String(url), init));
  vi.stubGlobal("fetch", fetchMock);
  qc = createQueryClient();
  qc.setDefaultOptions({ queries: { retry: false, staleTime: 30_000 } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  qc.clear();
});

describe("AgentEvalView", () => {
  it("shows the agent's header and the two navigation targets", async () => {
    mount();

    expect(await screen.findByRole("heading", { name: "Security Reviewer" })).toBeInTheDocument();
    expect(screen.getByText("gpt-4.1")).toBeInTheDocument();
    expect(await screen.findByText("2 runs · 3 cases")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All agents" })).toHaveAttribute("href", "/eval");

    fireEvent.click(screen.getByRole("button", { name: "Switch agent: Security Reviewer" }));
    expect(screen.queryByRole("button", { name: "Security Reviewer" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Custom Mentor" }));
    expect(push).toHaveBeenCalledWith("/eval/a2");
  });

  it("says the agent's evals could not be loaded and retries the agent read", async () => {
    let failing = true;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      failing && String(url).endsWith("/agents/a1")
        ? json({ error: { message: "boom" } }, 500)
        : route(String(url), init),
    );
    mount();

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this agent's evals.");
    expect(screen.queryByText("Could not load the eval dashboard.")).toBeNull();

    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Security Reviewer" })).toBeInTheDocument();
  });

  it("shows tiles from the two newest completed runs with the change", async () => {
    mount();
    await screen.findAllByRole("checkbox");

    expect(screen.getAllByText("RECALL").length).toBeGreaterThan(0);
    expect(screen.getByText("4pt")).toBeInTheDocument();
    expect(screen.getByText("2pt")).toBeInTheDocument();
    expect(screen.getByText("1pt")).toBeInTheDocument();
    expect(screen.getByText("CASES PASSED")).toBeInTheDocument();
  });

  it("selects two runs, opens the compare view and starts a run", async () => {
    mount();
    const boxes = await screen.findAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));

    expect(await screen.findByText("Compare runs · v6 → v7")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]!);

    fireEvent.click(await screen.findByRole("button", { name: "Run eval (3)" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, i]) => String(u).endsWith("/agents/a1/eval-runs") && i?.method === "POST")).toBe(true),
    );
  });

  it("names the size and version of a precision dip", async () => {
    mount();
    expect(await screen.findByText("Precision dipped 2pts on v7")).toBeInTheDocument();
  });

  it("shows no banner when precision did not fall", async () => {
    runs = [LATEST, { ...PREVIOUS, precision: 0.91 }];
    mount();
    await screen.findAllByRole("checkbox");
    await act(async () => {});

    expect(screen.queryByText(/Precision dipped/)).toBeNull();
    expect(detailCalls()).toEqual([]);
  });

  it("names a must-not-flag case that newly fails", async () => {
    mount();
    expect(
      await screen.findByText("Newly failing must-not-flag cases: no-stripe-key"),
    ).toBeInTheDocument();
  });

  it("ends the banner after the version when no such case newly fails", async () => {
    details.r2 = { ...LATEST, results: [outcome({ case_id: "c1", status: "pass" })] };
    mount();
    await screen.findByText("Precision dipped 2pts on v7");
    await waitFor(() => expect(detailCalls()).toHaveLength(2));
    await act(async () => {});

    expect(screen.queryByText(/Newly failing/)).toBeNull();
  });

  describe("metric trend", () => {
    const sparklines = () => document.querySelectorAll("[data-sparkline]");

    it("stands between the tiles and the run history table", async () => {
      mount();
      const table = await screen.findByRole("table");
      const heading = screen.getByRole("heading", { name: "Metric trend" });
      const tile = screen.getByText("CASES PASSED");

      expect(tile.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(heading.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("draws a sparkline per metric tile from three plotted runs", async () => {
      runs = [LATEST, PREVIOUS, run({ id: "r0", agent_version: 5, started_at: "2026-05-25T10:00:00Z" })];
      mount();
      await screen.findByRole("table");

      expect(sparklines()).toHaveLength(3);
      sparklines().forEach((el) => expect(el).toHaveAttribute("aria-hidden", "true"));
    });

    it("draws no sparkline from one plotted run", async () => {
      runs = [LATEST];
      mount();
      await screen.findByRole("table");

      expect(screen.getByText("Last 1 run")).toBeInTheDocument();
      expect(sparklines()).toHaveLength(0);
    });

    it("reads the run list once and sends no new request on hover and arrow keys", async () => {
      mount();
      await screen.findByText("Last 2 runs");
      await act(async () => {});
      const runListCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/agents/a1/eval-runs")).length;
      const before = fetchMock.mock.calls.length;
      expect(runListCalls()).toBe(1);

      fireEvent.mouseEnter(document.querySelector("[data-run-band='0']")!);
      const plot = screen.getByRole("group", { name: /Metric trend/ });
      fireEvent.keyDown(plot, { key: "ArrowRight" });
      fireEvent.keyDown(plot, { key: "ArrowLeft" });

      expect(runListCalls()).toBe(1);
      expect(fetchMock.mock.calls).toHaveLength(before);
    });
  });
});
