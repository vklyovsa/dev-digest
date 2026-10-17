import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { EvalDashboard as EvalDashboardData, EvalRun } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";
import commonMessages from "../../../../../messages/en/common.json";
import { createQueryClient } from "@/lib/providers";
import { formatRunTime } from "@/components/eval-runs";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/eval",
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { EvalDashboard } from "./EvalDashboard";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function run(over: Partial<EvalRun> = {}): EvalRun {
  return {
    id: "r1",
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

const AGENTS = [
  { agent_id: "a1", name: "Security Reviewer", model: "gpt-4.1", latest_run: run(), case_count: 8, run_in_progress: false, trend: [] },
  { agent_id: "a2", name: "Custom Mentor", model: "gpt-4o-mini", latest_run: null, case_count: 0, run_in_progress: false, trend: [] },
];

const RECENT = [
  run({ id: "r6", agent_version: 7 }),
  run({ id: "r5", agent_id: "a2", agent_version: 4, recall: 0.74, precision: 0.88, citation_accuracy: null, cases_passed: 13, cases_total: 18 }),
  run({ id: "r4", agent_version: 6, started_at: "2026-05-27T16:40:00Z" }),
  run({ id: "r3", agent_version: 5, started_at: "2026-05-25T11:02:00Z" }),
  run({ id: "r2", agent_version: 4, started_at: "2026-05-24T11:02:00Z" }),
  run({ id: "r1", agent_version: 3, started_at: "2026-05-23T11:02:00Z" }),
].map((r) => ({ ...r, agent_name: r.agent_id === "a2" ? "Custom Mentor" : "Security Reviewer" }));

const fetchMock = vi.fn();
let qc: QueryClient;
let dashboard: EvalDashboardData;

function mount() {
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common: commonMessages }}>
        <EvalDashboard />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  dashboard = { agents: AGENTS, recent_runs: RECENT };
  push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => json(dashboard));
  vi.stubGlobal("fetch", fetchMock);
  qc = createQueryClient();
  qc.setDefaultOptions({ queries: { retry: false } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  qc.clear();
});

