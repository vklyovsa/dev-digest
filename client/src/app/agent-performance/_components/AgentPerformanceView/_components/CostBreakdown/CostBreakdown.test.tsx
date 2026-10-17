import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import agentPerformance from "../../../../../../../messages/en/agentPerformance.json";
import common from "../../../../../../../messages/en/common.json";
import { CostBreakdown } from "./CostBreakdown";

type Props = React.ComponentProps<typeof CostBreakdown>;

function mount(props: Props) {
  render(
    <NextIntlClientProvider locale="en" messages={{ agentPerformance, common }}>
      <CostBreakdown {...props} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("CostBreakdown", () => {
  it("lists every segment of both charts with a dollar amount (AC-18, AC-38)", () => {
    mount({
      totalCostUsd: 10.77,
      byAgent: [
        { agent_id: "a1", label: "Security Reviewer", value: 5.68 },
        { agent_id: null, label: null, value: 5.09 },
      ],
      byModel: [
        { label: "gpt-4.1", value: 6.1 },
        { label: null, value: 4.67 },
      ],
    });
    expect(screen.getByText("By agent")).toBeTruthy();
    expect(screen.getByText("By model")).toBeTruthy();
    expect(screen.getByText("Security Reviewer")).toBeTruthy();
    expect(screen.getByText("$5.68")).toBeTruthy();
    expect(screen.getByText("Deleted agent")).toBeTruthy();
    expect(screen.getByText("gpt-4.1")).toBeTruthy();
    expect(screen.getByText("$6.10")).toBeTruthy();
    expect(screen.getByText("DevDigest estimate")).toBeTruthy();
  });

  it("names a run without a model Unknown model (AC-46)", () => {
    mount({ totalCostUsd: 1, byAgent: [], byModel: [{ label: null, value: 1 }] });
    expect(screen.getByText("Unknown model")).toBeTruthy();
  });

  it("shows only the no-cost text when no run has a cost (AC-19)", () => {
    mount({ totalCostUsd: null, byAgent: [], byModel: [] });
    expect(screen.getByText("No cost recorded for this period")).toBeTruthy();
    expect(screen.queryByText("By agent")).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
  });
});
