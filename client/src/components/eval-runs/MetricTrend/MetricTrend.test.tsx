import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalRun } from "@devdigest/shared";
import evalMessages from "../../../../messages/en/eval.json";
import { formatUsd } from "@/components/run-cost";
import { formatRunTime } from "../helpers";
import { MetricTrend, type MetricTrendProps } from "./MetricTrend";

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

const NEWEST_FIRST = [
  run({ id: "r3", agent_version: 7 }),
  run({ id: "r2", agent_version: 6, started_at: "2026-05-27T16:40:00Z", recall: 0.78, cases_passed: 16, cases_total: 22, cost_usd: 0.21 }),
  run({ id: "r1", agent_version: 5, started_at: "2026-05-25T11:02:00Z", recall: 0.7, cases_passed: 15, cost_usd: 0.2 }),
];

const onRetry = vi.fn();

function ui(props: Partial<MetricTrendProps> = {}) {
  return (
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <MetricTrend runs={NEWEST_FIRST} loading={false} failed={false} onRetry={onRetry} {...props} />
    </NextIntlClientProvider>
  );
}

const mount = (props: Partial<MetricTrendProps> = {}) => render(ui(props));
const circles = (c: HTMLElement, series?: string) =>
  Array.from(c.querySelectorAll("circle")).filter((el) => !series || el.getAttribute("data-series") === series);
const paths = (c: HTMLElement, series?: string) =>
  Array.from(c.querySelectorAll("path")).filter((el) => !series || el.getAttribute("data-series") === series);
const band = (c: HTMLElement, i: number) => c.querySelector(`[data-run-band="${i}"]`)!;
const labels = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("svg text")).map((el) => el.textContent ?? "");
const plot = () => screen.getByRole("group", { name: /Metric trend, \d+ runs?/ });

afterEach(() => {
  cleanup();
  onRetry.mockReset();
});