describe("EvalDashboard", () => {
  it("shows an agent row with name, model, last run and the three metrics", async () => {
    mount();
    const card = (await screen.findByText("gpt-4.1")).closest("a")!;
    const time = formatRunTime("2026-05-29T09:14:00Z");

    expect(screen.getByRole("heading", { name: "Eval Dashboard" })).toBeInTheDocument();
    const inCard = within(card);
    expect(inCard.getByText("Security Reviewer")).toBeInTheDocument();
    expect(inCard.getByText(`Last run v7 · ${time} · 17/20 pass`)).toBeInTheDocument();
    expect(inCard.getByText("82%")).toBeInTheDocument();
    expect(inCard.getByText("91%")).toBeInTheDocument();
    expect(inCard.getByText("95%")).toBeInTheDocument();
    expect(inCard.getByText("RECALL")).toBeInTheDocument();
    expect(inCard.getByText("PREC")).toHaveAttribute("title", "PRECISION");
    expect(inCard.getByText("CITE")).toHaveAttribute("title", "CITATION ACCURACY");
  });

  it("shows the subtitle under the title and labels the agent list", async () => {
    mount();
    await screen.findByText("gpt-4.1");

    const subtitle = screen.getByText(evalMessages.dashboard.subtitle);
    const title = screen.getByRole("heading", { name: "Eval Dashboard" });
    const label = screen.getByText("Agents");
    expect(title.compareDocumentPosition(subtitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(subtitle.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      label.compareDocumentPosition(screen.getByText("gpt-4.1")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("draws a decorative bar beside each percentage of a recent run", async () => {
    mount();
    await screen.findByText("Recent eval runs · all agents");

    const row = screen.getAllByRole("row")[1]!;
    const bars = Array.from(row.querySelectorAll<HTMLElement>('[aria-hidden="true"]'));
    expect(bars).toHaveLength(3);
    expect(bars.map((b) => (b.firstElementChild!.firstElementChild as HTMLElement).style.width)).toEqual(["82%", "91%", "95%"]);
    expect(bars.every((b) => b.textContent === "")).toBe(true);
    expect(within(row).getByText("82%")).toBeInTheDocument();
  });

  it("says an agent has no run yet and shows a dash for each metric", async () => {
    mount();
    const card = (await screen.findByText("gpt-4o-mini")).closest("a")!;

    expect(within(card).getByText("No eval runs yet")).toBeInTheDocument();
    expect(within(card).getAllByText("—")).toHaveLength(3);
  });

  it("lists the six recent runs of all agents with version, metrics and pass ratio", async () => {
    mount();
    await screen.findByText("Recent eval runs · all agents");

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(6);
    const first = within(rows[0]!);
    expect(first.getByText("Security Reviewer")).toBeInTheDocument();
    expect(first.getByText("v7")).toBeInTheDocument();
    expect(first.getByText("17/20")).toBeInTheDocument();
    const second = within(rows[1]!);
    expect(second.getByText("Custom Mentor")).toBeInTheDocument();
    expect(second.getByText("v4")).toBeInTheDocument();
    expect(second.getByText("74%")).toBeInTheDocument();
    expect(second.getByText("—")).toBeInTheDocument();
    expect(second.getByText("13/18")).toBeInTheDocument();
  });

  it("shows the empty text when there is no recent run", async () => {
    dashboard = { agents: AGENTS, recent_runs: [] };
    mount();

    expect(
      await screen.findByText("No eval runs yet. Run an agent's eval cases from its Evals tab."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("links every agent row and every recent run to that agent's view", async () => {
    mount();
    await screen.findByText("gpt-4.1");

    expect(screen.getByText("gpt-4.1").closest("a")).toHaveAttribute("href", "/eval/a1");
    expect(screen.getByText("gpt-4o-mini").closest("a")).toHaveAttribute("href", "/eval/a2");
    const recentLinks = screen.getAllByRole("link", { name: /^(Security Reviewer|Custom Mentor)$/ });
    expect(recentLinks.map((l) => l.getAttribute("href"))).toEqual([
      "/eval/a1",
      "/eval/a2",
      "/eval/a1",
      "/eval/a1",
      "/eval/a1",
      "/eval/a1",
    ]);

    fireEvent.click(screen.getAllByRole("row")[2]!);
    expect(push).toHaveBeenCalledWith("/eval/a2");
  });

  it("offers a retry when the read fails and shows no Run all agents control until it loads", async () => {
    fetchMock.mockImplementationOnce(async () => json({ error: { message: "boom" } }, 500));
    mount();

    expect(await screen.findByText("Could not load the eval dashboard.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run all agents/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("gpt-4.1")).toBeInTheDocument();
  });

  describe("Run all agents", () => {
    const agent = (id: string, name: string, over: Record<string, unknown> = {}) => ({
      agent_id: id,
      name,
      model: `m-${id}`,
      latest_run: null,
      case_count: 4,
      run_in_progress: false,
      trend: [],
      ...over,
    });
    const posts = () => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    const runAllButton = () => screen.getByRole("button", { name: "Run all agents" });

    beforeEach(() => {
      qc.setDefaultOptions({ queries: { retry: false, staleTime: 30_000 } });
    });

    it("is disabled with a hint when no agent has cases (AC-73, AC-74, AC-79)", async () => {
      dashboard = { agents: [agent("a1", "One", { case_count: 0 })], recent_runs: [] };
      mount();
      await screen.findByText("m-a1");

      expect(runAllButton()).toBeDisabled();
      const hint = screen.getByText(evalMessages.dashboard.runAll.disabledHint);
      expect(runAllButton().getAttribute("aria-describedby")).toBe(hint.id);
    });

    it("is disabled for an empty agent list (AC-74)", async () => {
      dashboard = { agents: [], recent_runs: [] };
      mount();
      await screen.findByText("Agents");
      expect(runAllButton()).toBeDisabled();
    });

    it("summarises eligible agents and names the ones left out, sending nothing yet (AC-75)", async () => {
      dashboard = {
        agents: [
          agent("a1", "Alpha", { case_count: 8 }),
          agent("a2", "Beta", { case_count: 3 }),
          agent("a3", "Gamma", { case_count: 0 }),
          agent("a4", "Delta", { run_in_progress: true }),
        ],
        recent_runs: [],
      };
      mount();
      await screen.findByText("m-a1");
      fireEvent.click(runAllButton());

      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText(/2 agents/)).toHaveTextContent("11 eval cases");
      expect(within(dialog).getByText("Left out, no eval cases: Gamma")).toBeInTheDocument();
      expect(within(dialog).getByText("Left out, a run is in progress: Delta")).toBeInTheDocument();
      expect(posts()).toHaveLength(0);
    });

    it("starts a run for each eligible agent on confirm and shows each outcome (AC-76, AC-77)", async () => {
      dashboard = { agents: [agent("a1", "Alpha"), agent("a2", "Beta")], recent_runs: [] };
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return url.includes("/agents/a2/")
            ? json({ error: { message: "Agent has no eval cases" } }, 400)
            : json(run({ status: "running" }), 202);
        }
        return json(dashboard);
      });
      mount();
      await screen.findByText("m-a1");
      fireEvent.click(runAllButton());
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Run" }));

      expect(await screen.findByText("Run started")).toBeInTheDocument();
      expect(screen.getByText("Agent has no eval cases")).toBeInTheDocument();
      expect(posts().map((c) => c[0])).toEqual(
        expect.arrayContaining([expect.stringContaining("/agents/a1/eval-runs"), expect.stringContaining("/agents/a2/eval-runs")]),
      );
      expect(posts()).toHaveLength(2);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("sends nothing on Cancel or Escape (AC-78)", async () => {
      dashboard = { agents: [agent("a1", "Alpha")], recent_runs: [] };
      mount();
      await screen.findByText("m-a1");

      fireEvent.click(runAllButton());
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).toBeNull();

      fireEvent.click(runAllButton());
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(posts()).toHaveLength(0);
    });

    it("swaps Running to idle without a reload when run_in_progress turns false (AC-80)", async () => {
      dashboard = { agents: [agent("a1", "Alpha", { run_in_progress: true })], recent_runs: [] };
      mount();
      expect(await screen.findByText("Running…")).toBeInTheDocument();
      expect(runAllButton()).toBeDisabled();

      dashboard = { agents: [agent("a1", "Alpha")], recent_runs: [] };
      await waitFor(() => expect(screen.queryByText("Running…")).toBeNull(), { timeout: 6000 });
      expect(runAllButton()).not.toBeDisabled();
    }, 10_000);
  });

  describe("recall sparkline", () => {
    const point = (recall: number | null) => ({ recall, precision: 0.5, citation_accuracy: 0.5 });
    const withTrend = (trend: ReturnType<typeof point>[]) => {
      dashboard = { agents: [{ ...AGENTS[0]!, trend }], recent_runs: [] };
    };

    it("draws one decorative sparkline for three runs (AC-90, NFR-12)", async () => {
      withTrend([point(0.5), point(0.6), point(0.7)]);
      mount();
      const card = (await screen.findByText("gpt-4.1")).closest("a")!;

      const spark = card.querySelectorAll("[data-sparkline]");
      expect(spark).toHaveLength(1);
      expect(spark[0]).toHaveAttribute("aria-hidden", "true");
      expect(within(card).queryByRole("img")).toBeNull();
    });

    it("draws nothing for one run or for null recalls (AC-91)", async () => {
      withTrend([point(0.5)]);
      mount();
      await screen.findByText("gpt-4.1");
      expect(document.querySelector("[data-sparkline]")).toBeNull();
      cleanup();

      withTrend([point(null), point(null), point(null)]);
      mount();
      await screen.findByText("gpt-4.1");
      expect(document.querySelector("[data-sparkline]")).toBeNull();
    });
  });
});
