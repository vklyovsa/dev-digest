import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiFile } from "@devdigest/shared";
import ci from "../../../../../../../../../../messages/en/ci.json";
import common from "../../../../../../../../../../messages/en/common.json";

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/web" } }),
}));

import { ExportWizard } from "./ExportWizard";

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
  skill_count: 1,
};

const WORKFLOW = "name: DevDigest Review\non: pull_request\n";
const FILES: CiFile[] = [
  { path: ".devdigest/agents/security-reviewer.yaml", contents: "name: Security Reviewer\n", editable: false, size_bytes: 24 },
  { path: ".devdigest/skills/sql.md", contents: "skill body", editable: false, size_bytes: 10 },
  { path: ".devdigest/memory.jsonl", contents: "", editable: false, size_bytes: 0 },
  { path: ".devdigest/runner/index.js", contents: "", editable: false, size_bytes: 1554000 },
  { path: ".github/workflows/devdigest-review.yml", contents: WORKFLOW, editable: true, size_bytes: WORKFLOW.length },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
const calls = (path: string) =>
  fetchMock.mock.calls.filter(([u]) => new URL(String(u)).pathname === path);
const bodyOf = (call: [RequestInfo | URL, RequestInit?]) => JSON.parse(String(call[1]?.body));

let install: () => Response;
let zip: () => Response;

function renderWizard(props: { initialRepo?: string | null } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ ci, common }}>
        <ExportWizard agent={AGENT} onClose={() => {}} {...props} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const w = ci.exportWizard;

beforeEach(() => {
  install = () => json({ installation: {}, files: FILES, pr_url: "https://github.com/acme/web/pull/12" });
  zip = () => new Response(new Blob(["zip"]), { status: 200 });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const { pathname } = new URL(String(input));
    if (pathname === "/agents/a1/ci/preview") return json({ files: FILES });
    if (pathname === "/agents/a1/export-ci") return install();
    if (pathname === "/agents/a1/ci/zip") return zip();
    throw new Error(`unexpected request ${pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ExportWizard", () => {
  it("walks Target, Preview, Configure and Install and opens the export PR with the edited workflow (AC-1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)", async () => {
    renderWizard();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    for (const label of Object.values(w.steps)) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(w.targets.gha)).toBeInTheDocument();
    const repo = screen.getByRole("textbox", { name: new RegExp(w.repoLabel) });
    expect(repo).toHaveValue("acme/web");

    fireEvent.change(repo, { target: { value: "acme" } });
    expect(screen.getByRole("button", { name: w.continue })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(w.repoInvalid);
    fireEvent.change(repo, { target: { value: "acme/web" } });
    click(w.continue);

    await screen.findByText(".github/workflows/devdigest-review.yml");
    expect(calls("/agents/a1/ci/preview")).toHaveLength(1);
    expect(bodyOf(calls("/agents/a1/ci/preview")[0]!)).toEqual({
      repo: "acme/web",
      triggers: ["opened", "synchronize"],
      post_as: "github_review",
    });
    for (const f of FILES) expect(screen.getByText(f.path)).toBeInTheDocument();
    expect(screen.getByLabelText("Contents of .devdigest/skills/sql.md")).toHaveTextContent("skill body");
    expect(screen.queryByLabelText(/Contents of \.devdigest\/runner/)).not.toBeInTheDocument();
    expect(screen.getByText("1,554,000 bytes")).toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    const editor = screen.getByLabelText(/Workflow file/);
    expect(editor).toHaveValue(WORKFLOW);
    fireEvent.change(editor, { target: { value: "name: edited\n" } });
    click(w.continue);

    const opened = screen.getByRole("checkbox", { name: w.triggers.opened });
    expect(opened).toBeChecked();
    expect(screen.getByRole("checkbox", { name: w.triggers.synchronize })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: w.triggers.reopened })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: w.postAs.githubReview })).toBeChecked();
    expect(screen.getByRole("radio", { name: w.postAs.prComment })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: w.postAs.none })).not.toBeChecked();
    expect(screen.getByText(/OPENROUTER_API_KEY/)).toHaveTextContent("Settings → Secrets and variables → Actions");
    expect(screen.queryByText(/not set|is set/i)).not.toBeInTheDocument();
    expect(screen.getByText(/No GitHub App/)).toBeInTheDocument();
    expect(screen.getByText(/Fail CI on/)).toBeInTheDocument();

    fireEvent.click(opened);
    fireEvent.click(screen.getByRole("checkbox", { name: w.triggers.synchronize }));
    expect(screen.getByRole("button", { name: w.continue })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: w.triggers.reopened }));
    fireEvent.click(screen.getByRole("radio", { name: w.postAs.prComment }));
    expect(screen.getByRole("button", { name: w.continue })).toBeEnabled();
    click(w.continue);

    expect(screen.getByRole("radio", { name: w.installCardTitle })).toBeChecked();
    expect(screen.getByRole("radio", { name: w.zipTitle })).not.toBeChecked();
    click(w.install);

    const link = await screen.findByRole("link", { name: w.prLink });
    expect(link).toHaveAttribute("href", "https://github.com/acme/web/pull/12");
    expect(bodyOf(calls("/agents/a1/export-ci")[0]!)).toEqual({
      repo: "acme/web",
      triggers: ["reopened"],
      post_as: "pr_comment",
      workflow_yaml: "name: edited\n",
    });
  });

  it("sends no workflow_yaml when the author did not edit it, and prefers the repository it was opened with (AC-2, AC-6, AC-64)", async () => {
    renderWizard({ initialRepo: "acme/other" });
    expect(screen.getByRole("textbox", { name: new RegExp(w.repoLabel) })).toHaveValue("acme/other");
    click(w.continue);
    await screen.findByText(".github/workflows/devdigest-review.yml");
    click(w.continue);
    click(w.continue);
    click(w.install);
    await screen.findByRole("link", { name: w.prLink });
    expect(bodyOf(calls("/agents/a1/export-ci")[0]!).workflow_yaml).toBeUndefined();
  });

  it("shows the API message on the Install step and keeps Download zip available (AC-13)", async () => {
    install = () => json({ error: { code: "external_service_error", message: "Resource not accessible" } }, 502);
    const createObjectURL = vi.fn(() => "blob:zip");
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderWizard();
    click(w.continue);
    await screen.findByText(".github/workflows/devdigest-review.yml");
    click(w.continue);
    click(w.continue);
    click(w.install);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/Resource not accessible/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: w.prLink })).not.toBeInTheDocument();

    const zipOption = screen.getByRole("radio", { name: w.zipTitle });
    expect(zipOption).toBeEnabled();
    fireEvent.click(zipOption);
    click(w.install);
    await waitFor(() => expect(calls("/agents/a1/ci/zip")).toHaveLength(1));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(await screen.findByText(w.zipDownloaded)).toBeInTheDocument();
    expect(anchorClick).toHaveBeenCalledTimes(1);
    anchorClick.mockRestore();
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  });

  it("keeps Continue disabled and shows the API message when the preview fails", async () => {
    fetchMock.mockImplementation(async () => json({ error: { code: "conflict", message: "Runner bundle not found" } }, 409));
    renderWizard();
    click(w.continue);
    expect(await screen.findByRole("alert")).toHaveTextContent("Runner bundle not found");
    expect(screen.getByRole("button", { name: w.continue })).toBeDisabled();
  });
});
