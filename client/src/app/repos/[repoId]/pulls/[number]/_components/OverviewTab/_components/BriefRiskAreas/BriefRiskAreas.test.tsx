import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import type { Risk } from "@devdigest/shared";
import { markCatalog, unmarkedStrings } from "@/test/catalog-probe";
import brief from "../../../../../../../../../../messages/en/brief.json";
import { BriefRiskAreas } from "./BriefRiskAreas";
import { RISK_SEVERITY_COLOR } from "./constants";

afterEach(cleanup);

const AUTH: Risk = {
  kind: "security",
  title: "Auth surface touched",
  explanation: "The limiter runs before the session check.",
  severity: "high",
  file_refs: ["src/middleware/ratelimit.ts", "src/api/users & roles.ts"],
};
const DEP: Risk = {
  kind: "dependency",
  title: "New dependency: ioredis",
  explanation: "A new client library enters the lock file.",
  severity: "medium",
  file_refs: ["package.json"],
};
const PERF: Risk = {
  kind: "performance",
  title: "Adds a round-trip per request",
  explanation: "Every request now waits for Redis.",
  severity: "low",
  file_refs: ["src/middleware/ratelimit.ts"],
};

const hrefFor = (file: string) => `/in-app?file=${encodeURIComponent(file)}`;

function renderRisks(risks: Risk[], messages: AbstractIntlMessages = { brief }, onFollow = vi.fn()) {
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BriefRiskAreas risks={risks} hrefFor={hrefFor} onFollow={onFollow} />
    </NextIntlClientProvider>,
  );
  return { ...view, onFollow };
}

const severityIcon = (name: string) => screen.getByRole("img", { name });

describe("BriefRiskAreas — the list", () => {
  it("shows the heading, each risk's title and each path of its file_refs as a link (AC-14, AC-58)", () => {
    renderRisks([AUTH, DEP]);

    expect(screen.getByText("Risk areas")).toBeInTheDocument();
    expect(screen.getByText(AUTH.title)).toBeInTheDocument();
    expect(screen.getByText(DEP.title)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "src/middleware/ratelimit.ts" })).toHaveAttribute(
      "href",
      hrefFor("src/middleware/ratelimit.ts"),
    );
    expect(screen.getByRole("link", { name: "src/api/users & roles.ts" })).toHaveAttribute(
      "href",
      hrefFor("src/api/users & roles.ts"),
    );
    expect(screen.getByRole("link", { name: "package.json" })).toHaveAttribute("href", hrefFor("package.json"));
  });

  it("shows the empty text when there is no risk (AC-16)", () => {
    renderRisks([]);

    expect(screen.getByText("No notable risks flagged.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("passes the event and the href of a followed path to onFollow (AC-58)", () => {
    const { onFollow } = renderRisks([DEP]);

    fireEvent.click(screen.getByRole("link", { name: "package.json" }));

    expect(onFollow).toHaveBeenCalledTimes(1);
    expect(onFollow.mock.calls[0]![1]).toBe(hrefFor("package.json"));
  });
});

describe("BriefRiskAreas — severity", () => {
  it("gives each severity its own colour and a text name (AC-15, NFR-11)", () => {
    renderRisks([AUTH, DEP, PERF]);

    expect(severityIcon("High severity")).toHaveStyle({ color: RISK_SEVERITY_COLOR.high });
    expect(severityIcon("Medium severity")).toHaveStyle({ color: RISK_SEVERITY_COLOR.medium });
    expect(severityIcon("Low severity")).toHaveStyle({ color: RISK_SEVERITY_COLOR.low });
    expect(new Set(Object.values(RISK_SEVERITY_COLOR)).size).toBe(3);
  });

  it("assigns the colours of the design tokens (AC-15)", () => {
    expect(RISK_SEVERITY_COLOR).toEqual({ high: "var(--crit)", medium: "var(--warn)", low: "var(--info)" });
  });

  it("draws the same icon for an unknown kind as for a known one (AC-15)", () => {
    renderRisks([{ ...AUTH, kind: "supply_chain_surprise" }, { ...AUTH, kind: "security" }]);

    const [first, second] = screen.getAllByRole("img", { name: "High severity" });
    expect(first!.innerHTML).toBe(second!.innerHTML);
    expect(screen.getByText("supply_chain_surprise")).toBeInTheDocument();
  });
});

