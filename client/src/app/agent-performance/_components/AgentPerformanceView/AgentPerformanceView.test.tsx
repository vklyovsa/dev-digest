import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { AgentPerf } from "@devdigest/shared";
import agentPerformance from "../../../../../messages/en/agentPerformance.json";
import common from "../../../../../messages/en/common.json";
import { createQueryClient } from "@/lib/providers";

const push = vi.fn();
const replace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => searchParams,
  usePathname: () => "/agent-performance",
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { AgentPerformanceView } from "./AgentPerformanceView";

const NOW = new Date(2026, 9, 17, 12, 0, 0);
const DAY = 86_400_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function perf(runs = 12): AgentPerf {
  return {
    period: { from: "2026-09-17T00:00:00.000Z", to: "2026-10-17T00:00:00.000Z" },
    cost_basis: "estimate",
    min_decisions: 5,
    summary: {
      runs,
      total_cost_usd: 1.5,
      unpriced_runs: 0,
      accepted: 6,
      decisions: 8,
      avg_accept_rate: 0.75,
      most_active_agent: "Security Reviewer",
      most_active_agent_id: "a1",
      most_active_runs: runs,
      most_active_accept_rate: 0.75,
    },
    agents: [
      {
        agent_id: "a1",
        agent_name: "Security Reviewer",
        runs,
        avg_cost_usd: 0.125,
        avg_latency_ms: 4200,
        accept_rate: 0.75,
        accepted: 6,
        decisions: 8,
        small_sample: false,
        last_run_at: "2026-10-16T10:00:00Z",
      },
    ],
    cost_by_agent: [{ label: "Security Reviewer", value: 1.5, agent_id: "a1" }],
    cost_by_model: [{ label: "gpt-4.1", value: 1.5 }],
  } as unknown as AgentPerf;
}

const fetchMock = vi.fn();
let qc: QueryClient;

function mount() {
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agentPerformance, common }}>
        <AgentPerformanceView />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const urls = () => fetchMock.mock.calls.map((c) => new URL(String(c[0]), "http://x"));
const ranges = () => urls().map((u) => ({ from: u.searchParams.get("from"), to: u.searchParams.get("to") }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  searchParams = new URLSearchParams();
  push.mockReset();
  replace.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => json(perf()));
  vi.stubGlobal("fetch", fetchMock);
  qc = createQueryClient();
  qc.setDefaultOptions({ queries: { retry: false, staleTime: 30_000 } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  qc.clear();
});

describe("AgentPerformanceView", () => {
  it("offers three period choices and defaults to 30 days with a matching request", async () => {
    mount();
    await screen.findAllByText("Security Reviewer");
    for (const name of ["1 day", "30 days", "Custom range"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "30 days" }).getAttribute("aria-pressed")).toBe("true");
    expect(ranges()[0]).toEqual({
      from: new Date(NOW.getTime() - 30 * DAY).toISOString(),
      to: NOW.toISOString(),
    });
  });

  it("fetches once per selection and mirrors it to the URL", async () => {
    mount();
    await screen.findAllByText("Security Reviewer");
    fireEvent.click(screen.getByRole("button", { name: "1 day" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(ranges()).toContainEqual({
      from: new Date(NOW.getTime() - DAY).toISOString(),
      to: NOW.toISOString(),
    });
    expect(replace).toHaveBeenLastCalledWith("/agent-performance?period=1d");

    fireEvent.click(screen.getByRole("button", { name: "Custom range" }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(ranges()).toContainEqual({
      from: new Date(2026, 9, 1).toISOString(),
      to: new Date(2026, 9, 11).toISOString(),
    });
    expect(replace).toHaveBeenLastCalledWith("/agent-performance?period=custom&start=2026-10-01&end=2026-10-10");
  });

  it("rejects an inverted and a future range without a request", async () => {
    mount();
    await screen.findAllByText("Security Reviewer");
    fireEvent.click(screen.getByRole("button", { name: "Custom range" }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-10" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The range ends before it starts.");

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-10" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The range cannot end after today.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it("restores a custom range from the URL", async () => {
    searchParams = new URLSearchParams("period=custom&start=2026-10-01&end=2026-10-10");
    mount();
    await screen.findAllByText("Security Reviewer");
    expect(ranges()[0]).toEqual({
      from: new Date(2026, 9, 1).toISOString(),
      to: new Date(2026, 9, 11).toISOString(),
    });
    expect(screen.getByRole("button", { name: "Custom range" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows digit-free placeholders while the request is pending", () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    mount();
    const region = screen.getByTestId("performance-loading");
    expect(region.textContent).toBe("");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a load error with Retry that fetches the same URL again", async () => {
    fetchMock.mockImplementationOnce(async () => json({ error: "boom" }, 500));
    mount();
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Could not load agent performance.")).toBeTruthy();
    expect(alert.textContent).not.toMatch(/\d/);
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await screen.findAllByText("Security Reviewer");
    const [first, second] = urls();
    expect(second!.search).toBe(first!.search);
  });

  it("shows the empty state, not a table, when there are no runs", async () => {
    fetchMock.mockImplementation(async () => json(perf(0)));
    mount();
    expect(await screen.findByText("No agent runs in 30 days")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("only reads: every request is a GET, through load, period change, sort and View", async () => {
    mount();
    await screen.findAllByText("Security Reviewer");
    fireEvent.click(screen.getByRole("button", { name: "1 day" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole("button", { name: /Accept rate/ }));
    fireEvent.click(screen.getByRole("button", { name: "View Security Reviewer" }));
    expect(push).toHaveBeenCalledWith("/agents/a1");
    for (const call of fetchMock.mock.calls) {
      const method = (call[1] as RequestInit | undefined)?.method;
      expect(method === undefined || method === "GET").toBe(true);
    }
  });
});
