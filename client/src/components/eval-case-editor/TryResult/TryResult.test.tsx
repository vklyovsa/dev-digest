import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseTryResult } from "@devdigest/shared";
import evalMessages from "../../../../messages/en/eval.json";
import { TryResult, type TryResultProps } from "./TryResult";

const result = (over: Partial<EvalCaseTryResult> = {}): EvalCaseTryResult => ({
  status: "pass",
  matched: 1,
  findings: [{ file: "src/a.ts", start_line: 12, end_line: 13, severity: "CRITICAL", category: "security", title: "Hardcoded key" }],
  error: null,
  duration_ms: 1800,
  cost_usd: 0.02,
  ...over,
});

function renderResult(props: Partial<TryResultProps>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <TryResult result={null} error={null} expectationType="must_find" {...props} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("TryResult", () => {
  it("renders nothing without a result or an error", () => {
    renderResult({});
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a pass with the counts, duration and cost in a live region", () => {
    renderResult({ result: result() });

    const region = screen.getByRole("status", { name: "Result of the run" });
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(within(region).getByText("Passed")).toBeInTheDocument();
    expect(within(region).getByText("expected 1, got 1")).toBeInTheDocument();
    expect(within(region).getByText("1.8s")).toBeInTheDocument();
    expect(within(region).getByText("$0.020")).toBeInTheDocument();
  });

  it("shows a fail against a must-not-flag expectation", () => {
    renderResult({ result: result({ status: "fail", matched: 1 }), expectationType: "must_not_flag" });

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("expected 0, got 1")).toBeInTheDocument();
  });

  it("shows the no-cost mark for a null cost", () => {
    renderResult({ result: result({ cost_usd: null }) });

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("lists the findings as text, or says there are none", () => {
    const two = result({
      findings: [
        { file: "a.ts", start_line: 1, end_line: 2, severity: "WARNING", category: "bug", title: "One" },
        { file: "b.ts", start_line: 3, end_line: 3, severity: "CRITICAL", category: "bug", title: "Two" },
      ],
    });
    const { unmount } = renderResult({ result: two });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("a.ts:1–2")).toBeInTheDocument();
    expect(screen.getByText("WARNING")).toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
    unmount();

    renderResult({ result: result({ status: "fail", matched: 0, findings: [] }) });
    expect(screen.getByText("The agent returned no findings.")).toBeInTheDocument();
  });

  it("skips the findings list when compact", () => {
    renderResult({ result: result(), compact: true });

    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(screen.getByText("Passed")).toBeInTheDocument();
  });

  it("shows an errored result inside an alert", () => {
    renderResult({ result: result({ status: "error", error: "model timed out", findings: [] }) });

    expect(screen.getByRole("alert")).toHaveTextContent("errored: model timed out");
  });

  it("shows a request error inside an alert", () => {
    renderResult({ error: new Error("Too many requests") });

    expect(screen.getByRole("alert")).toHaveTextContent("Too many requests");
  });

  it("marks a result stale and shows a label", () => {
    renderResult({ result: result(), stale: true, label: "Security Reviewer" });

    expect(screen.getByText("This result is from earlier content of the form.")).toBeInTheDocument();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
  });

  it("renders markup in a finding as text", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const { container } = renderResult({ result: result({ findings: [{ file: evil, start_line: 1, end_line: 1, severity: evil, category: "bug", title: evil }] }) });

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getAllByText(evil).length).toBeGreaterThan(0);
  });
});
