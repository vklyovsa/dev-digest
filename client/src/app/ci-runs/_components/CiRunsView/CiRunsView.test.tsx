import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { CiRun, CiSyncResult } from "@devdigest/shared";
import ci from "../../../../../messages/en/ci.json";
import common from "../../../../../messages/en/common.json";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div role="region" aria-label="app shell">
      {children}
    </div>
  ),
}));

import { CiRunsView } from "./CiRunsView";

const RUN: CiRun = {
  id: "r1",
  ci_installation_id: "i1",
  pr_number: 9,
  ran_at: "2026-10-18T11:00:00Z",
  status: "succeeded",
  findings_count: 3,
  cost_usd: 0.0123,
  github_url: "https://github.com/acme/web/actions/runs/1",
  source: "gha",
  agent: null,
  duration_s: 4.2,
  repo: "acme/web",
  agent_id: null,
  verdict: "request_changes",
  critical: 1,
  warning: 1,
  suggestion: 1,
};

const EMPTY_SYNC: CiSyncResult = { ingested: 0, skipped: 0, failed: 0, rejected: [], errors: [] };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let runs: CiRun[];
let sync: () => Response;
const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
const order: string[] = [];

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ ci, common }}>
        <CiRunsView />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  runs = [];
  sync = () => json(EMPTY_SYNC);
  order.length = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const { pathname } = new URL(String(input));
    if (pathname === "/ci/sync" && init?.method === "POST") {
      order.push("sync");
      return sync();
    }
    if (pathname === "/ci/runs") {
      order.push("runs");
      return json(runs);
    }
    throw new Error(`unexpected request ${pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const r = ci.runs;

describe("CiRunsView", () => {
  it("syncs on open, reloads the list afterwards and again on Refresh, inside the app shell (AC-39)", async () => {
    runs = [RUN];
    renderView();

    const shell = screen.getByRole("region", { name: "app shell" });
    expect(within(shell).getByRole("heading", { name: r.title })).toBeInTheDocument();

    await waitFor(() => expect(order.filter((x) => x === "sync")).toHaveLength(1));
    await waitFor(() => expect(order.lastIndexOf("runs")).toBeGreaterThan(order.indexOf("sync")));
    expect(await within(shell).findByText("acme/web")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: r.refresh }));
    await waitFor(() => expect(order.filter((x) => x === "sync")).toHaveLength(2));
    await waitFor(() => expect(order.lastIndexOf("runs")).toBeGreaterThan(order.lastIndexOf("sync")));
  });

  it("renders a run as one row with PR, agent dash, verdict, counts, cost and a link to the GitHub run", async () => {
    runs = [RUN];
    renderView();
    const row = (await screen.findByText("acme/web")).closest("tr")!;
    expect(within(row).getByText("#9")).toBeInTheDocument();
    expect(within(row).getByText(r.agentMissing)).toBeInTheDocument();
    expect(within(row).getByText(r.verdict.request_changes)).toBeInTheDocument();
    expect(within(row).getByText("1 C · 1 W · 1 S")).toBeInTheDocument();
    expect(within(row).getByText("$0.0123")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: r.view })).toHaveAttribute("href", RUN.github_url);
  });

  it("shows the empty state when the workspace has no CI run (AC-55)", async () => {
    renderView();
    expect(await screen.findByText(r.emptyTitle)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows a notice with the number and the reasons of rejected runs and repository errors (AC-56)", async () => {
    sync = () =>
      json({
        ...EMPTY_SYNC,
        rejected: [{ run_url: "https://github.com/acme/web/actions/runs/7", reason: "head_sha_mismatch" }],
        errors: [{ repo: "acme/private", message: "Not Found" }],
      });
    renderView();
    const notice = await screen.findByText("2 runs could not be synced");
    const box = notice.parentElement!;
    expect(box).toHaveTextContent(`runs/7 — ${r.reasons.head_sha_mismatch}`);
    expect(box).toHaveTextContent("acme/private — Not Found");
  });

  it("shows no notice when the sync was clean (AC-56)", async () => {
    renderView();
    await screen.findByText(r.emptyTitle);
    expect(screen.queryByText(/could not be synced/)).not.toBeInTheDocument();
  });
});
