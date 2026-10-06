import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadiusResponse, PrBriefRecord, PrIntentRecord } from "@devdigest/shared";
import brief from "../../../../../../../../messages/en/brief.json";
import blast from "../../../../../../../../messages/en/blast.json";
import prReview from "../../../../../../../../messages/en/prReview.json";
import common from "../../../../../../../../messages/en/common.json";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1", number: "482" }),
  useRouter: () => ({ push, replace }),
}));

import { OverviewTab } from "./OverviewTab";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const BRIEF: PrBriefRecord = {
  pr_id: "pr1",
  head_sha: "abc1234",
  stale: false,
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  tokens_in: 8200,
  tokens_out: 1300,
  cost_usd: 0.0013,
  documents_read: [],
  summary: "Adds rate limiting to the public endpoints.",
  review_focus: [
    { file: "src/config.ts", line: 12, reason: "A live key is committed." },
    { file: "src/api/public/webhooks.ts", line: 61, reason: "The callback URL receives the token." },
  ],
  risks: {
    risks: [
      {
        kind: "security",
        title: "Auth surface touched",
        explanation: "The limiter runs before the session check.",
        severity: "high",
        file_refs: ["src/middleware/ratelimit.ts", "src/api/users & roles.ts"],
      },
    ],
  },
  intent: { intent: "Throttle public endpoints", in_scope: [], out_of_scope: [] },
  blast: { changed_symbols: [], downstream: [], summary: "No callers." },
};

const INTENT: PrIntentRecord = {
  intent: "Throttle public endpoints",
  in_scope: ["Add a limiter"],
  out_of_scope: [],
  pr_id: "pr1",
  risk_areas: ["Chip risk one"],
  confidence: "high",
  sources: [],
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  head_sha: "abc1234",
  derived_at: "2026-10-01T10:00:00Z",
  tokens_in: 100,
  tokens_out: 50,
  cost_usd: 0.001,
  stale: false,
};

const BLAST: BlastRadiusResponse = {
  changed_symbols: [],
  downstream: [],
  summary: "",
  totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
  degraded: false,
  reason: null,
  max_callers_per_symbol: 3,
  indexed_sha: null,
  changed_files_count: 0,
  caller_file_facts: [],
};

interface Server {
  brief: () => PrBriefRecord | null;
  intent: () => PrIntentRecord | null;
  generated: () => PrBriefRecord;
}

const defaults = (): Server => ({ brief: () => null, intent: () => INTENT, generated: () => BRIEF });
let server: Server = defaults();

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  if (url.pathname === "/pulls/pr1/brief") {
    return method === "POST" ? json({ brief: server.generated() }) : json({ brief: server.brief() });
  }
  if (url.pathname === "/pulls/pr1/intent") return json({ intent: server.intent() });
  if (url.pathname === "/pulls/pr1/blast") return json(BLAST);
  if (url.pathname === "/pulls/pr1/blast/history") {
    return json({ history: [], available: true, unavailable_reason: null });
  }
  if (url.pathname === "/pulls/pr1/reviews") return json([]);
  throw new Error(`unexpected request ${method} ${url.pathname}`);
});

function renderTab(prBody: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ brief, blast, prReview, common }}>
        <OverviewTab prId="pr1" prBody={prBody} repoId="r1" repoFullName="acme/api" headSha="head999" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const precedes = (a: HTMLElement, b: HTMLElement) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

const FOCUS_HREF = "/repos/r1/pulls/482?tab=diff&file=src%2Fconfig.ts&line=12";

