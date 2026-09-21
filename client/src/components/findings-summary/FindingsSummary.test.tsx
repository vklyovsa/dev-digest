/**
 * The read-only findings surfaces: severity counts and the hover popover used
 * by the PR list and the run timeline. The popover must stay free of controls —
 * accept/dismiss belong to the review-run card on the PR page.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingPreview } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";
import { SeverityCounts, FindingsPopover, countBySeverity } from "./index";

afterEach(cleanup);

const PREVIEWS: FindingPreview[] = [
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
  {
    id: "f2",
    severity: "WARNING",
    category: "perf",
    title: "N+1 query in user list endpoint",
    file: "src/api/users.ts",
    start_line: 45,
    end_line: 52,
    confidence: 0.86,
    rationale: "Loop issues one query per user.",
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("countBySeverity", () => {
  it("groups worst-first and omits severities that are absent", () => {
    expect(countBySeverity(PREVIEWS)).toEqual([
      { severity: "CRITICAL", count: 1 },
      { severity: "WARNING", count: 1 },
    ]);
  });

  it("an empty run produces no counts at all (never a zero)", () => {
    expect(countBySeverity([])).toEqual([]);
  });
});

describe("SeverityCounts", () => {
  it("renders one count per severity with an accessible label", () => {
    renderWithIntl(<SeverityCounts counts={countBySeverity(PREVIEWS)} />);
    expect(screen.getByLabelText("1 CRITICAL")).toBeInTheDocument();
    expect(screen.getByLabelText("1 WARNING")).toBeInTheDocument();
  });

  it("renders nothing when there are no findings", () => {
    const { container } = renderWithIntl(<SeverityCounts counts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("FindingsPopover", () => {
  function openPopover(total = PREVIEWS.length, previews = PREVIEWS) {
    renderWithIntl(
      <FindingsPopover total={total} previews={previews}>
        <span>trigger</span>
      </FindingsPopover>,
    );
    fireEvent.mouseEnter(screen.getByText("trigger").parentElement!);
  }

  it("opens on hover with the acceptance-criteria header", () => {
    openPopover();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByText("2 FINDINGS IN THIS RUN")).toBeInTheDocument();
  });

  it("previews carry title, category, file:line, confidence and rationale", () => {
    openPopover();
    const card = screen.getByRole("tooltip");
    expect(card).toHaveTextContent("Hardcoded Stripe secret key in commit");
    expect(card).toHaveTextContent("security");
    expect(card).toHaveTextContent("src/config.ts:12");
    expect(card).toHaveTextContent("98% conf");
    expect(card).toHaveTextContent("Line 12 contains a literal sk_live_ Stripe secret key.");
    // A range keeps both ends.
    expect(card).toHaveTextContent("src/api/users.ts:45-52");
  });

  it("is read-only — no buttons, links or other controls", () => {
    openPopover();
    const card = screen.getByRole("tooltip");
    expect(card.querySelectorAll("button, a, input, select, textarea")).toHaveLength(0);
  });

  it("says how many findings it did not show", () => {
    openPopover(7);
    expect(screen.getByRole("tooltip")).toHaveTextContent("+5 more");
  });

  it("closes when the pointer leaves", () => {
    openPopover();
    fireEvent.mouseLeave(screen.getByText("trigger").parentElement!);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("renders just its trigger when the run has no findings", () => {
    renderWithIntl(
      <FindingsPopover total={0} previews={[]}>
        <span>trigger</span>
      </FindingsPopover>,
    );
    fireEvent.mouseEnter(screen.getByText("trigger"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
