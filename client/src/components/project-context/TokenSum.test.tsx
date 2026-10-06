import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import context from "../../../messages/en/context.json";
import { TokenSum } from "./TokenSum";
import { CONTEXT_TOKEN_BUDGET } from "./constants";

afterEach(cleanup);

const WARNING = "over the 8,000-token budget";

function renderSum(tokens: number) {
  render(
    <NextIntlClientProvider locale="en" messages={{ context }}>
      <TokenSum tokens={tokens} />
    </NextIntlClientProvider>,
  );
}

describe("TokenSum", () => {
  it("shows the sum without a warning while it is inside the budget", () => {
    renderSum(CONTEXT_TOKEN_BUDGET);

    expect(screen.getByText("≈ 8,000 tokens")).toBeInTheDocument();
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  it("warns in a status region once the sum passes the budget", () => {
    renderSum(CONTEXT_TOKEN_BUDGET + 1);

    expect(screen.getByText("≈ 8,001 tokens")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(WARNING);
  });
});
