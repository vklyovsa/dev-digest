import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalRun } from "@devdigest/shared";
import evalMessages from "../../../../messages/en/eval.json";
import type { TrendMetric } from "../constants";
import { MetricTiles } from "./MetricTiles";

afterEach(cleanup);

function run(over: Partial<EvalRun> = {}): EvalRun {
  return {
    id: "r1",
    agent_id: "a1",
    agent_version: 7,
    skill_id: null,
    skill_version: null,
    status: "done",
    started_at: "2026-05-29T09:14:00Z",
    duration_ms: 1200,
    recall: 0.82,
    precision: 0.91,
    citation_accuracy: 0.95,
    cases_total: 20,
    cases_passed: 17,
    cases_failed: 3,
    cases_errored: 0,
    findings_total: 30,
    findings_grounded: 28,
    cost_usd: 0.23,
    provider: "openrouter",
    model: "m",
    skills: [],
    case_ids: [],
    error: null,
    ...over,
  };
}

const PREVIOUS = run({ id: "r0", recall: 0.78, precision: 0.93, citation_accuracy: 0.94, cases_passed: 16 });

type Sparklines = Record<TrendMetric, number[] | null>;

function renderTiles(latest: EvalRun | null, previous: EvalRun | null, sparklines?: Sparklines) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <MetricTiles latest={latest} previous={previous} sparklines={sparklines} />
    </NextIntlClientProvider>,
  );
}

const tile = (label: string) => screen.getByText(label).parentElement!;

describe("MetricTiles", () => {
  it("shows percentages with the difference in points and its direction", () => {
    renderTiles(run(), PREVIOUS);

    expect(within(tile("RECALL")).getByText("82%")).toBeInTheDocument();
    expect(within(tile("RECALL")).getByText("4pt")).toBeInTheDocument();
    expect(within(tile("RECALL")).getByRole("img", { name: "up" })).toBeInTheDocument();
    expect(within(tile("PRECISION")).getByText("2pt")).toBeInTheDocument();
    expect(within(tile("PRECISION")).getByRole("img", { name: "down" })).toBeInTheDocument();
    expect(within(tile("CITATION ACCURACY")).getByText("95%")).toBeInTheDocument();
  });

  it("shows the cases passed as a ratio of the cases covered", () => {
    renderTiles(run(), PREVIOUS);
    expect(within(tile("CASES PASSED")).getByText("17/20")).toBeInTheDocument();
  });

  it("shows a difference of zero as no change", () => {
    renderTiles(run({ recall: 0.78 }), PREVIOUS);
    expect(within(tile("RECALL")).getByText("0pt")).toBeInTheDocument();
    expect(within(tile("RECALL")).getByRole("img", { name: "no change" })).toBeInTheDocument();
  });

  it("shows a dash and no difference for a metric without a value", () => {
    renderTiles(run({ recall: null }), PREVIOUS);
    expect(within(tile("RECALL")).getByText("—")).toBeInTheDocument();
    expect(within(tile("RECALL")).queryByText(/pt$/)).toBeNull();
    expect(within(tile("RECALL")).queryByRole("img")).toBeNull();
    expect(within(tile("PRECISION")).getByText("91%")).toBeInTheDocument();
  });

  it("shows no difference when the previous run has no value for the metric", () => {
    renderTiles(run(), run({ id: "r0", precision: null }));
    expect(within(tile("PRECISION")).getByText("91%")).toBeInTheDocument();
    expect(within(tile("PRECISION")).queryByRole("img")).toBeNull();
  });

  it("shows no difference without a previous run", () => {
    renderTiles(run(), null);
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows no values for a set that never ran", () => {
    renderTiles(null, null);
    expect(screen.getAllByText("—")).toHaveLength(4);
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  describe("sparklines", () => {
    const three = [0.7, 0.8, 0.9];

    it("draws one decorative sparkline in each metric tile and none in the cases tile", () => {
      renderTiles(run(), PREVIOUS, { recall: three, precision: three, citation_accuracy: three });

      for (const label of ["RECALL", "PRECISION", "CITATION ACCURACY"]) {
        const spark = tile(label).querySelector("[data-sparkline]");
        expect(spark).not.toBeNull();
        expect(spark).toHaveAttribute("aria-hidden", "true");
        expect(spark!.querySelector("svg")).not.toBeNull();
      }
      expect(tile("CASES PASSED").querySelector("[data-sparkline]")).toBeNull();
      expect(document.querySelectorAll("[data-sparkline]")).toHaveLength(3);
    });

    it("draws no sparkline for a metric without a series", () => {
      renderTiles(run(), PREVIOUS, { recall: null, precision: null, citation_accuracy: null });
      expect(document.querySelector("[data-sparkline]")).toBeNull();
    });

    it("draws only the sparklines of the metrics that have a series", () => {
      renderTiles(run(), PREVIOUS, { recall: three, precision: null, citation_accuracy: null });
      expect(tile("RECALL").querySelector("[data-sparkline]")).not.toBeNull();
      expect(tile("PRECISION").querySelector("[data-sparkline]")).toBeNull();
    });

    it("draws no sparkline without the prop", () => {
      renderTiles(run(), PREVIOUS);
      expect(document.querySelector("[data-sparkline]")).toBeNull();
    });
  });
});
