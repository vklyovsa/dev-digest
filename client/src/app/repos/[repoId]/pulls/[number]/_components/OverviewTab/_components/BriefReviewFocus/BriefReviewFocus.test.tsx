import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import type { ReviewFocusItem } from "@devdigest/shared";
import { markCatalog, unmarkedStrings } from "@/test/catalog-probe";
import brief from "../../../../../../../../../../messages/en/brief.json";
import { BriefReviewFocus } from "./BriefReviewFocus";

afterEach(cleanup);

const ITEMS: ReviewFocusItem[] = [
  { file: "src/config.ts", line: 12, reason: "A live key is committed in plaintext." },
  { file: "src/api/public/webhooks.ts", line: 61, reason: "The callback URL receives the account token." },
  { file: "src/middleware/ratelimit.ts", line: 52, reason: "The 429 branch omits Retry-After." },
];

const hrefFor = (file: string, line: number) => `/in-app?file=${encodeURIComponent(file)}&line=${line}`;

function renderFocus(items: ReviewFocusItem[], messages: AbstractIntlMessages = { brief }, onFollow = vi.fn()) {
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BriefReviewFocus items={items} hrefFor={hrefFor} onFollow={onFollow} />
    </NextIntlClientProvider>,
  );
  return { ...view, onFollow };
}

describe("BriefReviewFocus", () => {
  it("shows each item as file:line followed by its reason, in the order of the list (AC-18)", () => {
    renderFocus(ITEMS);

    expect(screen.getByText("Review focus")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    ITEMS.forEach((item, i) => {
      expect(within(rows[i]!).getByRole("link")).toHaveTextContent(`${item.file}:${item.line}`);
      expect(within(rows[i]!).getByText(item.reason)).toBeInTheDocument();
    });
  });

  it("links each item to the diff target of its file and line (AC-25)", () => {
    renderFocus(ITEMS);

    expect(screen.getByRole("link", { name: "src/config.ts:12" })).toHaveAttribute(
      "href",
      hrefFor("src/config.ts", 12),
    );
    expect(screen.getByRole("link", { name: "src/middleware/ratelimit.ts:52" })).toHaveAttribute(
      "href",
      hrefFor("src/middleware/ratelimit.ts", 52),
    );
  });

  it("passes the event and the href of a followed item to onFollow (AC-25)", () => {
    const { onFollow } = renderFocus(ITEMS);

    fireEvent.click(screen.getByRole("link", { name: "src/config.ts:12" }));

    expect(onFollow).toHaveBeenCalledTimes(1);
    expect(onFollow.mock.calls[0]![1]).toBe(hrefFor("src/config.ts", 12));
  });

  it("shows the empty text when there is no item (AC-19)", () => {
    renderFocus([]);

    expect(screen.getByText("No review focus items.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("keeps an item the model repeated (EC-24)", () => {
    renderFocus([ITEMS[0]!, ITEMS[0]!]);

    expect(screen.getAllByRole("link", { name: "src/config.ts:12" })).toHaveLength(2);
  });

  it("renders model text as plain text (NFR-6)", () => {
    const hostile: ReviewFocusItem = {
      file: "src/<b>x</b>.ts",
      line: 3,
      reason: "<script>alert(1)</script> [link](https://evil.example)",
    };
    const { container } = renderFocus([hostile]);

    expect(screen.getByText("<script>alert(1)</script> [link](https://evil.example)")).toBeInTheDocument();
    expect(container.querySelector("script, b")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});

describe("BriefReviewFocus — every visible string comes from the catalog (NFR-10)", () => {
  const DATA = ITEMS.flatMap((i) => [i.file, i.reason]);

  it("the empty list", () => {
    const { container } = renderFocus([], markCatalog({ brief }));

    expect(unmarkedStrings(container, DATA)).toEqual([]);
  });

  it("a list of three", () => {
    const { container } = renderFocus(ITEMS, markCatalog({ brief }));

    expect(container.textContent).toContain("src/config.ts:12");
    expect(unmarkedStrings(container, DATA)).toEqual([]);
  });
});
