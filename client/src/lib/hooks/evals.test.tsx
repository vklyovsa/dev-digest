import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type {
  EvalCase,
  EvalCaseCreateInput,
  EvalCaseTryInput,
  EvalCaseUpdateInput,
  EvalRun,
} from "@devdigest/shared";
import { createQueryClient } from "../providers";
import { ApiError } from "../api";
import {
  EVAL_RUN_POLL_MS,
  evalKeys,
  useCreateManualEvalCase,
  useEvalCompare,
  useEvalCaseDraft,
  useDeleteEvalCase,
  useEvalCases,
  useEvalRuns,
  useSaveEvalCaseFromFinding,
  useSkillEvalCompare,
  useStartEvalRunsForAgents,
  useStartEvalRun,
  useTryEvalCase,
  useUpdateEvalCase,
} from "./evals";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function run(over: Partial<EvalRun> = {}): EvalRun {
  return {
    id: "run1",
    agent_id: "a1",
    agent_version: 2,
    skill_id: null,
    skill_version: null,
    status: "running",
    started_at: "2026-10-12T10:00:00Z",
    duration_ms: null,
    recall: null,
    precision: null,
    citation_accuracy: null,
    cases_total: 8,
    cases_passed: 0,
    cases_failed: 0,
    cases_errored: 0,
    findings_total: 0,
    findings_grounded: 0,
    cost_usd: null,
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    skills: [],
    case_ids: [],
    error: null,
    ...over,
  };
}

const CASE: EvalCase = {
  id: "c1",
  owner_kind: "agent",
  owner_id: "a1",
  name: "must-find-leaked-key",
  expectation_type: "must_find",
  expected_output: {
    file: "src/config.ts",
    start_line: 4,
    end_line: 6,
    severity: "high",
    category: "security",
    title: "Leaked key",
  },
  input_diff: "diff --git a/src/config.ts b/src/config.ts",
  input_files: ["src/config.ts"],
  input_meta: { pr_number: 7, pr_title: "Add key", pr_author: "dev", pr_body: null },
  source_finding_id: "f1",
  notes: null,
  revision: 1,
  created_at: "2026-10-12T09:00:00Z",
  last_result: null,
};

const fetchMock = vi.fn();
let qc: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));
const runListCalls = () => urls().filter((u) => u.endsWith("/agents/a1/eval-runs")).length;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  qc = createQueryClient();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  qc.clear();
});

describe("useEvalRuns", () => {
  it("polls while the newest run is running, stops when it is done and refreshes the cases", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let list: EvalRun[] = [run()];
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith("/agents/a1/eval-runs") ? json(list) : json([]),
    );
    qc.setQueryData(evalKeys.cases("a1"), [CASE]);
    qc.setQueryData(evalKeys.dashboard(), { agents: [], recent_runs: [] });
    const { result } = renderHook(() => useEvalRuns("a1"), { wrapper });

    await waitFor(() => expect(result.current.data?.[0]?.status).toBe("running"));
    expect(runListCalls()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVAL_RUN_POLL_MS + 50);
    });
    await waitFor(() => expect(runListCalls()).toBe(2));

    list = [run({ status: "done", recall: 1, precision: 1, citation_accuracy: 1, duration_ms: 900 })];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVAL_RUN_POLL_MS + 50);
    });
    await waitFor(() => expect(result.current.data?.[0]?.status).toBe("done"));

    expect(qc.getQueryState(evalKeys.cases("a1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(evalKeys.dashboard())?.isInvalidated).toBe(true);

    const settled = runListCalls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVAL_RUN_POLL_MS * 3);
    });
    expect(runListCalls()).toBe(settled);
  });

  it("does not poll when the newest run is already done on first read", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValue(json([run({ status: "done" })]));
    qc.setQueryData(evalKeys.cases("a1"), [CASE]);
    const { result } = renderHook(() => useEvalRuns("a1"), { wrapper });

    await waitFor(() => expect(result.current.data?.[0]?.status).toBe("done"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVAL_RUN_POLL_MS * 2);
    });

    expect(runListCalls()).toBe(1);
    expect(qc.getQueryState(evalKeys.cases("a1"))?.isInvalidated).toBe(false);
  });
});

