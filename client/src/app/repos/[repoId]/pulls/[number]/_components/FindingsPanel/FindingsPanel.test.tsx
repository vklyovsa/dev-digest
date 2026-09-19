import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

function finding(
  o: Partial<FindingRecord> & { id: string; severity: FindingRecord["severity"] },
): FindingRecord {
  return {
    category: "security",
    title: `${o.severity} finding`,
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

const FINDINGS: FindingRecord[] = [
  finding({ id: "f1", severity: "CRITICAL", title: "Hardcoded secret" }),
  finding({ id: "f2", severity: "WARNING", title: "N+1 query" }),
  finding({ id: "f3", severity: "WARNING", title: "Missing index" }),
  finding({ id: "f4", severity: "SUGGESTION", title: "Extract magic number", confidence: 0.4 }),
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** How many finding cards the panel is currently rendering. */
function cardCount(): number {
  return document.querySelectorAll("[data-finding-id]").length;
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={[FINDINGS[0]!]} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

describe("FindingsPanel — severity counters", () => {
  it("shows one pill per severity present, worst first, with real counts", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    const pills = screen
      .getAllByRole("button")
      .filter((b) => b.hasAttribute("aria-pressed"));
    expect(pills.map((p) => p.textContent)).toEqual(["1 CRITICAL", "2 WARNING", "1 SUGGESTION"]);
  });

  it("a pill count equals the number of cards it leaves behind", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(cardCount()).toBe(4);

    fireEvent.click(screen.getByText("2 WARNING"));
    expect(cardCount()).toBe(2);
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.getByText("Missing index")).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
    // …and the pill keeps reporting the same number while filtering.
    expect(screen.getByText("2 WARNING")).toBeInTheDocument();
  });

  it("clicking the selected pill again clears the filter", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    const critical = () => screen.getByText("1 CRITICAL").closest("button")!;

    fireEvent.click(critical());
    expect(cardCount()).toBe(1);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(critical()).toHaveAttribute("aria-pressed", "true");
    expect(critical()).toHaveAttribute("title", "Clear the CRITICAL filter");

    fireEvent.click(critical());
    expect(cardCount()).toBe(4);
    expect(critical()).toHaveAttribute("aria-pressed", "false");
    expect(critical()).toHaveAttribute("title", "Show only CRITICAL findings");
  });

  it("the pills follow the hide-low-confidence toggle, so they never over-count", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("1 SUGGESTION")).toBeInTheDocument();

    // The only SUGGESTION sits below the confidence threshold.
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByText("1 SUGGESTION")).not.toBeInTheDocument();
    expect(cardCount()).toBe(3);
  });

  it("a run with a single severity still gets its pill", () => {
    renderWithIntl(<FindingsPanel findings={[FINDINGS[1]!]} prId="pr1" />);
    expect(screen.getByText("1 WARNING")).toBeInTheDocument();
    expect(screen.queryByText(/CRITICAL/)).not.toBeInTheDocument();
  });
});
