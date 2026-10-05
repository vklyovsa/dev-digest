import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import type { FindingRecord, PrFile, PrReviewComment, ReviewRecord, SmartDiff } from "@devdigest/shared";
import { markCatalog, unmarkedStrings } from "@/test/catalog-probe";
import brief from "../../../../../../../../messages/en/brief.json";
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";

const mutate = vi.fn();
let reviews: ReviewRecord[] | undefined;
let comments: PrReviewComment[];
let smartDiff: SmartDiff;
let smartDiffFailed = false;

vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: reviews }),
  usePrComments: () => ({ data: comments }),
  useCreatePrComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useFindingAction: () => ({ mutate, isPending: false, variables: undefined }),
}));

vi.mock("@/lib/hooks/smart-diff", () => ({
  useSmartDiff: () => ({
    data: smartDiffFailed ? undefined : smartDiff,
    isLoading: false,
    isError: smartDiffFailed,
  }),
}));

import { DiffTab } from "./DiffTab";

const CONFIG_PATCH =
  '@@ -10,4 +10,5 @@\n export const config = {\n   port: 3000,\n+  stripeKey: "sk_live",\n   redis: 1,\n };';
const API_PATCH = "@@ -1,2 +1,3 @@\n const a = 1;\n+const b = 2;\n const c = 3;";

const file = (path: string, patch: string | null = null, additions = 1): PrFile => ({
  path,
  additions,
  deletions: 0,
  patch,
});

// GitHub order, deliberately different from the smart order.
const FILES: PrFile[] = [
  file("pnpm-lock.yaml", null, 40),
  file("README.md"),
  file("src/config.ts", CONFIG_PATCH),
  file("src/api.test.ts"),
  file("src/index.ts"),
  file("src/api.ts", API_PATCH),
];

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    review_id: "rv1",
    severity: "CRITICAL",
    category: "security",
    title: o.id,
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "A live key is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

const sf = (path: string, finding_lines: number[] = []) => ({ path, additions: 1, deletions: 0, finding_lines });

const SMART: SmartDiff = {
  groups: [
    { role: "core", files: [sf("src/config.ts", [12, 999]), sf("src/api.ts")] },
    { role: "tests", files: [sf("src/api.test.ts")] },
    { role: "wiring", files: [sf("src/index.ts")] },
    { role: "docs", files: [sf("README.md")] },
    { role: "boilerplate", files: [sf("pnpm-lock.yaml")] },
  ],
  split_suggestion: { too_big: false, total_lines: 45, proposed_splits: [] },
};

const REVIEW = {
  id: "rv1",
  agent_id: "a1",
  kind: "review",
  created_at: "2026-06-01T10:00:00Z",
  findings: [
    finding({ id: "Hardcoded secret" }),
    finding({ id: "Stray finding", severity: "WARNING", start_line: 999, end_line: 999, rationale: "Gone from the patch." }),
  ],
} as ReviewRecord;

const COMMENT: PrReviewComment = {
  id: 1,
  path: "src/api.ts",
  line: 2,
  original_line: 2,
  side: "RIGHT",
  body: "Please rename this",
  user: "marisa",
  created_at: "2026-06-01T09:00:00Z",
  html_url: "https://github.com/acme/x/pull/1#r1",
  in_reply_to_id: null,
  is_outdated: false,
};

const DOCS_PATCH = "@@ -1,2 +1,3 @@\n # Title\n+Docs line one\n text";
const BIG_README = file("README.md", DOCS_PATCH, 250);
const FILES_WITH_BIG_README = FILES.map((f) => (f.path === "README.md" ? BIG_README : f));

type Target = { file: string | null; line: string | null };

function renderTab(
  opts: { target?: Target; files?: PrFile[]; catalog?: AbstractIntlMessages } = {},
) {
  const { target, files = FILES, catalog = { prReview, shell, brief } } = opts;
  return render(
    <NextIntlClientProvider locale="en" messages={catalog}>
      <DiffTab
        prId="pr1"
        files={files}
        canComment
        repoFullName="acme/payments-api"
        headSha="abc1234"
        target={target}
      />
    </NextIntlClientProvider>,
  );
}

const groupHeaders = () =>
  screen.queryAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));

const scrolled: Element[] = [];
const scrollIntoView = vi.fn(function (this: Element) {
  scrolled.push(this);
});

beforeEach(() => {
  mutate.mockReset();
  scrollIntoView.mockClear();
  scrolled.length = 0;
  Element.prototype.scrollIntoView = scrollIntoView;
  reviews = [REVIEW];
  comments = [COMMENT];
  smartDiff = SMART;
  smartDiffFailed = false;
});

afterEach(cleanup);

