import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, MultiAgentRun } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useParams: () => ({ repoId: "r1" }),
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

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

const AGENTS = [
  makeAgent({ id: "a1", name: "Security" }),
  makeAgent({ id: "a2", name: "Performance" }),
  makeAgent({ id: "a3", name: "Style", enabled: false }),
];

const STARTED: MultiAgentRun = {
  id: "run9",
  pr_id: "pr1",
  pr_number: 7,
  pr_title: "t",
  ran_at: "2026-10-18T10:00:00Z",
  agent_count: 2,
  total_duration_ms: 0,
  total_cost_usd: null,
  columns: [],
  groups: [],
};

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function renderDropdown() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <RunReviewDropdown prId="pr1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

async function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: /Run Review/ }));
  await screen.findByRole("checkbox", { name: "Security" });
}

const runButton = () =>
  screen.getByRole("button", { name: /^(Select agents|Run 1 agent|Run multi-agent review \(\d+\))$/ });
const box = (name: string) => screen.getByRole("checkbox", { name });
const startCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/multi-agent-run"));

beforeEach(() => {
  push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/agents")) return json(AGENTS);
    if (url.endsWith("/multi-agent-run") && init?.method === "POST") return json(STARTED);
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RunReviewDropdown", () => {
  it("renders the trigger label", () => {
    renderDropdown();
    expect(screen.getByText("Run Review")).toBeInTheDocument();
  });

  it("AC-1: lists every agent with a checkbox named after it, enabled ones checked and disabled ones not", async () => {
    renderDropdown();
    await openMenu();

    expect(box("Security")).toHaveAttribute("aria-checked", "true");
    expect(box("Performance")).toHaveAttribute("aria-checked", "true");
    expect(box("Style")).toHaveAttribute("aria-checked", "false");
  });

  it("AC-2: the run button reads Select agents (disabled) for 0, Run 1 agent for 1 and Run multi-agent review (N) for N > 1", async () => {
    renderDropdown();
    await openMenu();

    expect(runButton()).toHaveTextContent("Run multi-agent review (2)");

    fireEvent.click(box("Security"));
    fireEvent.click(box("Performance"));
    expect(runButton()).toHaveTextContent("Select agents");
    expect(runButton()).toBeDisabled();

    fireEvent.click(box("Style"));
    expect(runButton()).toHaveTextContent("Run 1 agent");
    expect(runButton()).toBeEnabled();

    fireEvent.click(box("Security"));
    expect(runButton()).toHaveTextContent("Run multi-agent review (2)");
  });

  it("AC-3: Run posts exactly the checked agent ids and opens the results page of the returned run", async () => {
    renderDropdown();
    await openMenu();
    fireEvent.click(box("Performance"));
    fireEvent.click(box("Style"));

    fireEvent.click(runButton());

    await waitFor(() => expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent/run9"));
    const calls = startCalls();
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0]!;
    expect(String(url)).toContain("/pulls/pr1/multi-agent-run");
    expect(JSON.parse(String(init?.body))).toEqual({ agent_ids: ["a1", "a3"] });
  });
});
