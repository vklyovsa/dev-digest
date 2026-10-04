import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastHistoryResponse, BlastRadiusResponse } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import blast from "../../../../../../../../../../messages/en/blast.json";

interface QueryState<T> {
  data?: T;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
}

let radius: QueryState<BlastRadiusResponse>;
let history: QueryState<BlastHistoryResponse>;
let resync: { start: () => void; isRunning: boolean; timedOut: boolean; ready: boolean };
const refetch = vi.fn();
const start = vi.fn();

vi.mock("@/lib/hooks/blast", () => ({
  useBlastRadius: () => ({ ...radius, refetch }),
  useBlastHistory: () => history,
  useBlastResync: () => resync,
}));

import { BlastRadiusCard } from "./BlastRadiusCard";

const MAP: BlastRadiusResponse = {
  changed_symbols: [
    { name: "rateLimit", file: "src/middleware/ratelimit.ts", kind: "function" },
    { name: "bucketKey", file: "src/middleware/ratelimit.ts", kind: "function" },
  ],
  downstream: [
    {
      symbol: "rateLimit",
      callers: [
        { name: "publicRouter", file: "src/api/a.ts", line: 23 },
        { name: "webhookHandler", file: "src/api/b.ts", line: 45 },
        { name: "app", file: "src/server.ts", line: 88 },
      ],
      endpoints_affected: ["GET /api/public/items"],
      crons_affected: ["0 * * * *"],
    },
    {
      symbol: "bucketKey",
      callers: [{ name: "keyFor", file: "src/api/c.ts", line: 9 }],
      endpoints_affected: [],
      crons_affected: [],
    },
  ],
  summary: "2 changed symbols reach 4 callers, 1 endpoint and 1 cron/job.",
  totals: { symbols: 2, callers: 4, endpoints: 1, crons: 1 },
  degraded: false,
  reason: null,
  max_callers_per_symbol: 3,
  indexed_sha: "idx123",
  changed_files_count: 2,
  caller_file_facts: [
    { file: "src/api/a.ts", endpoints: ["GET /api/public/items"], crons: [] },
    { file: "src/api/b.ts", endpoints: [], crons: ["0 * * * *"] },
  ],
};

const HISTORY: BlastHistoryResponse = {
  history: [
    {
      pr_number: 401,
      title: "Introduce public API namespace",
      merged_at: "2026-03-18T10:00:00Z",
      author: "deepak.r",
      files_overlap: ["src/api/a.ts"],
      notes: "Touched 1 of this PR's 2 changed files.",
    },
    {
      pr_number: 356,
      title: "Add ioredis client",
      merged_at: "2026-02-02T09:00:00Z",
      author: "marisa.koch",
      files_overlap: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
      notes: "Touched 5 of this PR's 2 changed files.",
    },
  ],
  available: true,
  unavailable_reason: null,
};

function renderCard(repoFullName: string | null = "acme/api") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast }}>
      <BlastRadiusCard prId="pr1" repoId="repo1" repoFullName={repoFullName} headSha="head999" />
    </NextIntlClientProvider>,
  );
}

const symbolRow = (name: RegExp) => screen.getByRole("button", { name });
const historyHeader = () => screen.getByRole("button", { name: /Prior PRs touching these files/ });

beforeEach(() => {
  refetch.mockReset();
  start.mockReset();
  radius = { data: MAP };
  history = { data: { history: [], available: true, unavailable_reason: null } };
  resync = { start, isRunning: false, timedOut: false, ready: true };
});

afterEach(cleanup);

