import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EvalCase, EvalCaseDraft, EvalCaseDraftResponse, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../messages/en/prReview.json";
import evalMessages from "../../../../../messages/en/eval.json";
import common from "../../../../../messages/en/common.json";
import shell from "../../../../../messages/en/shell.json";
import { FindingCard } from "../../FindingCard";
import { EvalCaseAction } from "./EvalCaseAction";

const fetchMock = vi.fn();
let qc: QueryClient;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  qc.clear();
});

const ACCEPTED_AT = "2026-10-12T10:00:00Z";

function finding(o: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded Stripe secret key",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A live key is committed.",
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

const ACCEPTED = finding({ accepted_at: ACCEPTED_AT });
const DISMISSED = finding({ dismissed_at: ACCEPTED_AT });

function evalCase(o: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "c1",
    owner_kind: "agent",
    owner_id: "agent-7",
    name: "must-find-hardcoded-stripe-secret-key-in-com",
    expectation_type: "must_find",
    expected_output: {
      file: "src/config.ts",
      start_line: 11,
      end_line: 11,
      severity: "CRITICAL",
      category: "security",
      title: "Hardcoded Stripe secret key",
    },
    input_diff: "diff",
    input_files: ["src/config.ts"],
    input_meta: { number: 1, title: "t", author: "a", description: "d" },
    source_finding_id: "f1",
    notes: null,
    created_at: ACCEPTED_AT,
    last_result: null,
    ...o,
  } as EvalCase;
}

const DIFF = [
  "--- a/src/config.ts",
  "+++ b/src/config.ts",
  "@@ -10,3 +10,4 @@",
  " ctx ten",
  "+const key = 'sk_live';",
  " ctx twelve",
  " ctx thirteen",
].join("\n");

function draftBody(o: Partial<EvalCaseDraft> = {}): EvalCaseDraft {
  return {
    expectation_type: "must_find",
    name: "must-find-hardcoded-stripe-secret",
    input_diff: DIFF,
    input_meta: { pr_number: 4, pr_title: "Add Stripe", pr_author: "dev", pr_body: "Wire payments" },
    expected_output: {
      file: "src/config.ts",
      start_line: 11,
      end_line: 11,
      severity: "CRITICAL",
      category: "security",
      title: "Hardcoded Stripe secret key",
    },
    problem: null,
    ...o,
  };
}

