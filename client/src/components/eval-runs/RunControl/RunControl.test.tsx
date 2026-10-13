import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { EvalRun } from "@devdigest/shared";
import evalMessages from "../../../../messages/en/eval.json";
import { createQueryClient } from "@/lib/providers";
import { evalKeys } from "@/lib/hooks/evals";
import { RunControl } from "./RunControl";
import { EVAL_NO_HOST_HINT_ID, type SkillEvalTarget } from "../helpers";

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
    model: "m",
    skills: [],
    case_ids: [],
    error: null,
    ...over,
  };
}

const fetchMock = vi.fn();
let qc: QueryClient;
let list: EvalRun[];

const posts = () => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST");

function mountControl(props: Partial<{ caseCount: number; variant: "all" | "one" }> = {}) {
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <RunControl agentId="a1" caseCount={8} variant="all" {...props} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  list = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method === "POST" ? json(run(), 202) : json(list),
  );
  vi.stubGlobal("fetch", fetchMock);
  qc = createQueryClient();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  qc.clear();
});

describe("RunControl", () => {
  it("states the number of cases", () => {
    mountControl();
    expect(screen.getByRole("button", { name: "Run all evals (8)" })).toBeEnabled();
  });

  it("uses the dashboard wording for the single-run variant", () => {
    mountControl({ variant: "one" });
    expect(screen.getByRole("button", { name: "Run eval (8)" })).toBeEnabled();
  });

  it("is disabled when the agent has no case", () => {
    mountControl({ caseCount: 0 });
    expect(screen.getByRole("button", { name: "Run all evals (0)" })).toBeDisabled();
  });

  it("sends one request and shows the running state", async () => {
    mountControl();
    fireEvent.click(screen.getByRole("button", { name: "Run all evals (8)" }));

    const running = await screen.findByRole("button", { name: "Running…" });
    expect(running).toBeDisabled();
    expect(posts()).toHaveLength(1);
    expect(String(posts()[0]![0])).toMatch(/\/agents\/a1\/eval-runs$/);
    fireEvent.click(running);
    expect(posts()).toHaveLength(1);
  });

  it("is disabled while the newest run is running, also on first read", async () => {
    list = [run()];
    mountControl();
    expect(await screen.findByRole("button", { name: "Running…" })).toBeDisabled();
  });

  it("shows the message of a refused start and stays enabled", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? json({ error: { code: "eval_run_in_progress", message: "A run is already in progress." } }, 400)
        : json(list),
    );
    mountControl();
    fireEvent.click(screen.getByRole("button", { name: "Run all evals (8)" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("A run is already in progress.");
    expect(screen.getByRole("button", { name: "Run all evals (8)" })).toBeEnabled();
  });

  it("shows the error of a failed newest run and stays enabled", async () => {
    list = [run({ status: "failed", error: "interrupted" })];
    mountControl();

    expect(await screen.findByRole("alert")).toHaveTextContent("interrupted");
    expect(screen.getByRole("button", { name: "Run all evals (8)" })).toBeEnabled();
  });

  it("announces the start and the end of a run in a live region", async () => {
    list = [run()];
    mountControl();
    const live = screen.getByRole("status");
    await waitFor(() => expect(live).toHaveTextContent("Eval run started."));

    act(() => {
      qc.setQueryData(evalKeys.runs("a1"), [run({ status: "done", recall: 1 })]);
    });
    await waitFor(() => expect(live).toHaveTextContent("Eval run finished."));
  });

  it("announces a run that fails with its error", async () => {
    list = [run()];
    mountControl();
    const live = screen.getByRole("status");
    await waitFor(() => expect(live).toHaveTextContent("Eval run started."));

    act(() => {
      qc.setQueryData(evalKeys.runs("a1"), [run({ status: "failed", error: "interrupted" })]);
    });
    await waitFor(() => expect(live).toHaveTextContent("Eval run failed: interrupted"));
  });
});

describe("RunControl of a skill", () => {
  const HOST = { id: "00000000-0000-4000-8000-000000000001", name: "Security Reviewer" };
  const SKILL: SkillEvalTarget = { id: "s1", name: "Imports", host: HOST };

  function mountSkill(skill: SkillEvalTarget = SKILL, caseCount = 3) {
    return render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
          <p id={EVAL_NO_HOST_HINT_ID}>A skill is evaluated through a host agent. Create an agent first.</p>
          <RunControl skill={skill} caseCount={caseCount} variant="all" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  }

  it("names the number of calls and the host in its title", () => {
    mountSkill();
    expect(screen.getByRole("button", { name: "Run all evals (3)" })).toHaveAttribute(
      "title",
      "3 model calls through Security Reviewer",
    );
  });

  it("posts the host id to the skill's run route", async () => {
    mountSkill();
    fireEvent.click(screen.getByRole("button", { name: "Run all evals (3)" }));

    await screen.findByRole("button", { name: "Running…" });
    expect(posts()).toHaveLength(1);
    expect(String(posts()[0]![0])).toMatch(/\/skills\/s1\/eval-runs$/);
    expect(JSON.parse(String((posts()[0]![1] as RequestInit).body))).toEqual({ host_agent_id: HOST.id });
  });

  it("disables the control for a 202, ignores a second click and reads the list again after 3 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mountSkill();
      fireEvent.click(screen.getByRole("button", { name: "Run all evals (3)" }));
      const running = await screen.findByRole("button", { name: "Running…" });
      expect(running).toBeDisabled();
      fireEvent.click(running);
      expect(posts()).toHaveLength(1);

      const reads = () => fetchMock.mock.calls.filter((c) => !(c[1] as RequestInit | undefined)?.method).length;
      const before = reads();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3100);
      });
      expect(reads()).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["eval_provider_unavailable", "No provider is configured.", 400],
    ["eval_host_agent_missing", "The host agent no longer exists.", 400],
    ["rate_limited", "Too many requests.", 429],
  ])("shows the %s refusal in an alert and stays enabled", async (code, message, status) => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? json({ error: { code, message } }, status) : json(list),
    );
    mountSkill();
    fireEvent.click(screen.getByRole("button", { name: "Run all evals (3)" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Run all evals (3)" })).toBeEnabled();
  });

  it("is disabled without a host and points at the hint", () => {
    mountSkill({ ...SKILL, host: null });
    const button = screen.getByRole("button", { name: "Run all evals (3)" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("A skill is evaluated through a host agent. Create an agent first.");
    expect(button).not.toHaveAttribute("title");
  });
});
