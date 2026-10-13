import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalCase, EvalRun } from "@devdigest/shared";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import common from "../../../../../../../../messages/en/common.json";
import shell from "../../../../../../../../messages/en/shell.json";
import { evalKeys } from "@/lib/hooks/evals";
import { EvalsTab } from "./EvalsTab";

const AGENT: Agent = {
  id: "a1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
  skill_count: 1,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const never = () => new Promise<Response>(() => {});

function makeCase(n: number, last: EvalCase["last_result"]): EvalCase {
  return {
    id: `c${n}`,
    owner_kind: "agent",
    owner_id: "a1",
    name: `case-${n}`,
    expectation_type: "must_find",
    expected_output: {
      file: "src/a.ts",
      start_line: 1,
      end_line: 2,
      severity: "high",
      category: "security",
      title: "t",
    },
    input_diff: "",
    input_files: ["src/a.ts"],
    input_meta: { pr_number: 1, pr_title: "t", pr_author: "a", pr_body: null },
    source_finding_id: null,
    notes: null,
    revision: 1,
    created_at: "2026-10-12T10:00:00Z",
    last_result: last,
  };
}

const result = (status: "pass" | "fail"): EvalCase["last_result"] => ({
  run_id: "r1",
  status,
  matched: status === "pass" ? 1 : 0,
  error: null,
});

function makeRun(over: Partial<EvalRun> = {}): EvalRun {
  return {
    id: "run1",
    agent_id: "a1",
    agent_version: 2,
    skill_id: null,
    skill_version: null,
    status: "done",
    started_at: "2026-10-12T10:00:00Z",
    duration_ms: 1000,
    recall: 0.75,
    precision: 0.9,
    citation_accuracy: 0.5,
    cases_total: 4,
    cases_passed: 3,
    cases_failed: 1,
    cases_errored: 0,
    findings_total: 4,
    findings_grounded: 2,
    cost_usd: 0.01,
    provider: "openrouter",
    model: "m",
    skills: [],
    case_ids: [],
    error: null,
    ...over,
  };
}

const FIVE = [
  makeCase(1, result("pass")),
  makeCase(2, result("pass")),
  makeCase(3, result("pass")),
  makeCase(4, result("fail")),
  makeCase(5, null),
];

let cases: () => Response | Promise<Response>;
let runs: () => Response | Promise<Response>;
let post: () => Response | Promise<Response>;
const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
const gets = (path: string) => fetchMock.mock.calls.filter(([u]) => new URL(String(u)).pathname === path).length;

let client: QueryClient;
function renderTab() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common, shell }}>
        <EvalsTab agent={AGENT} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cases = () => json(FIVE);
  runs = () => json([makeRun()]);
  post = () => json(makeCase(6, null), 201);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const { pathname } = new URL(String(input));
    if (pathname === "/agents/a1/eval-cases" && init?.method === "POST") return post();
    if (pathname === "/agents/a1/eval-cases") return cases();
    if (pathname === "/agents/a1/eval-runs") return runs();
    throw new Error(`unexpected request ${pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EvalsTab — header (AC-24, AC-61, AC-92)", () => {
  it("states the number of cases and how many of those that ran passed", async () => {
    renderTab();
    expect(await screen.findByText("5 cases")).toBeInTheDocument();
    expect(screen.getByText("3 / 4 passing")).toBeInTheDocument();
  });

  it("names the number of cases on the run control", async () => {
    renderTab();
    expect(await screen.findByRole("button", { name: "Run all evals (5)" })).toBeEnabled();
  });

  it("says that scoring is done in code with no model call", async () => {
    renderTab();
    expect(await screen.findByText(evalMessages.evalsTab.scoringNote)).toBeInTheDocument();
  });

  it("links to the full dashboard of this agent", async () => {
    renderTab();
    const link = await screen.findByRole("link", { name: evalMessages.evalsTab.viewDashboard });
    expect(link).toHaveAttribute("href", "/eval/a1");
  });
});

describe("EvalsTab — metrics (AC-60, AC-63)", () => {
  it("shows the tiles of the newest completed run", async () => {
    renderTab();
    expect((await screen.findAllByText("75%")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("90%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("50%").length).toBeGreaterThan(0);
    expect(screen.queryByText(evalMessages.evalsTab.neverRunSet)).not.toBeInTheDocument();
  });

  it("says the set was never run when there are cases and no completed run", async () => {
    runs = () => json([]);
    renderTab();
    expect(await screen.findByText(evalMessages.evalsTab.neverRunSet)).toBeInTheDocument();
    expect(screen.getAllByText(evalMessages.runs.noValue).length).toBeGreaterThan(0);
  });
});

describe("EvalsTab — no case (AC-25)", () => {
  it("shows the message, no metric value, and a disabled run control", async () => {
    cases = () => json([]);
    renderTab();
    expect(await screen.findByText(evalMessages.evalsTab.emptyCases)).toBeInTheDocument();
    screen.queryAllByText("75%").forEach((el) => expect(el.closest("table")).not.toBeNull());
    expect(screen.getByRole("button", { name: "Run all evals (0)" })).toBeDisabled();
    expect(screen.queryByText(evalMessages.evalsTab.neverRunSet)).not.toBeInTheDocument();
  });
});

describe("EvalsTab — loading (AC-26)", () => {
  it("shows the loading text of the case block while its request is pending", async () => {
    cases = never;
    renderTab();
    expect(await screen.findByText(evalMessages.evalsTab.loadingCases)).toBeInTheDocument();
    expect((await screen.findAllByText("75%")).length).toBeGreaterThan(0);
  });

  it("shows its own loading text for the metrics block", async () => {
    runs = never;
    renderTab();
    expect(await screen.findAllByText(evalMessages.dashboard.loading)).toHaveLength(2);
    expect(await screen.findByText("5 cases")).toBeInTheDocument();
  });
});

describe("EvalsTab — failure (AC-27)", () => {
  it("shows the case failure in place of the list and retries that query only", async () => {
    cases = () => json({ error: { code: "internal", message: "boom" } }, 500);
    renderTab();
    expect(await screen.findByText(evalMessages.evalsTab.loadError)).toBeInTheDocument();
    expect(screen.queryByText("5 cases")).not.toBeInTheDocument();
    expect((await screen.findAllByText("75%")).length).toBeGreaterThan(0);

    const casesBefore = gets("/agents/a1/eval-cases");
    const runsBefore = gets("/agents/a1/eval-runs");
    cases = () => json(FIVE);
    fireEvent.click(screen.getByRole("button", { name: evalMessages.evalsTab.retry }));

    expect(await screen.findByText("5 cases")).toBeInTheDocument();
    expect(gets("/agents/a1/eval-cases")).toBe(casesBefore + 1);
    expect(gets("/agents/a1/eval-runs")).toBe(runsBefore);
  });

  it("shows the run failure in place of the tiles and refetches the runs on retry", async () => {
    runs = () => json({ error: { code: "internal", message: "runs down" } }, 500);
    renderTab();
    const alerts = await screen.findAllByRole("alert");
    const alert = alerts.find((a) => a.textContent?.includes("runs down"))!;
    expect(alert).toHaveTextContent(evalMessages.evalsTab.runsLoadError);
    expect(screen.queryByText(evalMessages.evalsTab.loadError)).not.toBeInTheDocument();
    expect(screen.queryAllByText("75%")).toHaveLength(0);
    expect(await screen.findByText("5 cases")).toBeInTheDocument();

    const before = gets("/agents/a1/eval-runs");
    runs = () => json([makeRun()]);
    const retry = screen.getAllByRole("button", { name: evalMessages.evalsTab.retry })[0]!;
    fireEvent.click(retry);

    expect((await screen.findAllByText("75%")).length).toBeGreaterThan(0);
    expect(gets("/agents/a1/eval-runs")).toBe(before + 1);
  });
});

describe("EvalsTab — a run that settles (AC-48)", () => {
  it("replaces the running state with tiles and a history row, with no reload", async () => {
    runs = () => json([makeRun({ status: "running", recall: null, precision: null, citation_accuracy: null })]);
    renderTab();

    expect(await screen.findByRole("button", { name: evalMessages.runs.runningLabel })).toBeDisabled();
    expect(screen.queryAllByText("75%")).toHaveLength(0);

    runs = () => json([makeRun()]);
    await act(async () => {
      await client.refetchQueries({ queryKey: evalKeys.runs("a1") });
    });

    expect((await screen.findAllByText("75%")).length).toBeGreaterThan(0);
    const table = screen.getByRole("table");
    expect(within(table).getByText("3/4")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Run all evals (5)" })).toBeEnabled());
  });
});

describe("EvalsTab — metric trend (AC-1, AC-19, AC-20, AC-25)", () => {
  const heading = () => screen.getByRole("heading", { name: evalMessages.dashboard.metricTrend });
  const versionLabels = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("svg text")).filter((el) => /^v\d+$/.test(el.textContent ?? ""));

  it("stands after the metric tiles and their scoring note, before the case list", async () => {
    renderTab();
    const note = await screen.findByText(evalMessages.evalsTab.scoringNote);
    const cases = await screen.findByText("5 cases");
    const tile = (await screen.findAllByText("75%"))[0]!;

    expect(tile.compareDocumentPosition(heading()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(heading()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading().compareDocumentPosition(cases) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the failure of the run list in the chart, with no tick label", async () => {
    runs = () => json({ error: { code: "internal", message: "runs down" } }, 500);
    const { container } = renderTab();

    expect(await screen.findByText(evalMessages.trend.loadError)).toBeInTheDocument();
    expect(container.querySelectorAll("svg text")).toHaveLength(0);
  });

  it("adds a version label when the running run settles, with no reload", async () => {
    runs = () => json([makeRun({ id: "run2", agent_version: 3, status: "running", recall: null, precision: null, citation_accuracy: null })]);
    const { container } = renderTab();
    await screen.findByRole("button", { name: evalMessages.runs.runningLabel });
    expect(versionLabels(container)).toHaveLength(0);

    runs = () => json([makeRun({ id: "run2", agent_version: 3 })]);
    await act(async () => {
      await client.refetchQueries({ queryKey: evalKeys.runs("a1") });
    });

    await waitFor(() => expect(versionLabels(container).map((el) => el.textContent)).toEqual(["v3"]));
  });

  it("reads the run list once and sends no other request on hover and arrow keys", async () => {
    runs = () =>
      json([
        makeRun({ id: "run2", agent_version: 3 }),
        makeRun({ id: "run1", agent_version: 2 }),
      ]);
    const { container } = renderTab();
    await screen.findByText("5 cases");
    await waitFor(() => expect(versionLabels(container)).toHaveLength(2));
    const calls = fetchMock.mock.calls.length;
    expect(gets("/agents/a1/eval-runs")).toBe(1);

    fireEvent.mouseEnter(container.querySelector("[data-run-band='0']")!);
    const plot = screen.getByRole("group", { name: /Metric trend/ });
    fireEvent.keyDown(plot, { key: "ArrowRight" });
    fireEvent.keyDown(plot, { key: "ArrowRight" });

    expect(gets("/agents/a1/eval-runs")).toBe(1);
    expect(fetchMock.mock.calls).toHaveLength(calls);
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);
  });
});

describe("EvalsTab — case editor (AC-26, AC-27, AC-37, AC-41)", () => {
  const newButton = () => screen.getByRole("button", { name: evalMessages.caseEditor.newCase });
  const change = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

  it("offers the New eval case control beside the run control for a list of cases", async () => {
    renderTab();
    const run = await screen.findByRole("button", { name: "Run all evals (5)" });
    expect(newButton()).toBeEnabled();
    expect(newButton().parentElement).toContainElement(run);
  });

  it("offers it for an empty list too", async () => {
    cases = () => json([]);
    renderTab();
    await screen.findByText(evalMessages.evalsTab.emptyCases);
    expect(newButton()).toBeEnabled();
  });

  it("renders with the editor closed", async () => {
    renderTab();
    await screen.findByText("5 cases");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens an empty editor for a new case", async () => {
    renderTab();
    await screen.findByText("5 cases");
    fireEvent.click(newButton());
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(evalMessages.caseEditor.newCase)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue("");
  });

  it("opens the editor with the row's case on its edit control", async () => {
    renderTab();
    await screen.findByText("5 cases");
    fireEvent.click(screen.getByRole("button", { name: "Edit case-2" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Eval case · case-2")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue("case-2");
  });

  it("shows the saved case's row and closes the editor, without a reload", async () => {
    renderTab();
    await screen.findByText("5 cases");
    fireEvent.click(newButton());
    const dialog = screen.getByRole("dialog");
    change(within(dialog).getByLabelText(/^Name/), "case-6");
    change(
      within(dialog).getByLabelText(/^Diff/),
      "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,2 @@\n kept\n+added",
    );
    change(within(dialog).getByLabelText(/^Start line/), "1");
    change(within(dialog).getByLabelText(/^End line/), "2");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Run after saving" }));

    cases = () => json([...FIVE, makeCase(6, null)]);
    fireEvent.click(within(dialog).getByRole("button", { name: /^Save/ }));

    expect(await screen.findByText("6 cases")).toBeInTheDocument();
    expect(screen.getByText("case-6")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
