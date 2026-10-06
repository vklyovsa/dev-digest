import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import type { FindingRecord, PrBriefRecord, ReviewRecord } from "@devdigest/shared";
import { markCatalog, unmarkedStrings } from "@/test/catalog-probe";
import brief from "../../../../../../../../../../messages/en/brief.json";
import prReview from "../../../../../../../../../../messages/en/prReview.json";
import common from "../../../../../../../../../../messages/en/common.json";
import { PrBriefSummary } from "./PrBriefSummary";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const failure = (status: number, message = "boom") => json({ error: { code: "failed", message } }, status);

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const BRIEF: PrBriefRecord = {
  pr_id: "pr1",
  head_sha: "abc1234",
  stale: false,
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  tokens_in: 8200,
  tokens_out: 1300,
  cost_usd: 0.0013,
  documents_read: ["docs/rate-limits.md", "specs/refunds.md"],
  summary: "Adds rate limiting to the public endpoints.",
  review_focus: [{ file: "src/config.ts", line: 12, reason: "A live key is committed." }],
  risks: { risks: [] },
  intent: { intent: "Add rate limiting", in_scope: [], out_of_scope: [] },
  blast: { changed_symbols: [], downstream: [], summary: "No callers." },
};

const withBrief = (o: Partial<PrBriefRecord>): PrBriefRecord => ({ ...BRIEF, ...o });

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "security",
    title: "A finding",
    file: "src/config.ts",
    start_line: 1,
    end_line: 2,
    rationale: "Because.",
    confidence: 0.9,
    review_id: "rv1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function review(o: Partial<ReviewRecord> & { id: string }): ReviewRecord {
  return {
    pr_id: "pr1",
    agent_id: "a1",
    run_id: `run-${o.id}`,
    agent_name: "Security agent",
    kind: "review",
    verdict: "request_changes",
    summary: "Review summary.",
    score: 61,
    model: null,
    created_at: "2026-10-01T10:00:00Z",
    findings: [],
    ...o,
  };
}

interface Server {
  get: () => Response | Promise<Response>;
  post: () => Response | Promise<Response>;
  reviews: () => Response | Promise<Response>;
}

const defaults = (): Server => ({
  get: () => json({ brief: null }),
  post: () => json({ brief: BRIEF }),
  reviews: () => json([]),
});

let server: Server = defaults();

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  if (url.pathname === "/pulls/pr1/brief" && method === "GET") return server.get();
  if (url.pathname === "/pulls/pr1/brief" && method === "POST") return server.post();
  if (url.pathname === "/pulls/pr1/reviews") return server.reviews();
  throw new Error(`unexpected request ${method} ${url.pathname}`);
});

const briefRequests = (method: "GET" | "POST") =>
  fetchMock.mock.calls.filter(
    ([input, init]) => new URL(String(input)).pathname === "/pulls/pr1/brief" && (init?.method ?? "GET") === method,
  );