describe("BlastRadiusCard — tree", () => {
  it("summarises the map and lists each symbol's callers, endpoints and crons", () => {
    renderCard();

    expect(screen.getByRole("region", { name: "Blast radius" })).toBeInTheDocument();

    const summary = within(screen.getByRole("list", { name: "Blast radius summary" })).getAllByRole("listitem");
    expect(summary.map((item) => item.textContent)).toEqual(["2 symbols", "4 callers", "1 endpoint", "1 cron/job"]);

    const first = symbolRow(/rateLimit\(\)/);
    const second = symbolRow(/bucketKey\(\)/);
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(second).toHaveAttribute("aria-expanded", "false");
    expect(first).toHaveTextContent("3 callers");
    expect(second).toHaveTextContent("1 caller");

    const link = screen.getByRole("link", { name: "src/api/a.ts:23" });
    expect(link).toHaveAttribute("href", "https://github.com/acme/api/blob/idx123/src/api/a.ts#L23");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));

    const endpoints = screen.getByRole("group", { name: "Endpoints affected" });
    expect(within(endpoints).getByText("GET /api/public/items")).toBeInTheDocument();
    expect(within(endpoints).queryByText("0 * * * *")).not.toBeInTheDocument();
    const crons = screen.getByRole("group", { name: "Cron/jobs affected" });
    expect(within(crons).getByText("0 * * * *")).toBeInTheDocument();

    expect(screen.getByText("Showing the top 3 callers by rank.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "src/api/c.ts:9" })).not.toBeInTheDocument();

    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "src/api/c.ts:9" })).toBeInTheDocument();
    expect(screen.getByText("No endpoint or cron depends on these callers.")).toBeInTheDocument();

    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "src/api/a.ts:23" })).not.toBeInTheDocument();
  });

  it("pins links to the PR head when the index commit is unknown, and drops them without a repo", () => {
    radius = { data: { ...MAP, indexed_sha: null } };
    const view = renderCard();
    expect(screen.getByRole("link", { name: "src/api/a.ts:23" })).toHaveAttribute(
      "href",
      "https://github.com/acme/api/blob/head999/src/api/a.ts#L23",
    );
    view.unmount();

    renderCard(null);
    expect(screen.getByText("src/api/a.ts:23")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "src/api/a.ts:23" })).not.toBeInTheDocument();
  });

  it("counts the changed symbols that have no callers", () => {
    radius = {
      data: {
        ...MAP,
        changed_symbols: [...MAP.changed_symbols, { name: "unusedHelper", file: "src/x.ts", kind: "function" }],
        totals: { ...MAP.totals, symbols: 3 },
      },
    };
    renderCard();

    expect(screen.getByText("1 more changed symbol has no callers.")).toBeInTheDocument();
  });
});

describe("BlastRadiusCard — graph", () => {
  it("puts the view switch on the summary row, inside the card", () => {
    renderCard();

    const region = screen.getByRole("region", { name: "Blast radius" });
    const summary = within(region).getByRole("list", { name: "Blast radius summary" });
    const switcher = within(region).getByRole("group", { name: "Blast radius view" });
    expect(switcher.parentElement).toBe(summary.parentElement);
  });

  it("switches between the tree and an SVG graph", () => {
    renderCard();

    const switcher = screen.getByRole("group", { name: "Blast radius view" });
    const graphButton = within(switcher).getByRole("button", { name: "graph" });
    const treeButton = within(switcher).getByRole("button", { name: "tree" });
    expect(treeButton).toHaveAttribute("aria-pressed", "true");
    expect(graphButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("img", { name: "Blast radius graph" })).not.toBeInTheDocument();

    fireEvent.click(graphButton);
    expect(screen.getByRole("img", { name: "Blast radius graph" })).toBeInTheDocument();
    expect(graphButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /rateLimit\(\)/ })).not.toBeInTheDocument();
    expect(screen.getByText("changed symbol")).toBeInTheDocument();

    fireEvent.click(treeButton);
    expect(screen.queryByRole("img", { name: "Blast radius graph" })).not.toBeInTheDocument();
    expect(symbolRow(/rateLimit\(\)/)).toHaveAttribute("aria-expanded", "true");
  });
});

