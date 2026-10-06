import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json"; // apps/web/messages/en/runs.json

// Mock the trace hooks so the drawer renders without a query client / SSE.
const TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, findings: 2, grounding: "2/2 passed" },
  prompt_assembly: { system: "You are a reviewer.", skills: "### skill", memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [{ tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 }],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [{ pr: 471, text: "rate-limit public endpoints" }],
  specs_read: [],
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
  ],
};

vi.mock("../../../../../../../lib/hooks/trace", () => ({
  useRunTrace: () => ({ data: TRACE, isLoading: false }),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import RunTraceDrawer from "./RunTraceDrawer";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

describe("A5 Run Trace drawer (smoke)", () => {
  it("renders the trace tabs and stats", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
  });

  it("switches to the live log tab", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("log"));
    // LiveLogStream renders its filter input
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });
});

/**
 * The drawer reads ONLY the persisted trace document, so a run reviewed before
 * cost tracking existed has no `cost_usd` key at all — that must render as "—"
 * rather than crash or read as free.
 */
describe("Run trace — cost tile", () => {
  afterEach(() => {
    delete TRACE.stats.cost_usd;
  });

  it("shows an em dash when the trace carries no cost", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("COST")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows the run's cost when the trace carries one", () => {
    TRACE.stats.cost_usd = 0.0612;
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("$0.061")).toBeInTheDocument();
  });
});

const SPECS_LABEL = "Project context — attached specs (untrusted)";
const SPECS_TEXT = [
  "## Project context",
  "",
  '<untrusted source="specs/security-baseline.md">',
  "No refunds after 30 days.",
  "</untrusted>",
  "",
  '<untrusted source="specs/public-api.md">',
  "Every public route is rate limited.",
  "END_OF_CONTEXT",
  "</untrusted>",
].join("\n");

const SECURITY_BASELINE = "specs/security-baseline.md";
const PUBLIC_API = "specs/public-api.md";

/** The line of the "Specs read" row that names `path`: the path and what follows it. */
const specEntry = (path: string) => within(screen.getByText(path).parentElement!);

function renderDrawer() {
  renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
}

describe("Run trace — Specs read row", () => {
  afterEach(() => {
    delete TRACE.specs_docs;
    TRACE.specs_read = [];
  });

  it("lists each document of the trace with its token estimate (AC-77, NFR-7)", () => {
    TRACE.specs_read = [SECURITY_BASELINE, PUBLIC_API];
    TRACE.specs_docs = [
      { path: SECURITY_BASELINE, tokens: 120, source: "agent" },
      { path: PUBLIC_API, tokens: 1240, source: "agent" },
    ];
    renderDrawer();

    expect(specEntry(SECURITY_BASELINE).getByText("≈ 120 tok")).toBeInTheDocument();
    expect(specEntry(PUBLIC_API).getByText("≈ 1,240 tok")).toBeInTheDocument();
  });

  it("says none when the trace read no specs (AC-78)", () => {
    renderDrawer();
    expect(screen.getByText("none")).toBeInTheDocument();
  });

  it("says none for an empty specs_docs as well (AC-78)", () => {
    TRACE.specs_docs = [];
    renderDrawer();
    expect(screen.getByText("none")).toBeInTheDocument();
  });

  it("says whether a document was attached to the agent or came through a skill, naming the skill (AC-87)", () => {
    TRACE.specs_read = [SECURITY_BASELINE, PUBLIC_API];
    TRACE.specs_docs = [
      { path: SECURITY_BASELINE, tokens: 120, source: "agent" },
      { path: PUBLIC_API, tokens: 90, source: "skill", skill_name: "pr-quality-rubric" },
    ];
    renderDrawer();

    expect(specEntry(SECURITY_BASELINE).getByText("agent")).toBeInTheDocument();
    expect(specEntry(SECURITY_BASELINE).queryByText(/via /)).not.toBeInTheDocument();
    expect(specEntry(PUBLIC_API).getByText("via pr-quality-rubric")).toBeInTheDocument();
    expect(specEntry(PUBLIC_API).queryByText("agent")).not.toBeInTheDocument();
  });

  it("shows only the path and the tokens for an entry without a source (AC-87)", () => {
    TRACE.specs_read = [SECURITY_BASELINE];
    TRACE.specs_docs = [{ path: SECURITY_BASELINE, tokens: 120 }];
    renderDrawer();

    const entry = specEntry(SECURITY_BASELINE);
    expect(entry.getByText("≈ 120 tok")).toBeInTheDocument();
    expect(entry.queryByText("agent")).not.toBeInTheDocument();
    expect(entry.queryByText(/via /)).not.toBeInTheDocument();
  });

  it("falls back to the bare paths of a trace stored before project context (AC-77)", () => {
    TRACE.specs_read = [SECURITY_BASELINE];
    renderDrawer();

    const entry = specEntry(SECURITY_BASELINE);
    expect(entry.queryByText(/tok$/)).not.toBeInTheDocument();
    expect(entry.queryByText("agent")).not.toBeInTheDocument();
    expect(screen.queryByText("none")).not.toBeInTheDocument();
  });
});

describe("Run trace — Project context prompt row", () => {
  afterEach(() => {
    TRACE.prompt_assembly.specs = null;
  });

  const openPromptAssembly = () => fireEvent.click(screen.getByText("Prompt assembly"));
  const specsText = () => screen.getByText((_, el) => el?.tagName === "PRE" && el.textContent === SPECS_TEXT);

  it("is labelled as the attached, untrusted specs when the prompt holds project context (AC-79)", () => {
    TRACE.prompt_assembly.specs = SPECS_TEXT;
    renderDrawer();
    openPromptAssembly();

    expect(screen.getByText(SPECS_LABEL)).toBeInTheDocument();
  });

  it("is absent when the prompt holds no project context (AC-79)", () => {
    renderDrawer();
    openPromptAssembly();

    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.queryByText(SPECS_LABEL)).not.toBeInTheDocument();
  });

  it("shows the whole text sent to the model when the row is expanded (AC-80)", () => {
    TRACE.prompt_assembly.specs = SPECS_TEXT;
    renderDrawer();
    openPromptAssembly();

    fireEvent.click(screen.getByText(SPECS_LABEL));
    expect(specsText()).toBeInTheDocument();
  });

  it("shows the whole text sent to the model in the full-screen view (AC-80)", () => {
    TRACE.prompt_assembly.specs = SPECS_TEXT;
    renderDrawer();
    openPromptAssembly();

    const head = screen.getByText(SPECS_LABEL).parentElement!;
    fireEvent.click(within(head).getByRole("button", { name: "Open fullscreen" }));

    // The row stays collapsed, so the only block holding the text is the full-screen one.
    expect(specsText().closest('[role="dialog"]')).not.toBeNull();
  });
});