function draftResponse(o: Partial<EvalCaseDraftResponse> = {}): EvalCaseDraftResponse {
  return { agent: { id: "agent-7", name: "Security Reviewer" }, case: null, draft: draftBody(), ...o };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function renderUi(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages, eval: evalMessages, common, shell }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const button = () => screen.getByRole("button", { name: "Turn into eval case" });

describe("EvalCaseAction", () => {
  it("sits right after the Dismiss control in the card's action row (AC-13)", () => {
    renderUi(<FindingCard f={ACCEPTED} defaultExpanded />);
    const row = screen.getByRole("button", { name: "Dismiss" }).parentElement!;
    const names = Array.from(row.querySelectorAll("button")).map((b) => b.textContent);
    expect(names).toEqual(["Accept", "Dismiss", "Turn into eval case"]);
  });

  it("is absent while the card is collapsed", () => {
    renderUi(<FindingCard f={ACCEPTED} />);
    expect(screen.queryByRole("button", { name: "Turn into eval case" })).toBeNull();
  });

  it("is disabled with the accept-or-dismiss hint when the finding is undecided (AC-14)", () => {
    renderUi(<EvalCaseAction finding={finding()} />);
    expect(button()).toBeDisabled();
    expect(button()).toHaveAttribute("title", "Accept or dismiss the finding first");
    expect(button()).toHaveAccessibleDescription("Accept or dismiss the finding first");
    fireEvent.click(button());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("carries the 'must find' title on an accepted finding and the 'must NOT comment' title on a dismissed one (AC-15)", () => {
    const { unmount } = renderUi(<EvalCaseAction finding={ACCEPTED} />);
    expect(button()).toBeEnabled();
    expect(button()).toHaveAttribute("title", "Create a 'must find' eval case from this finding");
    unmount();
    renderUi(<EvalCaseAction finding={DISMISSED} />);
    expect(button()).toBeEnabled();
    expect(button()).toHaveAttribute(
      "title",
      "Create a 'must NOT comment' eval case from this dismissal",
    );
  });

  it("sends one GET for the draft and no other method (AC-4)", async () => {
    fetchMock.mockResolvedValue(json(draftResponse()));
    renderUi(<EvalCaseAction finding={ACCEPTED} />);
    fireEvent.click(button());
    await screen.findByRole("dialog");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/findings\/f1\/eval-case-draft$/);
    expect((init?.method ?? "GET").toUpperCase()).toBe("GET");
  });

  it("shows a loading status and sends nothing on a second click while the draft loads (AC-5)", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    renderUi(<EvalCaseAction finding={ACCEPTED} />);
    fireEvent.click(button());
    expect(await screen.findByRole("status")).toHaveTextContent("Preparing the eval case…");
    expect(button()).toBeDisabled();
    fireEvent.click(button());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(json(draftResponse()));
    await screen.findByRole("dialog");
  });

  it("opens the dialog through the card with the fields equal to the draft (AC-6)", async () => {
    fetchMock.mockResolvedValue(json(draftResponse()));
    renderUi(<FindingCard f={ACCEPTED} defaultExpanded />);
    fireEvent.click(button());
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue("must-find-hardcoded-stripe-secret");
    expect(within(dialog).getByLabelText(/^Start line/)).toHaveValue(11);
    expect(within(dialog).getByLabelText(/^End line/)).toHaveValue(11);
    expect(within(dialog).getByLabelText(/^Finding title/)).toHaveValue("Hardcoded Stripe secret key");
    expect(within(dialog).getByLabelText(/^Diff/)).toHaveValue(DIFF);
    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });

  it("shows the API's message and opens no dialog when the draft is refused (AC-8)", async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: "eval_owner_missing", message: "The finding's agent no longer exists." } }, 400),
    );
    renderUi(<EvalCaseAction finding={ACCEPTED} />);
    fireEvent.click(button());
    expect(await screen.findByRole("alert")).toHaveTextContent("The finding's agent no longer exists.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button()).toBeEnabled();
  });

  it("opens an existing case for editing with its title and stored values (AC-9)", async () => {
    fetchMock.mockResolvedValue(json(draftResponse({ case: evalCase({ input_diff: DIFF }), draft: null })));
    renderUi(<EvalCaseAction finding={ACCEPTED} />);
    fireEvent.click(button());
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Eval case · must-find-hardcoded-stripe-secret-key-in-com/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue("must-find-hardcoded-stripe-secret-key-in-com");
    expect(within(dialog).getByLabelText(/^Start line/)).toHaveValue(11);
  });

  it("confirms a saved case with its expectation type and a link to the Evals tab (AC-32)", async () => {
    fetchMock.mockResolvedValueOnce(json(draftResponse()));
    renderUi(<EvalCaseAction finding={ACCEPTED} />);
    fireEvent.click(button());
    const dialog = await screen.findByRole("dialog");
    fetchMock.mockResolvedValue(json(evalCase(), 201));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Run after saving" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Created a 'must find' eval case.");
    expect(screen.getByRole("link", { name: "Open the Evals tab" })).toHaveAttribute(
      "href",
      "/agents/agent-7?tab=evals",
    );
  });

  it("says the finding already has a case on a 200, with the link and no try request (AC-33)", async () => {
    fetchMock.mockResolvedValueOnce(json(draftResponse()));
    renderUi(<EvalCaseAction finding={DISMISSED} />);
    fireEvent.click(button());
    const dialog = await screen.findByRole("dialog");
    fetchMock.mockResolvedValue(json(evalCase({ expectation_type: "must_not_flag" }), 200));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("This finding already has an eval case.");
    expect(screen.getByRole("link", { name: "Open the Evals tab" })).toHaveAttribute(
      "href",
      "/agents/agent-7?tab=evals",
    );
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/try"))).toBe(false);
  });

  it("returns focus to the control after the dialog closes (NFR-11)", async () => {
    fetchMock.mockResolvedValue(json(draftResponse()));
    renderUi(<EvalCaseAction finding={ACCEPTED} />);
    fireEvent.click(button());
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(button()).toHaveFocus());
  });
});
