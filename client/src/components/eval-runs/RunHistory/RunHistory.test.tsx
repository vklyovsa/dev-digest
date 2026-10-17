import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { EvalRun, EvalRunCompare, EvalSkillRunCompare } from "@devdigest/shared";
import evalMessages from "../../../../messages/en/eval.json";
import { createQueryClient } from "@/lib/providers";
import { RunHistory } from "./RunHistory";
import type { SkillEvalTarget } from "../helpers";

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

const THREE = [
  run({ id: "r3", agent_version: 7 }),
  run({ id: "r2", agent_version: 6, started_at: "2026-05-27T16:40:00Z", recall: 0.78, cases_passed: 16, cost_usd: 0.21 }),
  run({ id: "r1", agent_version: 5, started_at: "2026-05-25T11:02:00Z", recall: null, cases_passed: 16, cost_usd: null }),
];

const COMPARE: EvalRunCompare = {
  base: {
    run_id: "r2",
    agent_version: 6,
    system_prompt: "old",
    provider: "p",
    model: "m",
    skills: [],
    started_at: "2026-05-27T16:40:00Z",
    recall: 0.78,
    precision: 0.93,
    citation_accuracy: 0.94,
    cost_usd: 0.21,
    cases_total: 20,
    cases_passed: 16,
  },
  head: {
    run_id: "r3",
    agent_version: 7,
    system_prompt: "new",
    provider: "p",
    model: "m",
    skills: [],
    started_at: "2026-05-29T09:14:00Z",
    recall: 0.82,
    precision: 0.91,
    citation_accuracy: 0.95,
    cost_usd: 0.23,
    cases_total: 20,
    cases_passed: 17,
  },
  cases_only_in_base: [],
  cases_only_in_head: [],
  cases_edited: [],
};

const fetchMock = vi.fn();
let qc: QueryClient;
let list: EvalRun[];

