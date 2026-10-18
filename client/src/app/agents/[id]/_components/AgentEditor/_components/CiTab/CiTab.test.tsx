import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiInstallation, CiRun } from "@devdigest/shared";
import ci from "../../../../../../../../messages/en/ci.json";
import common from "../../../../../../../../messages/en/common.json";

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/active" } }),
}));

import { CiTab } from "./CiTab";

const AGENT: Agent = {
  id: "a1",
  name: "Security Reviewer",
  description: "",
  provider: "openrouter",
  model: "m/x",
  system_prompt: "p",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
  skill_count: 0,
};

const INSTALLATION: CiInstallation = {
  id: "i1",
  agent_id: "a1",
  repo: "acme/web",
  target_type: "gha",
  installed_at: "2026-10-18T10:00:00Z",
  latest_run_status: "succeeded",
  latest_run_at: "2026-10-18T11:00:00Z",
  manifest_version: 2,
};

const run = (n: number): CiRun => ({
  id: `r${n}`,
  ci_installation_id: "i1",
  pr_number: n,
  ran_at: "2026-10-18T11:00:00Z",
  status: "succeeded",
  findings_count: 1,
  cost_usd: 0.01,
  github_url: `https://github.com/acme/web/actions/runs/${n}`,
  source: "gha",
  agent: "Security Reviewer",
  duration_s: 4,
  repo: "acme/web",
  agent_id: "a1",
  verdict: "comment",
  critical: 0,
  warning: 1,
  suggestion: 0,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let installations: CiInstallation[];
let runs: CiRun[];
let put: () => Response;
const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ ci, common }}>
        <CiTab agent={AGENT} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const t = ci.ciTab;

beforeEach(() => {
  installations = [];
  runs = [];
  put = () => json({ ...AGENT, ci_fail_on: "warning" });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const { pathname } = new URL(String(input));
    if (pathname === "/agents/a1/ci/installations") return json(installations);
    if (pathname === "/ci/runs") return json(runs);
    if (pathname === "/agents/a1" && init?.method === "PUT") return put();
    throw new Error(`unexpected request ${pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CiTab", () => {
  it("shows Not in CI yet with an Add to CI button that opens the Export to CI dialog on the active repository (AC-58, AC-1)", async () => {
    renderTab();
    expect(await screen.findByText(t.emptyTitle)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t.addToCi }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(ci.exportWizard.title)).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox")).toHaveValue("acme/active");
  });

  it("lists each installation with its repository, latest run and workflow version beside the current version, and Update CI config opens the dialog on that repository (AC-59, AC-64)", async () => {
    installations = [
      INSTALLATION,
      { ...INSTALLATION, id: "i2", repo: "acme/api", latest_run_status: null, latest_run_at: null, manifest_version: null },
    ];
    renderTab();

    const web = (await screen.findByText("acme/web")).closest("li")!;
    expect(within(web).getByText(t.target)).toBeInTheDocument();
    expect(within(web).getByText(/^Succeeded/)).toBeInTheDocument();
    expect(within(web).getByText(/Workflow v2/)).toHaveTextContent("current v3");

    const api = screen.getByText("acme/api").closest("li")!;
    expect(within(api).getByText(t.noRunYet)).toBeInTheDocument();
    expect(within(api).getByText(/Workflow —/)).toHaveTextContent("current v3");

    fireEvent.click(within(web).getByRole("button", { name: t.updateConfig }));
    expect(within(screen.getByRole("dialog")).getByRole("textbox")).toHaveValue("acme/web");
  });

  it("sends PUT /agents/:id with the chosen ci_fail_on and states that it reaches CI only after Update CI config (AC-62, AC-63)", async () => {
    renderTab();
    await screen.findByText(t.emptyTitle);
    expect(screen.getByRole("radio", { name: t.failOn.critical })).toBeChecked();
    expect(screen.getByText(t.failOnNote)).toBeInTheDocument();

    for (const [label, value] of [
      [t.failOn.warning, "warning"],
      [t.failOn.never, "never"],
    ] as const) {
      fetchMock.mockClear();
      fireEvent.click(screen.getByRole("radio", { name: label }));
      await waitFor(() => {
        const call = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
        expect(call).toBeDefined();
        expect(JSON.parse(String(call![1]!.body))).toEqual({ ci_fail_on: value });
      });
    }
  });

  it("shows the failure and keeps the saved selection when saving Fail CI on is refused (AC-62)", async () => {
    put = () => json({ error: { code: "x", message: "Agent is locked" } }, 500);
    renderTab();
    await screen.findByText(t.emptyTitle);
    fireEvent.click(screen.getByRole("radio", { name: t.failOn.never }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Agent is locked");
    expect(screen.getByRole("radio", { name: t.failOn.critical })).toBeChecked();
  });

  it("shows at most 20 history rows in the order the API returned them (AC-61)", async () => {
    installations = [INSTALLATION];
    runs = Array.from({ length: 25 }, (_, i) => run(25 - i));
    renderTab();
    await screen.findByText("#25");
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(21);
    expect(within(rows[1]!).getByText("#25")).toBeInTheDocument();
    expect(screen.queryByText("#5")).not.toBeInTheDocument();
  });
});
