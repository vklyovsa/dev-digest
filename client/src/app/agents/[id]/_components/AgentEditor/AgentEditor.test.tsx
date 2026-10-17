import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import context from "../../../../../../messages/en/context.json";
import evalMessages from "../../../../../../messages/en/eval.json";
import common from "../../../../../../messages/en/common.json";
import { ToastProvider } from "@/lib/toast";

// Mock the data hooks so the editor renders without a network/query client.
// The Skills and Context tabs' hooks are mocked too: AgentEditor imports those
// tabs eagerly, and a named import missing from a mocked module throws when it
// is read.
vi.mock("../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
  useAgentSkills: () => ({ data: [] }),
  useSetAgentSkills: () => ({ mutate: vi.fn(), isPending: false }),
  useAgentContext: () => ({ data: { paths: [], inherited: [] }, isPending: false, isError: false, refetch: vi.fn() }),
  useSetAgentContext: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: [], isLoading: false }),
  useSkillContext: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
  useSetSkillContext: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("../../../../../lib/hooks/core", () => ({
  useContextFiles: () => ({
    data: { roots: ["specs", "docs", "insights"], documents: [] },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/hooks/evals", () => ({
  useEvalCases: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useEvalRuns: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useDeleteEvalCase: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null }),
  useStartEvalRun: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useEvalCompare: () => ({ data: undefined, isLoading: false, error: null }),
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "r1", full_name: "acme/payments-api" }, reposLoaded: true }),
}));

import { AgentEditor } from "./AgentEditor";
import { TAB_KEYS } from "./constants";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
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
  skill_count: 3,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages, context, eval: evalMessages, common }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });
});

describe("Agent Editor — Context tab", () => {
  const tabLabels = () =>
    Array.from(screen.getByRole("button", { name: "Config" }).parentElement!.children).map((b) => b.textContent);

  it("is the third tab, after Skills (AC-81)", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(tabLabels().slice(0, 3)).toEqual(["Config", "Skills", "Context"]);
  });

  it("asks for tab=context when it is clicked (AC-81)", () => {
    const onTab = vi.fn();
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={onTab} />);
    fireEvent.click(screen.getByRole("button", { name: "Context" }));
    expect(onTab).toHaveBeenCalledWith("context");
  });

  it("is a tab the page accepts from ?tab= (AC-29)", () => {
    expect(TAB_KEYS).toContain("context");
  });

  it("shows the Context tab, and not the Config fields, when tab is context (AC-29)", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="context" onTab={() => {}} />);
    expect(screen.getByRole("heading", { name: context.agentTab.title })).toBeInTheDocument();
    expect(screen.queryByText("Save agent")).not.toBeInTheDocument();
  });
});

describe("Agent Editor — Evals tab (AC-21)", () => {
  const tabLabels = () =>
    Array.from(screen.getByRole("button", { name: "Config" }).parentElement!.children).map((b) => b.textContent);

  it("is the fourth tab, after Context", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(tabLabels().slice(0, 4)).toEqual(["Config", "Skills", "Context", "Evals"]);
  });

  it("asks for tab=evals when it is clicked", () => {
    const onTab = vi.fn();
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={onTab} />);
    fireEvent.click(screen.getByRole("button", { name: "Evals" }));
    expect(onTab).toHaveBeenCalledWith("evals");
  });

  it("is a tab the page accepts from ?tab=", () => {
    expect(TAB_KEYS).toContain("evals");
  });

  it("shows the Evals tab, and not the Config fields, when tab is evals", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="evals" onTab={() => {}} />);
    expect(screen.getByText(evalMessages.evalsTab.metricsTitle)).toBeInTheDocument();
    expect(screen.getByText(evalMessages.evalsTab.emptyCases)).toBeInTheDocument();
    expect(screen.queryByText("Save agent")).not.toBeInTheDocument();
  });
});
