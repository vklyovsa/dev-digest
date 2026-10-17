import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalCase, EvalRun, Skill } from "@devdigest/shared";
import evalMessages from "../../../../../../../messages/en/eval.json";
import common from "../../../../../../../messages/en/common.json";
import shell from "../../../../../../../messages/en/shell.json";
import { evalKeys } from "@/lib/hooks/evals";
import { EvalsTab } from "./EvalsTab";

const SKILL: Skill = {
  id: "sk1",
  name: "repo-conventions",
  description: "d",
  type: "convention",
  source: "extracted",
  body: "# b",
  enabled: true,
  version: 3,
  evidence_files: null,
  agent_count: 1,
};

const agentOf = (id: string, name: string): Agent => ({
  id,
  name,
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "p",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
  skill_count: 1,
});
const AGENTS = [agentOf("a1", "Alpha"), agentOf("a2", "Beta"), agentOf("a3", "Gamma")];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const never = () => new Promise<Response>(() => {});

function makeCase(n: number, last: EvalCase["last_result"]): EvalCase {
  return {
    id: `c${n}`,
    owner_kind: "skill",
    owner_id: "sk1",
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
    agent_version: 1,
    skill_id: "sk1",
    skill_version: 3,
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

const THREE = [makeCase(1, result("pass")), makeCase(2, result("fail")), makeCase(3, null)];

let cases: () => Response | Promise<Response>;
let runs: () => Response | Promise<Response>;
let agents: () => Response | Promise<Response>;
let linked: () => Response | Promise<Response>;
const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
const gets = (path: string) =>
  fetchMock.mock.calls.filter(([u, i]) => new URL(String(u)).pathname === path && (i?.method ?? "GET") === "GET").length;
const writes = () => fetchMock.mock.calls.filter(([, i]) => (i?.method ?? "GET") !== "GET");

let client: QueryClient;
function renderTab(skill: Skill = SKILL) {
  client = new QueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: 30_000 } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common, shell }}>
        <EvalsTab skill={skill} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cases = () => json(THREE);
  runs = () => json([makeRun()]);
  agents = () => json(AGENTS);
  linked = () => json([{ id: "a2", name: "Beta", enabled: true, order: 0 }]);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const { pathname } = new URL(String(input));
    if (pathname === "/skills/sk1/eval-cases") return cases();
    if (pathname === "/skills/sk1/eval-runs") return runs();
    if (pathname === "/agents") return agents();
    if (pathname === "/skills/sk1/agents") return linked();
    throw new Error(`unexpected request ${pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const select = () => screen.getByLabelText("Host agent") as HTMLSelectElement;
const optionTexts = () => Array.from(select().options).map((o) => o.textContent);

describe("skill EvalsTab — reads and cases", () => {
  it("makes four reads and no write (AC-39)", async () => {
    renderTab();
    await screen.findByText("3 cases");
    await waitFor(() => expect(select()).toBeInTheDocument());
    expect(gets("/skills/sk1/eval-cases")).toBe(1);
    expect(gets("/skills/sk1/eval-runs")).toBe(1);
    expect(gets("/agents")).toBe(1);
    expect(gets("/skills/sk1/agents")).toBe(1);
    expect(writes()).toHaveLength(0);
  });

  it("shows the empty state with a New eval case button (AC-40)", async () => {
    cases = () => json([]);
    renderTab();
    expect(await screen.findByText(evalMessages.skillEvals.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(evalMessages.skillEvals.emptyBody)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: evalMessages.caseEditor.newCase }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("lists the cases with a passing count and both controls (AC-41)", async () => {
    renderTab();
    expect(await screen.findByText("1 / 2 passing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all evals (3)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: evalMessages.caseEditor.newCase })).toBeEnabled();
  });

  it("shows pending reads as loading texts (AC-43)", async () => {
    cases = never;
    runs = never;
    renderTab();
    expect(await screen.findByText(evalMessages.evalsTab.loadingCases)).toBeInTheDocument();
    expect(screen.getByText(evalMessages.dashboard.loading)).toBeInTheDocument();
  });

  it("shows a failure per read and retries only that read (AC-44)", async () => {
    cases = () => json({ error: { code: "internal", message: "boom" } }, 500);
    runs = () => json({ error: { code: "internal", message: "runs down" } }, 500);
    renderTab();
    expect(await screen.findByText(evalMessages.evalsTab.loadError)).toBeInTheDocument();
    expect((await screen.findAllByText(/runs down/)).length).toBeGreaterThan(0);

    const casesBefore = gets("/skills/sk1/eval-cases");
    const runsBefore = gets("/skills/sk1/eval-runs");
    cases = () => json(THREE);
    const retries = screen.getAllByRole("button", { name: evalMessages.evalsTab.retry });
    fireEvent.click(retries[retries.length - 1]!);
    expect(await screen.findByText("3 cases")).toBeInTheDocument();
    expect(gets("/skills/sk1/eval-cases")).toBe(casesBefore + 1);

    runs = () => json([makeRun()]);
    fireEvent.click(screen.getByRole("button", { name: evalMessages.evalsTab.retry }));
    expect((await screen.findAllByText("75%")).length).toBeGreaterThan(0);
    expect(gets("/skills/sk1/eval-runs")).toBeGreaterThan(runsBefore);
  });
});

describe("skill EvalsTab — host", () => {
  it("lists the linked agent first (AC-45)", async () => {
    renderTab();
    await waitFor(() => expect(optionTexts()).toHaveLength(3));
    expect(optionTexts()).toEqual(["Beta · gpt-4.1", "Alpha · gpt-4.1", "Gamma · gpt-4.1"]);
  });

  it("selects the host of the newest run, else the first linked, else the first (AC-46)", async () => {
    runs = () => json([makeRun({ agent_id: "a3" })]);
    renderTab();
    await waitFor(() => expect(select().value).toBe("a3"));
    cleanup();

    runs = () => json([]);
    renderTab();
    await waitFor(() => expect(select().value).toBe("a2"));
    cleanup();

    linked = () => json([]);
    renderTab();
    await waitFor(() => expect(select().value).toBe("a1"));
  });

  it("without any agent disables the run controls, describes them and keeps New enabled (AC-47)", async () => {
    agents = () => json([]);
    linked = () => json([]);
    renderTab();
    const hint = await screen.findByText(evalMessages.skillEvals.noHostHint);
    const run = await screen.findByRole("button", { name: "Run all evals (3)" });
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute("aria-describedby", hint.id);
    expect(screen.getByRole("button", { name: evalMessages.caseEditor.newCase })).toBeEnabled();
  });

  it("changing the host sends no request that writes (NFR-1)", async () => {
    renderTab();
    await waitFor(() => expect(optionTexts()).toHaveLength(3));
    fireEvent.change(select(), { target: { value: "a3" } });
    expect(select().value).toBe("a3");
    expect(writes()).toHaveLength(0);
  });

  it("opens the case editor naming the skill and the selected host (AC-59)", async () => {
    renderTab();
    await waitFor(() => expect(optionTexts()).toHaveLength(3));
    fireEvent.change(select(), { target: { value: "a3" } });
    fireEvent.click(screen.getByRole("button", { name: evalMessages.caseEditor.newCase }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/repo-conventions/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Gamma/)).toBeInTheDocument();
  });

  it("renders an agent name as text, never as markup (NFR-7)", async () => {
    agents = () => json([agentOf("a1", "<img src=x onerror=alert(1)>")]);
    linked = () => json([]);
    const { container } = renderTab();
    await waitFor(() => expect(optionTexts()[0]).toContain("<img src=x onerror=alert(1)>"));
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("skill EvalsTab — notices and metrics", () => {
  it("says a disabled skill still evaluates its saved body (AC-48)", async () => {
    renderTab({ ...SKILL, enabled: false });
    expect(await screen.findByText(evalMessages.skillEvals.disabledNotice)).toBeInTheDocument();
  });

  it("does not show the notice for an enabled skill", async () => {
    renderTab();
    await screen.findByText("3 cases");
    expect(screen.queryByText(evalMessages.skillEvals.disabledNotice)).not.toBeInTheDocument();
  });

  it("reads the new tiles and one more cases read when a run settles (AC-52)", async () => {
    runs = () => json([makeRun({ status: "running", recall: null, precision: null, citation_accuracy: null })]);
    renderTab();
    expect(await screen.findByRole("button", { name: evalMessages.runs.runningLabel })).toBeDisabled();
    const before = gets("/skills/sk1/eval-cases");

    runs = () => json([makeRun()]);
    await act(async () => {
      await client.refetchQueries({ queryKey: evalKeys.runs("sk1", "skill") });
    });
    expect((await screen.findAllByText("75%")).length).toBeGreaterThan(0);
    await waitFor(() => expect(gets("/skills/sk1/eval-cases")).toBeGreaterThan(before));
  });

  it("shows a dash and no change for a null metric of two runs (AC-54)", async () => {
    runs = () =>
      json([makeRun({ id: "r2", recall: null }), makeRun({ id: "r1", recall: 0.5, started_at: "2026-10-11T10:00:00Z" })]);
    renderTab();
    const label = (await screen.findAllByText(evalMessages.runs.metrics.recall))[0]!;
    const tile = label.parentElement!;
    expect(within(tile).getByText(evalMessages.runs.noValue)).toBeInTheDocument();
    expect(within(tile).queryByText(/pt$/)).not.toBeInTheDocument();
  });

  it("says the set was never run when no run completed (AC-55)", async () => {
    runs = () => json([]);
    renderTab();
    expect(await screen.findByText(evalMessages.evalsTab.neverRunSet)).toBeInTheDocument();
  });

  it("finds the select by its visible label and alerts on a refused start (NFR-12)", async () => {
    renderTab();
    await waitFor(() => expect(select()).toBeInTheDocument());
    fetchMock.mockImplementationOnce(async () => json({ error: { code: "bad_request", message: "no host" } }, 400));
    fireEvent.click(await screen.findByRole("button", { name: "Run all evals (3)" }));
    expect(await screen.findByText("no host")).toBeInTheDocument();
    expect(screen.getAllByRole("alert").some((a) => a.textContent === "no host")).toBe(true);
  });

  it("renders from the real message files without a missing key (NFR-11)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    renderTab();
    await screen.findByText("3 cases");
    expect(error.mock.calls.filter(([m]) => String(m).includes("MISSING_MESSAGE"))).toHaveLength(0);
    error.mockRestore();
  });
});