describe("useStartEvalRun", () => {
  it("puts the 202 run at the head of the cached run list", async () => {
    const older = run({ id: "run0", status: "done" });
    qc.setQueryData(evalKeys.runs("a1"), [older]);
    fetchMock.mockResolvedValue(json(run({ id: "run1" }), 202));
    const { result } = renderHook(() => useStartEvalRun("a1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(qc.getQueryData<EvalRun[]>(evalKeys.runs("a1"))?.map((r) => r.id)).toEqual(["run1", "run0"]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/agents\/a1\/eval-runs$/);
    expect((init as RequestInit).method).toBe("POST");
  });

  it("rejects with the API's message and shows no global toast", async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: "eval_no_cases", message: "This agent has no eval cases." } }, 400),
    );
    const { result } = renderHook(() => useStartEvalRun("a1"), { wrapper });

    let caught: unknown;
    await act(async () => {
      caught = await result.current.mutateAsync().catch((e: unknown) => e);
    });

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("eval_no_cases");
    expect((caught as ApiError).message).toBe("This agent has no eval cases.");
  });
});

describe("useEvalCaseDraft", () => {
  it("sends one GET for the finding", async () => {
    fetchMock.mockResolvedValue(json({ draft: {}, problem: null }));
    const { result } = renderHook(() => useEvalCaseDraft(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync("f1");
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/findings\/f1\/eval-case-draft$/);
    expect((init as RequestInit | undefined)?.method ?? "GET").toBe("GET");
  });
});

describe("useSaveEvalCaseFromFinding", () => {
  const body = { name: "stripe-key-leak" } as unknown as EvalCaseUpdateInput;

  it("posts the body, maps 201 to created and refreshes the owning agent's cases", async () => {
    qc.setQueryData(evalKeys.cases("a1"), []);
    fetchMock.mockResolvedValue(json(CASE, 201));
    const { result } = renderHook(() => useSaveEvalCaseFromFinding(), { wrapper });

    let saved: { case: EvalCase; created: boolean } | undefined;
    await act(async () => {
      saved = await result.current.mutateAsync({ findingId: "f1", body });
    });

    expect(saved?.case.id).toBe("c1");
    expect(saved?.created).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/findings\/f1\/eval-case$/);
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual(body);
    expect(qc.getQueryState(evalKeys.cases("a1"))?.isInvalidated).toBe(true);
  });

  it("maps 200 to created false", async () => {
    fetchMock.mockResolvedValue(json(CASE, 200));
    const { result } = renderHook(() => useSaveEvalCaseFromFinding(), { wrapper });

    let saved: { case: EvalCase; created: boolean } | undefined;
    await act(async () => {
      saved = await result.current.mutateAsync({ findingId: "f1", body });
    });

    expect(saved?.created).toBe(false);
  });
});

describe("useTryEvalCase", () => {
  it("posts the body to the agent's try route and invalidates nothing", async () => {
    qc.setQueryData(evalKeys.cases("a1"), []);
    fetchMock.mockResolvedValue(json({ status: "pass" }));
    const { result } = renderHook(() => useTryEvalCase("a1"), { wrapper });
    const body = { diff: "d" } as unknown as EvalCaseTryInput;

    await act(async () => {
      await result.current.mutateAsync(body);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/agents\/a1\/eval-cases\/try$/);
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual(body);
    expect(qc.getQueryState(evalKeys.cases("a1"))?.isInvalidated).toBe(false);
  });
});

describe("useEvalCompare", () => {
  it("stays idle until both run ids are given", async () => {
    const { result, rerender } = renderHook(
      ({ head }: { head: string | null }) => useEvalCompare("a1", "run0", head),
      { wrapper, initialProps: { head: null as string | null } },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(json({ base: {}, head: {}, cases_only_in_base: [], cases_only_in_head: [] }));
    rerender({ head: "run1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(
      /\/agents\/a1\/eval-runs\/compare\?base=run0&head=run1$/,
    );
  });
});

const EXPECTED: EvalCaseUpdateInput["expected_output"] = {
  file: "src/config.ts",
  start_line: 4,
  end_line: 6,
  severity: "WARNING",
  category: "security",
  title: "Leaked key",
};

describe("useCreateManualEvalCase", () => {
  it("sends one POST with the form's body and refreshes the agent's cases", async () => {
    qc.setQueryData(evalKeys.cases("a1"), []);
    fetchMock.mockResolvedValue(json(CASE, 201));
    const body: EvalCaseCreateInput = {
      name: "leaked-key",
      input_diff: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n+k",
      input_meta: { pr_title: "", pr_body: null },
      expectation_type: "must_find",
      expected_output: EXPECTED,
    };
    const { result } = renderHook(() => useCreateManualEvalCase("a1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(body);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/agents\/a1\/eval-cases$/);
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual(body);
    expect(qc.getQueryState(evalKeys.cases("a1"))?.isInvalidated).toBe(true);
  });

  it("rejects with the API's message", async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: "eval_diff_invalid", message: "The diff holds no file with a hunk." } }, 400),
    );
    const { result } = renderHook(() => useCreateManualEvalCase("a1"), { wrapper });

    let caught: unknown;
    await act(async () => {
      caught = await result.current
        .mutateAsync({
          name: "n",
          input_diff: "x",
          input_meta: { pr_title: "", pr_body: null },
          expectation_type: "must_find",
          expected_output: EXPECTED,
        })
        .catch((e: unknown) => e);
    });

    expect((caught as ApiError).code).toBe("eval_diff_invalid");
    expect((caught as ApiError).message).toBe("The diff holds no file with a hunk.");
  });
});