describe("BlastRadiusCard — states", () => {
  it("explains an empty map instead of rendering nothing", () => {
    radius = { data: { ...MAP, downstream: [], totals: { symbols: 2, callers: 0, endpoints: 0, crons: 0 } } };
    const view = renderCard();
    expect(screen.getByText("2 changed symbol(s), no downstream callers found.")).toBeInTheDocument();
    view.unmount();

    radius = { data: { ...MAP, changed_symbols: [], downstream: [], totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 } } };
    renderCard();
    expect(screen.getByText("No indexed symbols are declared in the changed files.")).toBeInTheDocument();
  });

  it("marks an incomplete index with its reason, keeps the data, and offers Re-index", () => {
    radius = { data: { ...MAP, degraded: true, reason: "index_partial" } };
    renderCard();

    expect(screen.getByText("Index incomplete")).toBeInTheDocument();
    expect(screen.getByText("Only part of the repository is indexed, so some callers may be missing.")).toBeInTheDocument();
    expect(symbolRow(/rateLimit\(\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Re-index" }));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("shows progress and the timeout note while a Re-index runs", () => {
    radius = { data: { ...MAP, degraded: true, reason: "flag_off" } };
    resync = { start, isRunning: true, timedOut: false, ready: true };
    const view = renderCard();
    expect(screen.getByRole("button", { name: "Re-indexing…" })).toBeDisabled();
    view.unmount();

    resync = { start, isRunning: false, timedOut: true, ready: true };
    renderCard();
    expect(screen.getByRole("status")).toHaveTextContent("Re-indexing is taking longer than expected.");
  });

  it("says the files are not loaded, without an index badge, when the PR has none stored", () => {
    radius = {
      data: { ...MAP, changed_symbols: [], downstream: [], degraded: true, reason: "no_data", changed_files_count: 0 },
    };
    renderCard();

    expect(
      screen.getByText("The changed files of this pull request are not loaded yet, so there is nothing to map."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Index incomplete")).not.toBeInTheDocument();
  });

  it("keeps the frame while loading and offers a retry after an error", () => {
    radius = { isLoading: true };
    const view = renderCard();
    expect(screen.getByRole("region", { name: "Blast radius" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    view.unmount();

    radius = { isError: true, error: new ApiError("Pull request not found", 404) };
    renderCard();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the blast radius.");
    expect(alert).toHaveTextContent("Pull request not found");

    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe("BlastRadiusCard — prior PRs", () => {
  it("lists prior PRs with their shared files once expanded", () => {
    history = { data: HISTORY };
    renderCard();

    const header = historyHeader();
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(within(header).getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("Introduce public API namespace", { exact: false })).not.toBeInTheDocument();

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "#401 Introduce public API namespace" })).toHaveAttribute(
      "href",
      "https://github.com/acme/api/pull/401",
    );
    expect(screen.getByText("deepak.r · 2026-03-18")).toBeInTheDocument();
    expect(screen.getByText("1 shared file")).toBeInTheDocument();
    expect(screen.getByText("5 shared files")).toBeInTheDocument();
    expect(screen.getByText("+2 more")).toBeInTheDocument();
    expect(screen.queryByText("d.ts")).not.toBeInTheDocument();
    expect(screen.queryByText(/Touched 1 of/)).not.toBeInTheDocument();
  });

  it("explains why prior PRs are unavailable instead of showing an empty list", () => {
    history = { data: { history: [], available: false, unavailable_reason: "no_token" } };
    renderCard();

    expect(within(historyHeader()).queryByText("0")).not.toBeInTheDocument();
    fireEvent.click(historyHeader());
    expect(screen.getByText("Connect a GitHub token in Settings to see prior pull requests.")).toBeInTheDocument();
  });

  it("says nothing touched these files when the list is empty", () => {
    renderCard();

    expect(within(historyHeader()).getByText("0")).toBeInTheDocument();
    fireEvent.click(historyHeader());
    expect(screen.getByText("No merged pull request touched these files recently.")).toBeInTheDocument();
  });
});