function renderSummary(messages: AbstractIntlMessages = { brief, prReview, common }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <PrBriefSummary prId="pr1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const generateButton = () => screen.getByRole("button", { name: "Generate brief" });
const refreshButton = () => screen.findByRole("button", { name: "Regenerate brief" });

beforeEach(() => {
  server = defaults();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PrBriefSummary — reading the stored brief", () => {
  it("shows the heading, the unavailable text, its hint and a Generate brief button when none is stored (AC-1, AC-2)", async () => {
    renderSummary();

    expect(await screen.findByText("Brief not available yet.")).toBeInTheDocument();
    expect(screen.getByText("PR Brief")).toBeInTheDocument();
    expect(screen.getByText("Use Generate brief to create one.")).toBeInTheDocument();
    expect(generateButton()).toBeEnabled();
  });

  it("shows a loading placeholder and no Generate brief button while the request is pending (AC-3)", async () => {
    const pending = deferred();
    server.get = () => pending.promise;
    renderSummary();

    expect(await screen.findByRole("status", { name: "Loading brief…" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate brief" })).not.toBeInTheDocument();
    expect(screen.getByText("PR Brief")).toBeInTheDocument();
  });

  it("shows an error with a Retry control that repeats the request (AC-4)", async () => {
    server.get = () => failure(500);
    renderSummary();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the brief.");
    expect(briefRequests("GET")).toHaveLength(1);

    server.get = () => json({ brief: BRIEF });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText(BRIEF.summary)).toBeInTheDocument();
    expect(briefRequests("GET")).toHaveLength(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a stored brief without sending a POST (AC-31, NFR-3)", async () => {
    server.get = () => json({ brief: BRIEF });
    renderSummary();

    expect(await screen.findByText(BRIEF.summary)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate brief" })).not.toBeInTheDocument();
    expect(briefRequests("POST")).toHaveLength(0);
  });
});

describe("PrBriefSummary — generating", () => {
  it("sends one POST, disables the button, shows a skeleton and ignores a second activation (AC-5, AC-6, AC-60)", async () => {
    const pending = deferred();
    server.post = () => pending.promise;
    renderSummary();
    await screen.findByText("Brief not available yet.");

    fireEvent.click(generateButton());

    await waitFor(() => expect(generateButton()).toBeDisabled());
    expect(screen.getByRole("status", { name: "Generating brief…" })).toBeInTheDocument();
    fireEvent.click(generateButton());
    expect(briefRequests("POST")).toHaveLength(1);

    pending.resolve(json({ brief: BRIEF }));

    expect(await screen.findByText(BRIEF.summary)).toBeInTheDocument();
    expect(screen.queryByText("Brief not available yet.")).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Generating brief…" })).not.toBeInTheDocument();
    expect(briefRequests("GET")).toHaveLength(1);
  });

  it("regenerates from the refresh control, keeping the earlier brief on screen meanwhile (AC-35, AC-36, AC-38)", async () => {
    const pending = deferred();
    server.get = () => json({ brief: withBrief({ summary: "First summary." }) });
    server.post = () => pending.promise;
    renderSummary();

    const refresh = await refreshButton();
    fireEvent.click(refresh);

    await waitFor(() => expect(refresh).toBeDisabled());
    expect(screen.getByText("First summary.")).toBeInTheDocument();
    fireEvent.click(refresh);
    expect(briefRequests("POST")).toHaveLength(1);

    pending.resolve(json({ brief: withBrief({ summary: "Second summary." }) }));

    expect(await screen.findByText("Second summary.")).toBeInTheDocument();
    expect(screen.queryByText("First summary.")).not.toBeInTheDocument();
    await waitFor(() => expect(refresh).toBeEnabled());
  });

  it("shows the server's message under the heading, enables the control and never repeats the POST (AC-40, NFR-3)", async () => {
    server.post = () => failure(502, "The model returned an invalid answer.");
    renderSummary();
    await screen.findByText("Brief not available yet.");

    fireEvent.click(generateButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't generate the brief: The model returned an invalid answer.");
    await waitFor(() => expect(generateButton()).toBeEnabled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(briefRequests("POST")).toHaveLength(1);
  });

  it("keeps the earlier brief and shows the error when a regeneration fails (AC-38, AC-40)", async () => {
    server.get = () => json({ brief: BRIEF });
    server.post = () => failure(502, "upstream down");
    renderSummary();

    fireEvent.click(await refreshButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't generate the brief: upstream down");
    expect(screen.getByText(BRIEF.summary)).toBeInTheDocument();
    expect(await refreshButton()).toBeEnabled();
  });

  it("falls back to the generic message when the failure is not an API error (AC-40)", async () => {
    server.post = () => new Response("not json", { status: 200 });
    renderSummary();
    await screen.findByText("Brief not available yet.");

    fireEvent.click(generateButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't generate the brief: the request failed");
  });
});

describe("PrBriefSummary — notices", () => {
  it("names each missing fact (AC-13)", async () => {
    server.get = () => json({ brief: withBrief({ intent: null, blast: null }) });
    const { unmount } = renderSummary();
    expect(await screen.findByText("Generated without: Intent and Blast radius.")).toBeInTheDocument();
    unmount();

    server.get = () => json({ brief: withBrief({ blast: null }) });
    renderSummary();
    expect(await screen.findByText("Generated without: Blast radius.")).toBeInTheDocument();
  });

  it("shows no missing-facts notice when both facts were read (AC-13)", async () => {
    server.get = () => json({ brief: BRIEF });
    renderSummary();

    await screen.findByText(BRIEF.summary);
    expect(screen.queryByText(/Generated without/)).not.toBeInTheDocument();
  });

  it("shows the stale notice only for a stale brief (AC-53)", async () => {
    server.get = () => json({ brief: withBrief({ stale: true }) });
    const { unmount } = renderSummary();
    expect(await screen.findByText(/The pull request changed after this brief was generated/)).toBeInTheDocument();
    unmount();

    server.get = () => json({ brief: BRIEF });
    renderSummary();
    await screen.findByText(BRIEF.summary);
    expect(screen.queryByText(/changed after this brief was generated/)).not.toBeInTheDocument();
  });
});

describe("PrBriefSummary — the latest review's verdict", () => {
  const AGENT_NEW = "Newest agent";
  const AGENT_OLD = "Older agent";

  it("shows the newest review with a verdict, its score, counts and agent name above the summary (AC-55)", async () => {
    server.get = () => json({ brief: BRIEF });
    server.reviews = () =>
      json([
        review({ id: "old", verdict: "approve", score: 90, agent_name: AGENT_OLD, created_at: "2026-10-01T09:00:00Z" }),
        review({
          id: "new",
          verdict: "request_changes",
          score: 61,
          agent_name: AGENT_NEW,
          created_at: "2026-10-01T11:00:00Z",
          findings: [
            finding({ id: "f1", severity: "CRITICAL" }),
            finding({ id: "f2", severity: "CRITICAL", dismissed_at: "2026-10-01T12:00:00Z" }),
            finding({ id: "f3", severity: "WARNING" }),
          ],
        }),
        review({
          id: "newest",
          verdict: null,
          score: null,
          agent_name: "No verdict agent",
          created_at: "2026-10-01T13:00:00Z",
        }),
      ]);
    renderSummary();

    expect(await screen.findByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("3 findings · 1 blockers")).toBeInTheDocument();
    expect(screen.getByText(AGENT_NEW)).toBeInTheDocument();
    expect(screen.getByText("61")).toBeInTheDocument();
    expect(screen.getByText("PR SCORE")).toBeInTheDocument();
    expect(screen.getByText(BRIEF.summary)).toBeInTheDocument();
    expect(screen.queryByText(AGENT_OLD)).not.toBeInTheDocument();
    expect(screen.queryByText("No verdict agent")).not.toBeInTheDocument();
  });

  it("shows the banner without an agent badge when the review has no agent name (AC-55)", async () => {
    server.get = () => json({ brief: BRIEF });
    server.reviews = () => json([review({ id: "r1", verdict: "approve", score: 88, agent_name: null })]);
    renderSummary();

    expect(await screen.findByText("Approve")).toBeInTheDocument();
    expect(screen.getByText("88")).toBeInTheDocument();
    expect(screen.queryByText("Security agent")).not.toBeInTheDocument();
  });

  it("shows the summary alone when no review has a verdict (AC-56)", async () => {
    server.get = () => json({ brief: BRIEF });
    server.reviews = () => json([review({ id: "r1", verdict: null, score: null })]);
    renderSummary();

    expect(await screen.findByText(BRIEF.summary)).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/reviews"))).toBe(true));
    expect(screen.queryByText("PR SCORE")).not.toBeInTheDocument();
    expect(screen.queryByText("Request changes")).not.toBeInTheDocument();
  });

  it("shows the summary alone when the pull request has no review (AC-56)", async () => {
    server.get = () => json({ brief: BRIEF });
    renderSummary();

    expect(await screen.findByText(BRIEF.summary)).toBeInTheDocument();
    expect(screen.queryByText("PR SCORE")).not.toBeInTheDocument();
  });
});

describe("PrBriefSummary — generation details", () => {
  it("shows the model, grouped token counts and the cost (AC-65)", async () => {
    server.get = () => json({ brief: BRIEF });
    renderSummary();

    expect(await screen.findByText("deepseek/deepseek-v4-flash · 8,200 in → 1,300 out")).toBeInTheDocument();
    expect(screen.getByText("$0.0013")).toBeInTheDocument();
  });

  it("shows no cost when the model has no price (AC-65)", async () => {
    server.get = () => json({ brief: withBrief({ cost_usd: null }) });
    renderSummary();

    expect(await screen.findByText("deepseek/deepseek-v4-flash · 8,200 in → 1,300 out")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("lists the documents that were read as plain text (AC-68)", async () => {
    server.get = () => json({ brief: BRIEF });
    renderSummary();

    expect(await screen.findByText("Documents read")).toBeInTheDocument();
    expect(screen.getByText("docs/rate-limits.md")).toBeInTheDocument();
    expect(screen.getByText("specs/refunds.md")).toBeInTheDocument();
  });

  it("omits the documents list when none were read (AC-68)", async () => {
    server.get = () => json({ brief: withBrief({ documents_read: [] }) });
    renderSummary();

    await screen.findByText(BRIEF.summary);
    expect(screen.queryByText("Documents read")).not.toBeInTheDocument();
  });
});

describe("PrBriefSummary — every visible string comes from the catalog (NFR-10)", () => {
  const AGENT = "Probe agent";
  const DATA = [BRIEF.summary, BRIEF.model, ...BRIEF.documents_read, "$0.0013", AGENT];
  const marked = () => markCatalog({ brief, prReview, common });

  it("loading", async () => {
    server.get = () => new Promise<Response>(() => {});
    const { container } = renderSummary(marked());

    await screen.findByRole("status");
    expect(unmarkedStrings(container, DATA)).toEqual([]);
  });

  it("read error", async () => {
    server.get = () => failure(500);
    const { container } = renderSummary(marked());

    await screen.findByRole("alert");
    expect(unmarkedStrings(container, DATA)).toEqual([]);
  });

  it("no brief", async () => {
    const { container } = renderSummary(marked());

    await screen.findByText(/Brief not available yet/);
    expect(unmarkedStrings(container, DATA)).toEqual([]);
  });

  it("a full brief with a banner, notices and documents", async () => {
    server.get = () => json({ brief: withBrief({ stale: true, intent: null }) });
    server.reviews = () =>
      json([review({ id: "r1", agent_name: AGENT, findings: [finding({ id: "f1", severity: "CRITICAL" })] })]);
    const { container } = renderSummary(marked());

    await screen.findByText(/Request changes/);
    await screen.findByText(/Generated without/);
    expect(container.textContent).toContain(AGENT);
    expect(unmarkedStrings(container, DATA)).toEqual([]);
  });

  it("a failed generation", async () => {
    server.post = () => failure(502, "upstream down");
    const { container } = renderSummary(marked());
    await screen.findByText(/Brief not available yet/);

    fireEvent.click(screen.getByRole("button", { name: /Generate brief/ }));

    await screen.findByRole("alert");
    expect(unmarkedStrings(container, DATA)).toEqual([]);
  });
});