describe("useUpdateEvalCase", () => {
  it("sends one PUT to the case with the form's body and refreshes the agent's cases", async () => {
    qc.setQueryData(evalKeys.cases("a1"), [CASE]);
    fetchMock.mockResolvedValue(json({ ...CASE, revision: 2 }));
    const body: EvalCaseUpdateInput = {
      name: "renamed",
      input_diff: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n+k",
      input_meta: { pr_title: "t", pr_body: "b" },
      expected_output: EXPECTED,
    };
    const { result } = renderHook(() => useUpdateEvalCase("a1"), { wrapper });

    let saved: EvalCase | undefined;
    await act(async () => {
      saved = await result.current.mutateAsync({ id: "c1", body });
    });

    expect(saved?.revision).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/eval-cases\/c1$/);
    expect((init as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual(body);
    expect(qc.getQueryState(evalKeys.cases("a1"))?.isInvalidated).toBe(true);
  });
});

describe("useStartEvalRunsForAgents", () => {
  it("maps each agent to its own outcome and refreshes the dashboard and run lists", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return url.includes("/agents/a2/")
          ? json({ error: { message: "Run in progress" } }, 400)
          : json(run({ agent_id: "a1" }), 202);
      }),
    );
    const qc = createQueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useStartEvalRunsForAgents(), { wrapper });

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.mutateAsync(["a1", "a2"]);
    });

    expect(calls).toHaveLength(2);
    expect(outcome).toEqual([
      { agentId: "a1", ok: true, message: null },
      { agentId: "a2", ok: false, message: expect.any(String) },
    ]);
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(evalKeys.dashboard());
    expect(keys).toContainEqual(evalKeys.runs("a1"));
    expect(keys).toContainEqual(evalKeys.runs("a2"));
    vi.unstubAllGlobals();
  });
});