beforeEach(() => {
  server = defaults();
  push.mockClear();
  replace.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OverviewTab — the blocks", () => {
  it("puts the PR Brief heading before the Intent and Blast radius headings (AC-1)", async () => {
    renderTab();

    const heading = await screen.findByText("PR Brief");
    const intent = await screen.findByText("Intent");
    const blastHeading = await screen.findByText("Blast radius");

    expect(precedes(heading, intent)).toBe(true);
    expect(precedes(heading, blastHeading)).toBe(true);
  });

  it("renders the Intent and Blast radius blocks without a stored brief (AC-8)", async () => {
    renderTab();

    expect(await screen.findByText("Brief not available yet.")).toBeInTheDocument();
    expect(await screen.findByText("Intent")).toBeInTheDocument();
    expect(await screen.findByText("Blast radius")).toBeInTheDocument();
    expect(screen.queryByText("Review focus")).not.toBeInTheDocument();
  });

  it("renders the Intent and Blast radius blocks with a stored brief, then Risk areas and Review focus in order (AC-7, AC-8)", async () => {
    server.brief = () => BRIEF;
    renderTab("The pull request description.");

    const summary = await screen.findByText(BRIEF.summary);
    const intent = await screen.findByText("Intent");
    const blastHeading = await screen.findByText("Blast radius");
    const risks = await screen.findByText("Risk areas");
    const focus = await screen.findByText("Review focus");
    const description = screen.getByText("Description");

    expect(precedes(summary, intent)).toBe(true);
    expect(precedes(blastHeading, risks)).toBe(true);
    expect(precedes(risks, focus)).toBe(true);
    expect(precedes(focus, description)).toBe(true);
  });

  it("shows the summary, a risk and a file:line after the POST without touching the router (AC-7)", async () => {
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Generate brief" }));

    expect(await screen.findByText(BRIEF.summary)).toBeInTheDocument();
    expect(screen.getByText("Auth surface touched")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "src/config.ts:12" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "src/api/public/webhooks.ts:61" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("OverviewTab — the Intent block's risk chips", () => {
  it("shows the Intent block's own risk areas while no brief is shown (AC-17)", async () => {
    renderTab();

    expect(await screen.findByText("Chip risk one")).toBeInTheDocument();
    expect(screen.getAllByText("Risk areas")).toHaveLength(1);
  });

  it("leaves them out while a brief is shown (AC-17)", async () => {
    server.brief = () => BRIEF;
    renderTab();

    await screen.findByText(BRIEF.summary);
    expect(await screen.findByText(/Throttle public endpoints/, { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByText("Chip risk one")).not.toBeInTheDocument();
    expect(screen.getAllByText("Risk areas")).toHaveLength(1);
  });

  it("brings them back when the brief goes away (AC-17)", async () => {
    server.brief = () => BRIEF;
    const first = renderTab();
    await screen.findByText(BRIEF.summary);
    first.unmount();

    server.brief = () => null;
    renderTab();

    expect(await screen.findByText("Chip risk one")).toBeInTheDocument();
  });
});

describe("OverviewTab — following a link (AC-63)", () => {
  beforeEach(() => {
    server.brief = () => BRIEF;
  });

  it("pushes the diff target of a Review focus item and does not replace (AC-25, AC-63)", async () => {
    renderTab();

    const link = await screen.findByRole("link", { name: "src/config.ts:12" });
    expect(link).toHaveAttribute("href", FOCUS_HREF);
    fireEvent.click(link);

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(FOCUS_HREF);
    expect(replace).not.toHaveBeenCalled();
  });

  it("pushes the diff target of a risk path with its file encoded and no line (AC-58, AC-63)", async () => {
    renderTab();

    const link = await screen.findByRole("link", { name: "src/api/users & roles.ts" });
    const expected = "/repos/r1/pulls/482?tab=diff&file=src%2Fapi%2Fusers+%26+roles.ts";
    expect(link).toHaveAttribute("href", expected);
    fireEvent.click(link);

    expect(push).toHaveBeenCalledWith(expected);
    expect(replace).not.toHaveBeenCalled();
  });

  it("leaves a modified click to the browser (AC-63)", async () => {
    renderTab();
    const link = await screen.findByRole("link", { name: "src/config.ts:12" });

    let preventedByApp = true;
    document.addEventListener(
      "click",
      (event) => {
        preventedByApp = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );
    fireEvent.click(link, { ctrlKey: true });

    await waitFor(() => expect(preventedByApp).toBe(false));
    expect(push).not.toHaveBeenCalled();
  });
});