describe("DiffTab — smart diff", () => {
  it("groups files by role with counts, dots and collapsed docs/boilerplate", () => {
    renderTab();

    const headers = groupHeaders();
    expect(headers.map((h) => h.textContent)).toEqual([
      expect.stringMatching(/^Core logic.*2 files$/),
      expect.stringMatching(/^Tests.*1 files$/),
      expect.stringMatching(/^Wiring.*1 files$/),
      expect.stringMatching(/^Docs.*1 files$/),
      expect.stringMatching(/^Boilerplate.*1 files$/),
    ]);
    expect(headers.map((h) => h.getAttribute("aria-expanded"))).toEqual(["true", "true", "true", "false", "false"]);

    expect(within(headers[0]!).getByLabelText("1 files with findings")).toBeInTheDocument();
    expect(within(headers[1]!).queryByLabelText(/files with findings/)).not.toBeInTheDocument();

    expect(screen.getAllByRole("img", { name: "Has findings" })).toHaveLength(1);
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();
    fireEvent.click(headers[4]!);
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();

    expect(screen.getByText("Reviewer-ordered diff")).toBeInTheDocument();
    expect(screen.getByText(/6 files/)).toBeInTheDocument();
  });

  it("shows the finding under its line and lets the reviewer act on it", () => {
    renderTab();

    expect(screen.getByText("blocker")).toBeInTheDocument();
    const card = document.querySelector<HTMLElement>('[data-finding-id="Hardcoded secret"]')!;
    expect(within(card).getByText("Hardcoded secret")).toBeInTheDocument();
    expect(within(card).getByText("A live key is committed.")).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: /accept/i }));
    expect(mutate).toHaveBeenCalledWith({ findingId: "Hardcoded secret", action: "accept", prId: "pr1" });
    fireEvent.click(within(card).getByRole("button", { name: /dismiss/i }));
    expect(mutate).toHaveBeenCalledWith({ findingId: "Hardcoded secret", action: "dismiss", prId: "pr1" });

    fireEvent.click(within(card).getByText("Hardcoded secret"));
    expect(within(card).queryByText("A live key is committed.")).not.toBeInTheDocument();
  });

  it("labels each in-patch finding by severity and marks its line with a coloured bar", () => {
    reviews = [
      REVIEW,
      {
        id: "rv2",
        agent_id: "a2",
        kind: "review",
        created_at: "2026-06-01T10:05:00Z",
        findings: [
          finding({ id: "Rename this", file: "src/api.ts", severity: "WARNING", start_line: 2, end_line: 2 }),
          finding({ id: "Extract constant", file: "src/api.ts", severity: "SUGGESTION", start_line: 3, end_line: 3 }),
        ],
      } as ReviewRecord,
    ];
    smartDiff = {
      ...SMART,
      groups: SMART.groups.map((g) =>
        g.role === "core"
          ? { ...g, files: [sf("src/config.ts", [12, 999]), sf("src/api.ts", [2, 3])] }
          : g,
      ),
    };
    renderTab();

    const rowOf = (label: string) => screen.getByText(label).parentElement as HTMLElement;
    expect(rowOf("blocker").style.boxShadow).toBe("inset 3px 0 0 var(--crit)");
    expect(rowOf("warning").style.boxShadow).toBe("inset 3px 0 0 var(--warn)");
    expect(rowOf("suggestion").style.boxShadow).toBe("inset 3px 0 0 var(--sugg)");
    expect(screen.getAllByRole("img", { name: "Has findings" })).toHaveLength(2);
  });

  it("lists a finding whose line is not in the patch at the end of its file", () => {
    renderTab();
    expect(screen.getByText("1 findings outside the diff")).toBeInTheDocument();
    expect(screen.getByText("Stray finding")).toBeInTheDocument();
  });

  it("hides cards and GitHub threads with one toggle while dots, counters and line labels stay", () => {
    renderTab();
    expect(screen.getByText("Please rename this")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide comments (3)" }));

    expect(screen.queryByText("Please rename this")).not.toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
    expect(screen.queryByText("Stray finding")).not.toBeInTheDocument();
    expect(screen.getByText("blocker")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Has findings" })).toHaveLength(1);
    expect(screen.getByLabelText("1 files with findings")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show comments (3)" }));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("Please rename this")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide comments (3)" })).toBeInTheDocument();
  });

  it("Original order restores the GitHub file order and Smart order the groups", () => {
    renderTab();
    expect(screen.getByRole("button", { name: "Smart order" })).toHaveStyle({ fontWeight: "600" });
    expect(screen.getByRole("button", { name: "Original order" })).toHaveStyle({ fontWeight: "500" });
    fireEvent.click(screen.getByRole("button", { name: "Original order" }));
    expect(screen.getByRole("button", { name: "Original order" })).toHaveStyle({ fontWeight: "600" });

    expect(groupHeaders()).toHaveLength(0);
    const nodes = FILES.map((f) => screen.getByText(f.path));
    nodes.slice(1).forEach((node, i) => {
      expect(nodes[i]!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    expect(screen.getAllByRole("img", { name: "Has findings" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Smart order" }));
    expect(groupHeaders()).toHaveLength(5);
  });

  it("before any review shows a hint instead of counters", () => {
    reviews = [];
    smartDiff = {
      ...SMART,
      groups: SMART.groups.map((g) => ({ ...g, files: g.files.map((f) => ({ ...f, finding_lines: [] })) })),
    };
    renderTab();

    expect(
      screen.getByText("No review has run yet — run one to see findings in the diff"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/files with findings/)).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Has findings" })).not.toBeInTheDocument();
  });
});

describe("DiffTab — navigation target", () => {
  const docsHeader = () => groupHeaders().find((h) => /^Docs/.test(h.textContent ?? ""))!;
  const marked = () => document.querySelectorAll('[aria-current="true"]');

  it("opens the docs group and a card of more than 200 lines for the target, and scrolls to the card", () => {
    renderTab({ files: FILES_WITH_BIG_README });
    expect(docsHeader()).toHaveAttribute("aria-expanded", "false");
    expect(scrollIntoView).not.toHaveBeenCalled();
    cleanup();

    renderTab({ files: FILES_WITH_BIG_README, target: { file: "README.md", line: null } });

    expect(docsHeader()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Docs line one")).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrolled[0]).toHaveTextContent("README.md");
  });

  it("does the same in the flat list when the grouping failed", () => {
    smartDiffFailed = true;
    renderTab({ files: FILES_WITH_BIG_README });
    expect(groupHeaders()).toHaveLength(0);
    expect(screen.queryByText("Docs line one")).not.toBeInTheDocument();
    cleanup();

    renderTab({ files: FILES_WITH_BIG_README, target: { file: "README.md", line: null } });

    expect(groupHeaders()).toHaveLength(0);
    expect(screen.getByText("Docs line one")).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrolled[0]).toHaveTextContent("README.md");
  });

  it("marks only the target's card as the navigation target", () => {
    renderTab({ target: { file: "src/api.ts", line: null } });

    expect(marked()).toHaveLength(1);
    expect(marked()[0]).toHaveTextContent("src/api.ts");
    expect(marked()[0]).not.toHaveTextContent("src/config.ts");
    expect((marked()[0] as HTMLElement).style.outline).toContain("2px solid");
  });

  it("marks nothing when there is no target", () => {
    renderTab();
    expect(marked()).toHaveLength(0);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("scrolls the rendered line into view and not the file header", () => {
    renderTab({ target: { file: "src/api.ts", line: "2" } });

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrolled[0]).toHaveTextContent("const b = 2;");
    expect(scrolled[0]).not.toHaveTextContent("src/api.ts");
  });

  it("scrolls the card when the line is not rendered in the file's diff", () => {
    renderTab({ target: { file: "src/api.ts", line: "99" } });

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrolled[0]).toHaveTextContent("src/api.ts");
    expect(scrolled[0]).toHaveTextContent("const a = 1;");
    expect(marked()).toHaveLength(1);
  });

  it("lets the reviewer collapse the target card by its header", () => {
    renderTab({ files: FILES_WITH_BIG_README, target: { file: "README.md", line: null } });
    expect(screen.getByText("Docs line one")).toBeInTheDocument();

    fireEvent.click(screen.getByText("README.md"));

    expect(screen.queryByText("Docs line one")).not.toBeInTheDocument();
    expect(docsHeader()).toHaveAttribute("aria-expanded", "true");
  });

  it("shows the catalog notice above the list for a file that is not in the diff, and marks no card", () => {
    const catalog = { prReview, shell, brief: markCatalog(brief) };
    renderTab({ catalog, target: { file: "src/gone.ts", line: "3" } });

    const notice = screen.getByRole("status");
    expect(notice.textContent).toBe(catalog.brief.notInDiff);
    expect(unmarkedStrings(notice, [])).toEqual([]);
    expect(
      notice.compareDocumentPosition(screen.getByText("src/config.ts")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(marked()).toHaveLength(0);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("shows no notice for a file that is in the diff, or when no file was asked for", () => {
    renderTab({ target: { file: "src/api.ts", line: null } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    cleanup();

    renderTab({ target: { file: null, line: null } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(marked()).toHaveLength(0);
  });
});