function mount() {
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <RunHistory agentId="a1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const compareButton = () => screen.getByRole("button", { name: "Compare" });

beforeEach(() => {
  list = THREE;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) =>
    String(url).includes("/eval-runs/compare") ? json(COMPARE) : json(list),
  );
  vi.stubGlobal("fetch", fetchMock);
  qc = createQueryClient();
  qc.setDefaultOptions({ queries: { retry: false } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  qc.clear();
});

describe("RunHistory", () => {
  it("lists the runs newest first with version, metrics, cases passed and cost", async () => {
    mount();
    await screen.findAllByRole("checkbox");

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    const first = within(rows[0]!);
    expect(first.getByText("v7")).toBeInTheDocument();
    expect(first.getByText("82%")).toBeInTheDocument();
    expect(first.getByText("91%")).toBeInTheDocument();
    expect(first.getByText("95%")).toBeInTheDocument();
    expect(first.getByText("17/20")).toBeInTheDocument();
    expect(first.getByText("$0.230")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("v6")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("v5")).toBeInTheDocument();
    expect(within(rows[2]!).getAllByText("—")).toHaveLength(2);
  });

  it("draws a decorative bar beside each of the three percentages", async () => {
    mount();
    await screen.findAllByRole("checkbox");

    const rows = screen.getAllByRole("row").slice(1);
    const barsOf = (row: HTMLElement) => Array.from(row.querySelectorAll<HTMLElement>('[aria-hidden="true"]'));
    const widths = (row: HTMLElement) => barsOf(row).map((b) => (b.firstElementChild!.firstElementChild as HTMLElement).style.width);
    expect(widths(rows[0]!)).toEqual(["82%", "91%", "95%"]);
    expect(widths(rows[2]!)).toEqual(["0%", "91%", "95%"]);
    expect(barsOf(rows[0]!).every((b) => b.textContent === "")).toBe(true);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("gives a checkbox to completed runs only", async () => {
    list = [run({ id: "r3", status: "running" }), run({ id: "r2", status: "failed", error: "interrupted" }), run({ id: "r1" })];
    mount();

    expect(await screen.findAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText("Eval run failed: interrupted")).toBeInTheDocument();
    expect(screen.getByText("Running…")).toBeInTheDocument();
  });

  it("selects up to two runs and replaces the earliest on a third", async () => {
    mount();
    const boxes = await screen.findAllByRole("checkbox");
    expect(compareButton()).toBeDisabled();

    fireEvent.click(boxes[0]!);
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(compareButton()).toBeDisabled();

    fireEvent.click(boxes[1]!);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(compareButton()).toBeEnabled();

    fireEvent.click(boxes[2]!);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(boxes[0]).not.toBeChecked();
    expect(boxes[1]).toBeChecked();
    expect(boxes[2]).toBeChecked();
  });

  it("opens the compare view for the two selected runs", async () => {
    mount();
    const boxes = await screen.findAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    fireEvent.click(compareButton());

    expect(await screen.findByText("Compare runs · v6 → v7")).toBeInTheDocument();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => /compare\?base=r3&head=r2$/.test(url))).toBe(true);
  });

  it("disables Compare with a hint when fewer than two runs are completed", async () => {
    list = [run({ id: "r2", status: "running" }), run({ id: "r1" })];
    mount();
    const [box] = await screen.findAllByRole("checkbox");
    fireEvent.click(box!);

    expect(compareButton()).toBeDisabled();
    expect(compareButton()).toHaveAccessibleDescription("Select two completed runs to compare them.");
    expect(screen.getByText("Select two completed runs to compare them.")).toBeInTheDocument();
  });

  it("says so when there is no run yet", async () => {
    list = [];
    mount();
    expect(await screen.findByText("No eval runs yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("RunHistory of a skill", () => {
  const SKILL: SkillEvalTarget = { id: "s1", name: "Imports", host: { id: "h1", name: "Security Reviewer" } };
  const hostNames = new Map([["h1", "Security Reviewer"]]);
  const SKILL_COMPARE: EvalSkillRunCompare = {
    base: {
      run_id: "r2", skill_version: 2, skill_body: "old", agent_id: "h1", agent_version: 3, provider: "p", model: "m",
      started_at: "2026-05-27T16:40:00Z", recall: 0.5, precision: 0.5, citation_accuracy: 0.5, cost_usd: 0.1, cases_total: 4, cases_passed: 2,
    },
    head: {
      run_id: "r3", skill_version: 3, skill_body: "new", agent_id: "h1", agent_version: 3, provider: "p", model: "m",
      started_at: "2026-05-29T09:14:00Z", recall: 0.6, precision: 0.6, citation_accuracy: 0.6, cost_usd: 0.1, cases_total: 4, cases_passed: 3,
    },
    cases_only_in_base: [],
    cases_only_in_head: [],
    cases_edited: [],
  };
  const skillRun = (over: Partial<EvalRun> = {}) =>
    run({ agent_id: "h1", agent_version: 3, skill_id: "s1", skill_version: 2, ...over });

  function mountSkill() {
    render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
          <RunHistory skill={SKILL} hostNames={hostNames} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("/eval-runs/compare") ? json(SKILL_COMPARE) : json(list),
    );
  });

  it("lists the skill's runs with the skill version and the host agent column", async () => {
    list = [
      skillRun({ id: "r3", skill_version: 3 }),
      skillRun({ id: "r2", started_at: "2026-05-27T16:40:00Z" }),
      skillRun({ id: "r1", status: "failed", error: "interrupted", started_at: "2026-05-25T11:02:00Z" }),
    ];
    mountSkill();
    await screen.findAllByRole("checkbox");

    expect(screen.getByRole("columnheader", { name: "Host agent" })).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText("v3")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Security Reviewer v3")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("v2")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Eval run failed: interrupted")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/skills\/s1\/eval-runs$/);
  });

  it("keeps Compare disabled with its hint for one completed run", async () => {
    list = [skillRun({ id: "r1" })];
    mountSkill();
    const [box] = await screen.findAllByRole("checkbox");
    fireEvent.click(box!);

    expect(compareButton()).toBeDisabled();
    expect(compareButton()).toHaveAccessibleDescription("Select two completed runs to compare them.");
  });

  it("opens the skill comparison for two selected runs", async () => {
    list = [skillRun({ id: "r3", skill_version: 3 }), skillRun({ id: "r2", started_at: "2026-05-27T16:40:00Z" })];
    mountSkill();
    const boxes = await screen.findAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    expect(compareButton()).toBeEnabled();
    fireEvent.click(compareButton());

    expect(await screen.findByText("Compare runs · skill v2 → v3")).toBeInTheDocument();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => /\/skills\/s1\/eval-runs\/compare\?base=r3&head=r2$/.test(url))).toBe(true);
  });
});