describe("BriefRiskAreas — the explanation", () => {
  it("expands and collapses a risk's explanation from a button named after its title (AC-57, NFR-11)", () => {
    renderRisks([AUTH, DEP]);

    const expand = screen.getByRole("button", { name: `Show explanation: ${AUTH.title}` });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(AUTH.explanation)).not.toBeInTheDocument();

    fireEvent.click(expand);

    const collapse = screen.getByRole("button", { name: `Hide explanation: ${AUTH.title}` });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(AUTH.explanation)).toBeInTheDocument();
    expect(screen.queryByText(DEP.explanation)).not.toBeInTheDocument();

    fireEvent.click(collapse);

    expect(screen.queryByText(AUTH.explanation)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Show explanation: ${AUTH.title}` })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("keeps a risk's expanded state with that risk, not with its position, when the list is replaced", () => {
    const { rerender } = renderRisks([AUTH, DEP]);
    fireEvent.click(screen.getByRole("button", { name: `Show explanation: ${AUTH.title}` }));
    fireEvent.click(screen.getByRole("button", { name: `Show explanation: ${DEP.title}` }));

    rerender(
      <NextIntlClientProvider locale="en" messages={{ brief }}>
        <BriefRiskAreas risks={[PERF, DEP]} hrefFor={hrefFor} onFollow={vi.fn()} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("button", { name: `Show explanation: ${PERF.title}` })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText(PERF.explanation)).not.toBeInTheDocument();
    expect(screen.getByText(DEP.explanation)).toBeInTheDocument();
  });

  it("lists every risk as an item and keeps each control inside its own item (NFR-11)", () => {
    renderRisks([AUTH, DEP]);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[1]!).getByRole("button", { name: `Show explanation: ${DEP.title}` })).toBeInTheDocument();
  });
});

describe("BriefRiskAreas — model text stays text (NFR-6)", () => {
  it("renders a script element and a Markdown link as visible text", () => {
    const hostile: Risk = {
      kind: "<b>kind</b>",
      title: "<script>alert(1)</script>",
      explanation: "[click me](https://evil.example/x) and <img src=x onerror=alert(1)>",
      severity: "high",
      file_refs: ["src/a.ts"],
    };
    const { container } = renderRisks([hostile]);

    fireEvent.click(screen.getByRole("button", { name: /Show explanation/ }));

    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(screen.getByText("<b>kind</b>")).toBeInTheDocument();
    expect(
      screen.getByText("[click me](https://evil.example/x) and <img src=x onerror=alert(1)>"),
    ).toBeInTheDocument();
    expect(container.querySelector("script, img, b")).toBeNull();
    expect(screen.queryByRole("link", { name: "click me" })).not.toBeInTheDocument();
  });
});

describe("BriefRiskAreas — every visible string comes from the catalog (NFR-10)", () => {
  const DATA = [
    ...[AUTH, DEP, PERF].flatMap((r) => [r.title, r.kind, r.explanation, ...r.file_refs]),
  ];

  it("the empty list", () => {
    const { container } = renderRisks([], markCatalog({ brief }));

    expect(unmarkedStrings(container, DATA)).toEqual([]);
  });

  it("a list with one expanded risk", () => {
    const { container } = renderRisks([AUTH, DEP, PERF], markCatalog({ brief }));

    fireEvent.click(screen.getByRole("button", { name: /Show explanation: .*Auth surface touched/ }));

    expect(container.textContent).toContain(AUTH.explanation);
    expect(unmarkedStrings(container, DATA)).toEqual([]);
  });
});
