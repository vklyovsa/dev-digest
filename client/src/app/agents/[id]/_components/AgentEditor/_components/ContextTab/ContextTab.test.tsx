import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, ContextInheritedDoc, SpecFile } from "@devdigest/shared";
import context from "../../../../../../../../messages/en/context.json";
import { ToastProvider } from "@/lib/toast";

let activeRepo: { id: string; full_name: string } | null = null;
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo, reposLoaded: true }),
}));

import { ContextTab } from "./ContextTab";

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

const doc = (path: string, type: string, tokens: number): SpecFile => ({ path, type, tokens, agent_count: 0 });

const SEC = "specs/security-baseline.md";
const PUB = "specs/public-api.md";
const RATE = "specs/rate-limiting.md";
const ARCH = "docs/architecture.md";
const DEPLOY = "docs/deployment.md";
const INCIDENT = "insights/incident-2026-04-checkout.md";
const PERF = "insights/perf-budget.md";

const DOCS: SpecFile[] = [
  doc(SEC, "specs", 120),
  doc(PUB, "specs", 90),
  doc(RATE, "specs", 80),
  doc(ARCH, "docs", 210),
  doc(DEPLOY, "docs", 107),
  doc(INCIDENT, "insights", 1240),
  doc(PERF, "insights", 60),
];
const ROOTS = ["specs", "docs", "insights"];

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const never = () => new Promise<Response>(() => {});

let attached: string[];
let inherited: ContextInheritedDoc[];
let list: () => Response | Promise<Response>;

const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const { pathname } = new URL(String(input));
  if (pathname === "/repos/r1/context") return list();
  if (pathname === "/agents/a1/context") return json({ paths: attached, inherited });
  throw new Error(`unexpected request ${pathname}`);
});

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ context }}>
        <ToastProvider>
          <ContextTab agent={AGENT} />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

async function renderLoaded() {
  renderTab();
  const rows = await screen.findByRole("list");
  await waitFor(() => expect(rows).toHaveAttribute("aria-busy", "false"));
}

beforeEach(() => {
  activeRepo = { id: "r1", full_name: "acme/payments-api" };
  attached = [];
  inherited = [];
  list = () => json({ roots: ROOTS, documents: DOCS });
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Agent Context tab — heading and count", () => {
  it("shows the heading and the number attached out of the number listed (AC-40)", async () => {
    attached = [SEC, PUB];
    await renderLoaded();

    expect(screen.getByRole("heading", { name: context.agentTab.title })).toBeInTheDocument();
    expect(screen.getByText("2 of 7 attached")).toBeInTheDocument();
    expect(screen.getByText(context.agentTab.hint)).toBeInTheDocument();
  });

  it("shows neither a count nor a token sum until both lists have arrived", async () => {
    attached = [SEC];
    list = never;
    renderTab();

    expect(await screen.findByRole("heading", { name: context.agentTab.title })).toBeInTheDocument();
    expect(screen.queryByText(/attached$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/tokens$/)).not.toBeInTheDocument();
    expect(screen.queryByText(context.agentTab.note)).not.toBeInTheDocument();
  });

  it("shows the notice and no count or token sum when no repository is active (AC-43)", async () => {
    activeRepo = null;
    attached = [SEC];
    renderTab();

    expect(await screen.findByText(context.attach.noRepo)).toBeInTheDocument();
    expect(screen.queryByText(/attached$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/tokens$/)).not.toBeInTheDocument();
  });
});

describe("Agent Context tab — token sum and note", () => {
  it("adds up the tokens of the attached documents (AC-51)", async () => {
    attached = [ARCH, DEPLOY];
    await renderLoaded();
    expect(screen.getByText("≈ 317 tokens")).toBeInTheDocument();
  });

  it("groups the digits of a sum over 999 (AC-51, NFR-7)", async () => {
    attached = [INCIDENT];
    await renderLoaded();
    expect(screen.getByText("≈ 1,240 tokens")).toBeInTheDocument();
  });

  it("counts only the attached documents that are in the list (AC-51)", async () => {
    attached = [ARCH, "docs/removed-since.md"];
    await renderLoaded();
    expect(screen.getByText("≈ 210 tokens")).toBeInTheDocument();
  });

  it("shows the untrusted-block note next to the sum (AC-52)", async () => {
    attached = [ARCH, DEPLOY];
    await renderLoaded();

    const footer = screen.getByText(context.agentTab.note).parentElement!;
    expect(within(footer).getByText("≈ 317 tokens")).toBeInTheDocument();
  });

  it("adds the inherited documents that are in the list to the sum (AC-84)", async () => {
    attached = [ARCH, DEPLOY];
    inherited = [{ path: PUB, skill_id: "s9", skill_name: "pr-quality-rubric" }];
    await renderLoaded();

    expect(screen.getByText("≈ 407 tokens")).toBeInTheDocument();
    expect(screen.getByText("via pr-quality-rubric")).toBeInTheDocument();
  });
});

describe("Agent Context tab — token budget", () => {
  const RUNBOOK = "docs/runbook.md";
  const OVER_BUDGET = "over the 8,000-token budget";

  beforeEach(() => {
    list = () => json({ roots: ROOTS, documents: [...DOCS, doc(RUNBOOK, "docs", 7800)] });
  });

  it("shows no warning while the attached documents fit the budget", async () => {
    attached = [RUNBOOK];
    await renderLoaded();

    expect(screen.getByText("≈ 7,800 tokens")).toBeInTheDocument();
    expect(screen.queryByText(OVER_BUDGET)).not.toBeInTheDocument();
  });

  it("warns once own and inherited documents together pass the budget", async () => {
    attached = [RUNBOOK];
    inherited = [{ path: ARCH, skill_id: "s9", skill_name: "pr-quality-rubric" }];
    await renderLoaded();

    const footer = screen.getByText(context.agentTab.note).parentElement!;
    expect(within(footer).getByText("≈ 8,010 tokens")).toBeInTheDocument();
    expect(within(footer).getByText(OVER_BUDGET)).toBeInTheDocument();
  });
});