describe("MetricTrend", () => {
  it("shows the heading and the three legend texts", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Metric trend" })).toBeInTheDocument();
    expect(screen.getByText("Recall")).toBeInTheDocument();
    expect(screen.getByText("Precision")).toBeInTheDocument();
    expect(screen.getByText("Citation")).toBeInTheDocument();
  });

  it("draws a marker per run and a line per series, oldest first", () => {
    const { container } = mount();
    expect(circles(container)).toHaveLength(9);
    for (const key of ["recall", "precision", "citation_accuracy"]) {
      expect(circles(container, key)).toHaveLength(3);
      expect(paths(container, key)).toHaveLength(1);
    }
    const recall = circles(container, "recall");
    expect(recall[0]!.getAttribute("data-run-index")).toBe("0");
    const xs = recall.map((c) => Number(c.getAttribute("cx")));
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(3);
  });

  it("draws markers and no line for a single run", () => {
    const { container } = mount({ runs: [run()] });
    expect(circles(container)).toHaveLength(3);
    expect(paths(container)).toHaveLength(0);
  });

  it("plots only done runs", () => {
    const { container } = mount({
      runs: [
        run({ id: "a", agent_version: 4, status: "running" }),
        run({ id: "b", agent_version: 3, status: "failed" }),
        run({ id: "c", agent_version: 2, started_at: "2026-05-28T09:00:00Z" }),
        run({ id: "d", agent_version: 1, started_at: "2026-05-27T09:00:00Z" }),
      ],
    });
    expect(labels(container).filter((l) => /^v\d/.test(l))).toEqual(["v1", "v2"]);
  });

  it("scales the axis from 0.6 to 1.0", () => {
    const { container } = mount();
    expect(labels(container).filter((l) => /^\d\.\d$/.test(l)).sort()).toEqual(["0.6", "0.7", "0.8", "0.9", "1.0"]);
  });

  it("lowers the axis for a value below 0.6", () => {
    const { container } = mount({ runs: [run({ precision: 0.45 })] });
    const ticks = labels(container).filter((l) => /^\d\.\d$/.test(l));
    expect(ticks).toContain("0.4");
    expect(ticks).not.toContain("0.3");
    expect(circles(container, "precision")).toHaveLength(1);
  });

  it("leaves a null metric without marker and line to or from it", () => {
    const runs = [
      run({ id: "c", agent_version: 7 }),
      run({ id: "b", agent_version: 6, started_at: "2026-05-27T16:40:00Z", recall: null }),
      run({ id: "a", agent_version: 5, started_at: "2026-05-25T11:02:00Z" }),
    ];
    const { container } = mount({ runs });
    expect(circles(container, "recall")).toHaveLength(2);
    expect(paths(container, "recall")).toHaveLength(0);
    expect(paths(container, "precision")).toHaveLength(1);
  });

  it("labels run positions with the version, in DOM order, duplicates included", () => {
    const first = mount({ runs: [run({ id: "c", agent_version: 7 }), run({ id: "b", agent_version: 6, started_at: "2026-05-27T09:00:00Z" }), run({ id: "a", agent_version: 5, started_at: "2026-05-25T09:00:00Z" })] });
    expect(labels(first.container).filter((l) => /^v\d/.test(l))).toEqual(["v5", "v6", "v7"]);
    cleanup();
    const second = mount({ runs: [run({ id: "b", agent_version: 7 }), run({ id: "a", agent_version: 7, started_at: "2026-05-27T09:00:00Z" })] });
    expect(labels(second.container).filter((l) => l === "v7")).toHaveLength(2);
  });

  it("shows the markers of a run that turns done without a reload", () => {
    const running = run({ id: "n", agent_version: 8, status: "running", started_at: "2026-05-30T09:00:00Z" });
    const { container, rerender } = mount({ runs: [running, ...NEWEST_FIRST] });
    expect(labels(container).filter((l) => /^v\d/.test(l))).toHaveLength(3);
    rerender(ui({ runs: [{ ...running, status: "done" }, ...NEWEST_FIRST] }));
    expect(labels(container).filter((l) => /^v\d/.test(l))).toHaveLength(4);
  });

  it("shows the caption with the run count", () => {
    mount();
    expect(screen.getByText("Last 3 runs")).toBeInTheDocument();
    cleanup();
    mount({ runs: [run()] });
    expect(screen.getByText("Last 1 run")).toBeInTheDocument();
  });

  it("shows the run's details in the tooltip on hover", () => {
    const { container } = mount();
    fireEvent.mouseEnter(band(container, 2));
    const region = within(screen.getByRole("status"));
    expect(region.getByText("v7")).toBeInTheDocument();
    expect(region.getByText(formatRunTime("2026-05-29T09:14:00Z"))).toBeInTheDocument();
    expect(region.getByText("Recall 82%")).toBeInTheDocument();
    expect(region.getByText("Precision 91%")).toBeInTheDocument();
    expect(region.getByText("Citation 95%")).toBeInTheDocument();
    expect(region.getByText("17/20 cases")).toBeInTheDocument();
    expect(region.getByText(`Cost ${formatUsd(0.23)}`, { exact: false })).toBeInTheDocument();
    fireEvent.mouseEnter(band(container, 1));
    expect(screen.getByRole("status")).toHaveTextContent("16/22 cases");
    fireEvent.mouseLeave(plot());
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("shows a dash for a null cost and a null metric", () => {
    const { container } = mount({ runs: [run({ cost_usd: null, recall: null })] });
    fireEvent.mouseEnter(band(container, 0));
    const region = within(screen.getByRole("status"));
    expect(region.getByText("Recall —")).toBeInTheDocument();
    expect(screen.getByRole("status").textContent).toMatch(/—$/);
  });

  it("keeps the band of a run whose three metrics are null", () => {
    const { container } = mount({ runs: [run({ recall: null, precision: null, citation_accuracy: null })] });
    expect(circles(container)).toHaveLength(0);
    fireEvent.mouseEnter(band(container, 0));
    const region = within(screen.getByRole("status"));
    expect(region.getByText("Recall —")).toBeInTheDocument();
    expect(region.getByText("Precision —")).toBeInTheDocument();
    expect(region.getByText("Citation —")).toBeInTheDocument();
  });

  it("is one keyboard tab stop named by the heading and the run count", () => {
    const { container } = mount();
    const group = screen.getByRole("group", { name: /Metric trend, 3 runs/ });
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(container.querySelector('[tabindex="0"]')).toBe(group);
    group.focus();
    expect(document.activeElement).toBe(group);
  });

  it("steps through the runs with the arrow keys", () => {
    mount();
    const group = plot();
    group.focus();
    fireEvent.keyDown(group, { key: "ArrowRight" });
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByRole("status")).toHaveTextContent("v6");
    expect(screen.getByRole("status")).toHaveTextContent("16/22 cases");
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(screen.getByRole("status")).toHaveTextContent("v5");
  });

  it("hides the tooltip on Escape and on blur", () => {
    mount();
    const group = plot();
    group.focus();
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByRole("status")).not.toBeEmptyDOMElement();
    fireEvent.keyDown(group, { key: "Escape" });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    fireEvent.keyDown(group, { key: "ArrowRight" });
    fireEvent.blur(group);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("exposes the active run's text through the live region", () => {
    mount();
    fireEvent.keyDown(plot(), { key: "ArrowLeft" });
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("v7");
    expect(region).toHaveTextContent("Recall 82%");
  });

  it("shows the empty text and no axis for no plotted run", () => {
    const { container } = mount({ runs: [] });
    expect(screen.getByRole("heading", { name: "Metric trend" })).toBeInTheDocument();
    expect(screen.getByText(evalMessages.trend.empty)).toBeInTheDocument();
    expect(container.querySelectorAll("circle")).toHaveLength(0);
    cleanup();
    const failedOnly = mount({ runs: [run({ status: "failed" })] });
    expect(screen.getByText(evalMessages.trend.empty)).toBeInTheDocument();
    expect(labels(failedOnly.container).filter((l) => /^\d\.\d$/.test(l))).toHaveLength(0);
  });

  it("shows the loading text in place of the plot", () => {
    const { container } = mount({ runs: undefined, loading: true });
    expect(screen.getByText(evalMessages.dashboard.loading)).toBeInTheDocument();
    expect(container.querySelectorAll("circle")).toHaveLength(0);
  });

  it("shows the failure with a retry control in place of the plot", () => {
    const { container } = mount({ runs: undefined, failed: true });
    expect(screen.getByText(evalMessages.trend.loadError)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("circle")).toHaveLength(0);
    expect(labels(container)).toHaveLength(0);
  });
});
