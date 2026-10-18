import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, MultiAgentRun, PrMeta } from "@devdigest/shared";
import runs from "../../../../../../../messages/en/runs.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useParams: () => ({ repoId: "r1" }),
}));

import { ConfigureRun } from "./ConfigureRun";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function makeAgent(over: Partial<Agent>): Agent {
  return {
    id: "a1",
    name: "Security",
    description: "",
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "p",
    enabled: true,
    version: 1,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    skill_count: 0,
    ...over,
  };
}

const makePull = (id: string, number: number, title: string): PrMeta => ({
  id,
  number,
  title,
  author: "x",
  branch: "b",
  base: "main",
  head_sha: "abc",
  additions: 1,
  deletions: 0,
  files_count: 1,
  status: "needs_review",
});

const PULLS = [makePull("pr1", 482, "Add rate limiting"), makePull("pr2", 483, "Fix typo")];

const STARTED: MultiAgentRun = {
  id: "run9",
  pr_id: "pr1",
  pr_number: 482,
  pr_title: "Add rate limiting",
  ran_at: "2026-10-18T10:00:00Z",
  agent_count: 2,
  total_duration_ms: 0,
  total_cost_usd: null,
  columns: [],
  groups: [],
};

let agentsResponse: Agent[];
let startResponse: () => Promise<Response>;
const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function renderConfigure(props: Partial<React.ComponentProps<typeof ConfigureRun>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ runs }}>
        <ConfigureRun repoId="r1" {...props} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const runButton = () =>
  screen.getByRole("button", { name: /^(Select agents|Run 1 agent|Run multi-agent review \(\d+\))$/ });
const box = (name: string) => screen.getByRole("checkbox", { name });
const startCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/multi-agent-run"));

async function pickPr(id = "pr1") {
  const select = await screen.findByRole("combobox");
  await screen.findByRole("option", { name: "#482 · Add rate limiting" });
  fireEvent.change(select, { target: { value: id } });
}

beforeEach(() => {
  push.mockReset();
  fetchMock.mockReset();
  agentsResponse = [
    makeAgent({ id: "a1", name: "Security", description: "Finds secrets" }),
    makeAgent({ id: "a2", name: "Performance", description: "Finds slow code" }),
    makeAgent({ id: "a3", name: "Style", description: "Finds nits", enabled: false }),
  ];
  startResponse = async () => json(STARTED);
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/agents")) return json(agentsResponse);
    if (url.endsWith("/repos/r1/pulls")) return json(PULLS);
    if (url.endsWith("/multi-agent-runs/estimates")) {
      return json({
        estimates: [
          { agent_id: "a1", duration_ms: 4000, cost_usd: 0.01 },
          { agent_id: "a2", duration_ms: 2000, cost_usd: 0.02 },
          { agent_id: "a3", duration_ms: null, cost_usd: null },
        ],
      });
    }
    if (url.endsWith("/multi-agent-run") && init?.method === "POST") return startResponse();
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ConfigureRun", () => {
  it("AC-4: with no pull request selected it shows the pick-a-PR placeholder instead of the agents and keeps Run disabled", async () => {
    renderConfigure();
    await screen.findByText("Pick a pull request first");

    expect(screen.queryByRole("checkbox", { name: "Security" })).not.toBeInTheDocument();
    expect(runButton()).toBeDisabled();
  });

  it("AC-5 + AC-6: once a PR is picked every agent shows its name, description and duration · cost, or 'no estimate'", async () => {
    renderConfigure();
    await pickPr();

    expect(await screen.findByRole("checkbox", { name: "Security" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Performance" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Style" })).toBeInTheDocument();
    expect(screen.getByText("Finds secrets")).toBeInTheDocument();
    expect(screen.getByText("Finds slow code")).toBeInTheDocument();
    expect(await screen.findByText("4.0s · $0.010")).toBeInTheDocument();
    expect(screen.getByText("2.0s · $0.020")).toBeInTheDocument();
    expect(screen.getByText("no estimate")).toBeInTheDocument();
  });

  it("AC-7 + AC-6: the total is the longest duration and summed cost of the checked agents that have an estimate; an agent with no estimate adds nothing", async () => {
    renderConfigure();
    await pickPr();
    await screen.findByRole("checkbox", { name: "Security" });

    expect(screen.getByText("≈ 4.0s · $0.030 · parallel")).toBeInTheDocument();

    fireEvent.click(box("Style"));
    expect(screen.getByText("≈ 4.0s · $0.030 · parallel")).toBeInTheDocument();

    fireEvent.click(box("Security"));
    expect(screen.getByText("≈ 2.0s · $0.020 · parallel")).toBeInTheDocument();
  });

  it("AC-8: the run button reads Select agents (disabled) for 0, Run 1 agent for 1 and Run multi-agent review (N) for 4", async () => {
    agentsResponse = ["a1", "a2", "a3", "a4"].map((id, i) => makeAgent({ id, name: `Agent ${i + 1}` }));
    renderConfigure();
    await pickPr();
    await screen.findByRole("checkbox", { name: "Agent 1" });

    expect(runButton()).toHaveTextContent("Run multi-agent review (4)");

    for (const n of [1, 2, 3, 4]) fireEvent.click(box(`Agent ${n}`));
    expect(runButton()).toHaveTextContent("Select agents");
    expect(runButton()).toBeDisabled();

    fireEvent.click(box("Agent 2"));
    expect(runButton()).toHaveTextContent("Run 1 agent");
    expect(runButton()).toBeEnabled();
  });

  it("AC-9: Run posts the checked agent ids for the selected PR and opens the results page of the returned run", async () => {
    renderConfigure();
    await pickPr("pr2");
    await screen.findByRole("checkbox", { name: "Security" });
    fireEvent.click(box("Performance"));
    fireEvent.click(box("Style"));

    fireEvent.click(runButton());

    await waitFor(() => expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent/run9"));
    const calls = startCalls();
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0]!;
    expect(String(url)).toContain("/pulls/pr2/multi-agent-run");
    expect(JSON.parse(String(init?.body))).toEqual({ agent_ids: ["a1", "a3"] });
  });

  it("AC-10: while the start request is pending Run is disabled and a second click sends no second request", async () => {
    let release!: (r: Response) => void;
    startResponse = () => new Promise<Response>((resolve) => (release = resolve));
    renderConfigure();
    await pickPr();
    await screen.findByRole("checkbox", { name: "Security" });

    fireEvent.click(runButton());
    await waitFor(() => expect(runButton()).toBeDisabled());
    fireEvent.click(runButton());

    expect(startCalls()).toHaveLength(1);
    release(json(STARTED));
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("AC-11: with no agents it shows the empty state and a Go to Agents link to /agents", async () => {
    agentsResponse = [];
    renderConfigure();

    await screen.findByText("Enable agents to run reviews");
    expect(screen.getByRole("link", { name: "Go to Agents" })).toHaveAttribute("href", "/agents");
  });

  it("AC-46 (receiving end): preselected pr and agents arrive checked, and only known agent ids count", async () => {
    renderConfigure({ preselect: { pr: "pr2", agents: ["a2", "a3", "gone"] } });

    await screen.findByRole("checkbox", { name: "Performance" });
    expect(box("Performance")).toHaveAttribute("aria-checked", "true");
    expect(box("Style")).toHaveAttribute("aria-checked", "true");
    expect(box("Security")).toHaveAttribute("aria-checked", "false");
    expect(runButton()).toHaveTextContent("Run multi-agent review (2)");
  });
});
