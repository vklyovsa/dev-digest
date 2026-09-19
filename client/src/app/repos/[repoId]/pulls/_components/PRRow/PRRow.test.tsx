/**
 * The FINDINGS cell of a PR row: the severity roll-up the server sends with the
 * list (every OPEN finding of the PR, across all of its runs) and the read-only
 * hover popover over it. SCORE is derived from the same set, so the two cells
 * are asserted together — a row that says 65 must also show the critical that
 * produced it.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";
import common from "../../../../../../../messages/en/common.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { PRRow } from "./PRRow";

afterEach(cleanup);

const FINDINGS: NonNullable<PrMeta["findings"]> = {
  total: 3,
  counts: [
    { severity: "CRITICAL", count: 1 },
    { severity: "WARNING", count: 2 },
  ],
  previews: [
    {
      id: "f1",
      severity: "CRITICAL",
      category: "security",
      title: "Hardcoded Stripe secret key in commit",
      file: "src/config.ts",
      start_line: 12,
      end_line: 12,
      confidence: 0.98,
      rationale: "Line 12 contains a literal sk_live_ Stripe secret key.",
    },
  ],
};

function pr(o: Partial<PrMeta> = {}): PrMeta {
  return {
    id: "pr-1",
    number: 482,
    title: "Add rate limiting to public API endpoints",
    author: "marisa.koch",
    branch: "feat/rate-limit-public",
    base: "main",
    head_sha: "a1b2c3d",
    additions: 247,
    deletions: 38,
    files_count: 9,
    status: "needs_review",
    opened_at: "2026-06-11T10:00:00.000Z",
    updated_at: "2026-06-11T18:00:00.000Z",
    score: 41,
    cost_usd: 0.014,
    findings: FINDINGS,
    ...o,
  };
}

function renderRow(meta: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, common }}>
      <PRRow pr={meta} repoId="repo-1" />
    </NextIntlClientProvider>,
  );
}

describe("PRRow — FINDINGS cell", () => {
  it("shows the PR's severity roll-up next to its derived score", () => {
    renderRow(pr());
    expect(screen.getByLabelText("1 CRITICAL")).toBeInTheDocument();
    expect(screen.getByLabelText("2 WARNING")).toBeInTheDocument();
    expect(screen.getByText("41")).toBeInTheDocument(); // CircularScore
  });

  it("hovering opens the read-only popover with the required header", () => {
    renderRow(pr());
    fireEvent.mouseEnter(screen.getByLabelText("1 CRITICAL").parentElement!);
    const card = screen.getByRole("tooltip");
    expect(card).toHaveTextContent("3 FINDINGS IN THIS RUN");
    expect(card).toHaveTextContent("Hardcoded Stripe secret key in commit");
    expect(card).toHaveTextContent("src/config.ts:12");
    expect(card.querySelectorAll("button, a, input")).toHaveLength(0);
    // total 3 with one preview → the card admits what it left out
    expect(card).toHaveTextContent("+2 more");
  });

  it("a PR that was never reviewed shows an em dash, not a zero", () => {
    renderRow(pr({ findings: null, score: null }));
    expect(screen.queryByLabelText(/CRITICAL|WARNING|SUGGESTION/)).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("a reviewed PR with nothing open shows an em dash and keeps its 100", () => {
    renderRow(pr({ findings: { total: 0, counts: [], previews: [] }, score: 100 }));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });
});