describe("a skill as the eval owner", () => {
  const owner = { kind: "skill", id: "s1", hostAgentId: "a9" } as const;
  const skillRunList = () => urls().filter((u) => u.endsWith("/skills/s1/eval-runs")).length;

  it("keeps the agent keys and gives the skill its own", () => {
    expect(evalKeys.cases("a1")).toEqual(["eval-cases", "a1"]);
    expect(evalKeys.runs("a1")).toEqual(["eval-runs", "a1"]);
    expect(evalKeys.cases("s1", "skill")).toEqual(["eval-cases", "skill", "s1"]);
    expect(evalKeys.runs("s1", "skill")).toEqual(["eval-runs", "skill", "s1"]);
  });

  it("reads the cases and the runs from the skill's routes", async () => {
    fetchMock.mockImplementation(async () => json([]));
    const cases = renderHook(() => useEvalCases(owner), { wrapper });
    const runs = renderHook(() => useEvalRuns(owner), { wrapper });
    await waitFor(() => expect(cases.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(runs.result.current.isSuccess).toBe(true));

    expect(urls().some((u) => u.endsWith("/skills/s1/eval-cases"))).toBe(true);
    expect(urls().some((u) => u.endsWith("/skills/s1/eval-runs"))).toBe(true);
    expect(urls().some((u) => u.includes("/agents/"))).toBe(false);
  });

  it("creates a case on the skill's route and refreshes the skill's cases only", async () => {
    qc.setQueryData(evalKeys.cases("s1", "skill"), []);
    qc.setQueryData(evalKeys.cases("a9"), []);
    fetchMock.mockResolvedValue(json(CASE, 201));
    const { result } = renderHook(() => useCreateManualEvalCase(owner), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        name: "n",
        input_diff: "x",
        input_meta: { pr_title: "", pr_body: null },
        expectation_type: "must_find",
        expected_output: EXPECTED,
      });
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/skills\/s1\/eval-cases$/);
    expect((init as RequestInit).method).toBe("POST");
    expect(qc.getQueryState(evalKeys.cases("s1", "skill"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(evalKeys.cases("a9"))?.isInvalidated).toBe(false);
  });

  it("starts a run with the host agent in the body and puts it in the skill's run list", async () => {
    qc.setQueryData(evalKeys.runs("s1", "skill"), []);
    fetchMock.mockResolvedValue(json(run({ id: "run7", agent_id: "a9", skill_id: "s1" }), 202));
    const { result } = renderHook(() => useStartEvalRun(owner), { wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/skills\/s1\/eval-runs$/);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ host_agent_id: "a9" });
    expect(qc.getQueryData<EvalRun[]>(evalKeys.runs("s1", "skill"))?.map((r) => r.id)).toEqual(["run7"]);
  });

  it("tries a case with the host agent added to the body and invalidates nothing", async () => {
    qc.setQueryData(evalKeys.cases("s1", "skill"), []);
    fetchMock.mockResolvedValue(json({ status: "pass" }));
    const { result } = renderHook(() => useTryEvalCase(owner), { wrapper });
    const body = { diff: "d" } as unknown as EvalCaseTryInput;

    await act(async () => {
      await result.current.mutateAsync(body);
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/skills\/s1\/eval-cases\/try$/);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ diff: "d", host_agent_id: "a9" });
    expect(qc.getQueryState(evalKeys.cases("s1", "skill"))?.isInvalidated).toBe(false);
  });

  it("updates and deletes a case through /eval-cases and refreshes the skill's cases", async () => {
    qc.setQueryData(evalKeys.cases("s1", "skill"), [CASE]);
    fetchMock.mockResolvedValue(json({ ...CASE, revision: 2 }));
    const update = renderHook(() => useUpdateEvalCase(owner), { wrapper });
    await act(async () => {
      await update.result.current.mutateAsync({
        id: "c1",
        body: { name: "r", input_diff: "x", input_meta: { pr_title: "", pr_body: null }, expected_output: EXPECTED },
      });
    });
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/eval-cases\/c1$/);
    expect(qc.getQueryState(evalKeys.cases("s1", "skill"))?.isInvalidated).toBe(true);

    qc.setQueryData(evalKeys.cases("s1", "skill"), [CASE]);
    fetchMock.mockResolvedValue(json({ ok: true }));
    const del = renderHook(() => useDeleteEvalCase(owner), { wrapper });
    await act(async () => {
      await del.result.current.mutateAsync("c1");
    });
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(String(url)).toMatch(/\/eval-cases\/c1$/);
    expect((init as RequestInit).method).toBe("DELETE");
    expect(qc.getQueryState(evalKeys.cases("s1", "skill"))?.isInvalidated).toBe(true);
  });

  it("reads the cases once more when the run settles and leaves the dashboard alone", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let list: EvalRun[] = [run({ skill_id: "s1" })];
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith("/skills/s1/eval-runs") ? json(list) : json([]),
    );
    qc.setQueryData(evalKeys.cases("s1", "skill"), [CASE]);
    qc.setQueryData(evalKeys.dashboard(), { agents: [], recent_runs: [] });
    const { result } = renderHook(() => useEvalRuns(owner), { wrapper });

    await waitFor(() => expect(result.current.data?.[0]?.status).toBe("running"));
    expect(skillRunList()).toBe(1);

    list = [run({ skill_id: "s1", status: "done", recall: 1 })];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVAL_RUN_POLL_MS + 50);
    });
    await waitFor(() => expect(result.current.data?.[0]?.status).toBe("done"));

    expect(qc.getQueryState(evalKeys.cases("s1", "skill"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(evalKeys.dashboard())?.isInvalidated).toBe(false);
  });
});

describe("useSkillEvalCompare", () => {
  it("stays idle until the skill and both runs are given, then reads the skill's compare route", async () => {
    const { result, rerender } = renderHook(
      ({ head }: { head: string | null }) => useSkillEvalCompare("s1", "run0", head),
      { wrapper, initialProps: { head: null as string | null } },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(json({ base: {}, head: {}, cases_only_in_base: [], cases_only_in_head: [] }));
    rerender({ head: "run1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(
      /\/skills\/s1\/eval-runs\/compare\?base=run0&head=run1$/,
    );
    expect(qc.getQueryState(evalKeys.skillCompare("s1", "run0", "run1"))).toBeDefined();
  });
});
