/**
 * RunCostBadge — the formatter IS the feature. "no cost recorded" and "this run
 * genuinely cost nothing" are different facts and must not render alike: the
 * first is an em dash, the second is $0.00. Everything else is decimal scaling.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/common.json";
import { RunCostBadge, type RunCostBadgeProps } from "./RunCostBadge";
import { formatUsd, totalTokens } from "./helpers";

afterEach(cleanup);

function renderBadge(props: RunCostBadgeProps) {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={{ common: messages }}>
      <RunCostBadge {...props} />
    </NextIntlClientProvider>,
  );
  return container.textContent ?? "";
}

describe("formatUsd", () => {
  it("renders an em dash for a missing cost, never $0.00", () => {
    expect(formatUsd(null)).toBe("—");
    expect(formatUsd(undefined)).toBe("—");
  });

  it("renders a real zero as $0.00 — a free model costs nothing, that is data", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("scales decimals with magnitude so cheap runs stay readable", () => {
    expect(formatUsd(0.0013)).toBe("$0.0013");
    expect(formatUsd(0.012)).toBe("$0.012");
    expect(formatUsd(1.2367)).toBe("$1.24");
  });
});

describe("totalTokens", () => {
  it("sums both directions, and stays null when the run reported neither", () => {
    expect(totalTokens(8200, 919)).toBe(9119);
    expect(totalTokens(null, null)).toBeNull();
    expect(totalTokens(100, null)).toBe(100);
  });
});

describe("RunCostBadge", () => {
  it("compact: just the cost", () => {
    expect(renderBadge({ costUsd: 0.012 })).toBe("$0.012");
  });

  it("compact: an unpriced run reads as an em dash", () => {
    expect(renderBadge({ costUsd: null })).toBe("—");
  });

  it("detailed: grouped token count next to the cost", () => {
    expect(renderBadge({ costUsd: 0.0013, tokensIn: 8200, tokensOut: 919, variant: "detailed" })).toBe(
      "9,119 tok · $0.0013",
    );
  });

  it("detailed: a done run with tokens but no price still shows the tokens", () => {
    expect(renderBadge({ costUsd: null, tokensIn: 8200, tokensOut: 919, variant: "detailed" })).toBe(
      "9,119 tok · —",
    );
  });
});
