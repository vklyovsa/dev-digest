import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase, EvalCaseDraft } from "@devdigest/shared";
import evalMessages from "../../../messages/en/eval.json";
import common from "../../../messages/en/common.json";
import shell from "../../../messages/en/shell.json";
import { CaseEditorDialog } from "./CaseEditorDialog";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const ONE_FILE = [
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -10,3 +10,5 @@",
  " ctx ten",
  " ctx eleven",
  "+added twelve",
  "+added thirteen",
  " ctx fourteen",
].join("\n");

const TWO_FILES = `${ONE_FILE}\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1,1 +1,2 @@\n kept\n+extra`;

function makeCase(over: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "c1",
    owner_kind: "agent",
    owner_id: "a1",
    name: "stripe-key-leak",
    expectation_type: "must_find",
    expected_output: {
      file: "src/a.ts",
      start_line: 12,
      end_line: 13,
      severity: "CRITICAL",
      category: "security",
      title: "Hardcoded key",
    },
    input_diff: ONE_FILE,
    input_files: ["src/a.ts"],
    input_meta: { pr_number: 7, pr_title: "Add Stripe", pr_author: "dev", pr_body: "Wire payments" },
    source_finding_id: null,
    notes: null,
    revision: 2,
    created_at: "2026-10-12T10:00:00Z",
    last_result: null,
    ...over,
  };
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function renderDialog(
  evalCase: EvalCase | null = null,
  onClose = vi.fn(),
  extra: { source?: { findingId: string; draft: EvalCaseDraft }; onSaved?: (s: { case: EvalCase; created: boolean }) => void } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common, shell }}>
        <CaseEditorDialog agent={{ id: "a1", name: "Security Reviewer" }} evalCase={evalCase} onClose={onClose} {...extra} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return onClose;
}

const field = (re: RegExp) => screen.getByLabelText(re) as HTMLInputElement;
const save = () => screen.getByRole("button", { name: /^(save|saving)/i });
const change = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const runOnSaveBox = () => screen.getByRole("checkbox", { name: "Run after saving" });
const skipRunOnSave = () => fireEvent.click(runOnSaveBox());

function fillValid(diff = ONE_FILE) {
  change(field(/^Name/), "leak");
  change(field(/^Diff/), diff);
  change(field(/^Start line/), "12");
  change(field(/^End line/), "13");
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => json(makeCase(), 200));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CaseEditorDialog — open", () => {
  it("opens a new case empty with must find selected and names the agent", () => {
    renderDialog();

    expect(screen.getByText("New eval case")).toBeInTheDocument();
    expect(screen.getByText(/Security Reviewer/)).toBeInTheDocument();
    expect(field(/^Name/).value).toBe("");
    expect(field(/^Diff/).value).toBe("");
    expect(screen.getByRole("radio", { name: "must find" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "must NOT flag" })).not.toBeChecked();
  });

  it("opens an existing case with every field holding its value", () => {
    renderDialog(makeCase());

    expect(screen.getByText("Eval case · stripe-key-leak")).toBeInTheDocument();
    expect(field(/^Name/).value).toBe("stripe-key-leak");
    expect(field(/^Diff/).value).toBe(ONE_FILE);
    expect(field(/^File/).value).toBe("src/a.ts");
    expect(field(/^Start line/).value).toBe("12");
    expect(field(/^End line/).value).toBe("13");
    expect(field(/^Finding title/).value).toBe("Hardcoded key");
    expect(field(/^Severity/).value).toBe("CRITICAL");
    expect(field(/^Category/).value).toBe("security");
    fireEvent.click(screen.getByRole("button", { name: "PR meta" }));
    expect(field(/^Title/).value).toBe("Add Stripe");
    expect(field(/^Body/).value).toBe("Wire payments");
  });

  it("offers a stored severity outside the list as one extra option", () => {
    renderDialog(makeCase({ expected_output: { ...makeCase().expected_output, severity: "critical" } }));

    expect(field(/^Severity/).value).toBe("critical");
  });

  it("has the two tabs, the required fields and no JSON text", () => {
    renderDialog();

    expect(screen.getByRole("button", { name: "Diff" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PR meta" })).toBeInTheDocument();
    expect(screen.queryByText(/json/i)).not.toBeInTheDocument();
    expect(screen.getByText("Expected output")).toBeInTheDocument();
  });

  it("shows the type as text, not a control, when editing", () => {
    renderDialog(makeCase({ expectation_type: "must_not_flag" }));

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByText("must NOT flag")).toBeInTheDocument();
  });

  it("sends no request on open or while typing", () => {
    renderDialog();
    fillValid();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("moves focus into the dialog and returns it to the opener on close", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = (() => {
      const client = new QueryClient();
      return render(
        <QueryClientProvider client={client}>
          <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common, shell }}>
            <CaseEditorDialog agent={{ id: "a1", name: "A" }} evalCase={null} onClose={vi.fn()} />
          </NextIntlClientProvider>
        </QueryClientProvider>,
      );
    })();

    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe("CaseEditorDialog — preview", () => {
  it("renders the pasted diff as a file card with line numbers", () => {
    renderDialog();
    change(field(/^Diff/), ONE_FILE);

    expect(screen.getAllByText("src/a.ts").some((el) => el.tagName === "SPAN")).toBe(true);
    const row = screen.getByText("added twelve").closest("div[style]")!;
    expect(row.textContent).toContain("12");
  });

  it("says a prose text is not a diff and renders no file card", () => {
    renderDialog();
    change(field(/^Diff/), "just some words");

    expect(screen.getByText(/not a unified diff/)).toBeInTheDocument();
    expect(screen.queryAllByText("src/a.ts")).toHaveLength(0);
  });

  it("marks the lines of the chosen range and moves the marker with the end line", () => {
    const { container } = (renderDialog(makeCase()), { container: document.body });
    expect(container.querySelectorAll('[data-in-range="true"]')).toHaveLength(2);
    expect(screen.getByText("added twelve").closest('[data-in-range="true"]')).not.toBeNull();
    expect(screen.getByText("ctx eleven").closest('[data-in-range="true"]')).toBeNull();

    change(field(/^End line/), "12");
    expect(container.querySelectorAll('[data-in-range="true"]')).toHaveLength(1);
    expect(screen.getAllByRole("img", { name: "Expected lines 12–12" })).toHaveLength(1);
  });

  it("offers the two files with none chosen, and selects the file of a one-file text", () => {
    renderDialog();
    change(field(/^Diff/), TWO_FILES);

    const select = field(/^File/);
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Choose a file of the diff",
      "src/a.ts",
      "src/b.ts",
    ]);
    expect(select.value).toBe("");

    change(field(/^Diff/), ONE_FILE);
    expect(field(/^File/).value).toBe("src/a.ts");
  });

  it("clears the file choice when the chosen path leaves a two-file text, and disables Save", () => {
    renderDialog();
    fillValid(TWO_FILES);
    change(field(/^File/), "src/a.ts");
    expect(save()).toBeEnabled();

    change(field(/^Diff/), TWO_FILES.replace("+++ b/src/a.ts", "+++ b/src/renamed.ts"));
    expect(field(/^File/).value).toBe("");
    expect(save()).toBeDisabled();
  });
});

describe("CaseEditorDialog — save", () => {
  it("disables Save for each incomplete state and enables it for a complete form", () => {
    renderDialog();
    expect(save()).toBeDisabled();
    change(field(/^Name/), "leak");
    expect(save()).toBeDisabled();
    change(field(/^Diff/), ONE_FILE);
    expect(save()).toBeDisabled();
    change(field(/^Start line/), "0");
    change(field(/^End line/), "3");
    expect(save()).toBeDisabled();
    change(field(/^Start line/), "12");
    change(field(/^End line/), "11");
    expect(save()).toBeDisabled();
    change(field(/^End line/), "13");
    expect(save()).toBeEnabled();
    change(field(/^Name/), " ");
    expect(save()).toBeDisabled();
  });

  it("sends one POST with the form's values and closes", async () => {
    const onClose = renderDialog();
    fillValid();
    fireEvent.click(screen.getByRole("radio", { name: "must NOT flag" }));
    change(field(/^Severity/), "WARNING");
    skipRunOnSave();
    fireEvent.click(save());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/agents\/a1\/eval-cases$/);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "leak",
      expectation_type: "must_not_flag",
      input_diff: ONE_FILE,
      input_meta: { pr_title: "", pr_body: null },
      expected_output: {
        file: "src/a.ts",
        start_line: 12,
        end_line: 13,
        title: "",
        severity: "WARNING",
        category: "",
      },
    });
  });

  it("sends one PUT for an existing case, keeping an untouched null body", async () => {
    const onClose = renderDialog(makeCase({ input_meta: { pr_number: 7, pr_title: "T", pr_author: "d", pr_body: null } }));
    change(field(/^Name/), "renamed");
    skipRunOnSave();
    fireEvent.click(save());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/eval-cases\/c1$/);
    expect(init?.method).toBe("PUT");
    const body = JSON.parse(String(init?.body));
    expect(body.name).toBe("renamed");
    expect(body.input_meta).toEqual({ pr_title: "T", pr_body: null });
    expect(body).not.toHaveProperty("expectation_type");
  });

  it("shows Saving… and sends no second request on a second click", async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    renderDialog();
    fillValid();
    fireEvent.click(save());

    await waitFor(() => expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stays open with every value kept and shows the API's message on a failure", async () => {
    fetchMock.mockImplementation(async () =>
      json({ error: { code: "expectation_outside_diff", message: "Lines 12-13 are outside the diff." } }, 400),
    );
    const onClose = renderDialog();
    fillValid();
    fireEvent.click(save());

    expect(await screen.findByRole("alert")).toHaveTextContent("Lines 12-13 are outside the diff.");
    expect(onClose).not.toHaveBeenCalled();
    expect(field(/^Diff/).value).toBe(ONE_FILE);
    expect(field(/^Name/).value).toBe("leak");
  });
});

describe("CaseEditorDialog — last run", () => {
  it.each([
    [{ run_id: "r", status: "pass", matched: 1, error: null }, "Last run passed", "expected 1, got 1"],
    [{ run_id: "r", status: "fail", matched: 0, error: null }, "Last run failed", "expected 1, got 0"],
  ] as const)("shows %j", (last, head, got) => {
    renderDialog(makeCase({ last_result: last }));

    const banner = screen.getByRole("status");
    expect(within(banner).getByText(head)).toBeInTheDocument();
    expect(within(banner).getByText(got)).toBeInTheDocument();
  });

  it("shows the error of an errored result", () => {
    renderDialog(makeCase({ last_result: { run_id: "r", status: "error", matched: 0, error: "model timed out" } }));

    expect(screen.getByRole("status")).toHaveTextContent("errored: model timed out");
  });

  it("shows no line without a last result", () => {
    renderDialog(makeCase());

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("CaseEditorDialog — closing", () => {
  it("closes at once when nothing changed, by Cancel and by Escape", () => {
    const onClose = renderDialog(makeCase());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Discard changes?")).not.toBeInTheDocument();
  });

  it("asks before discarding a changed form, and keeps editing on Keep editing", () => {
    const onClose = renderDialog(makeCase());
    change(field(/^Name/), "changed");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Discard changes?")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByText("Discard changes?")).not.toBeInTheDocument();
    expect(field(/^Name/).value).toBe("changed");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks on Escape for a changed form, and the confirm's Escape does not close the editor", () => {
    const onClose = renderDialog(makeCase());
    change(field(/^Name/), "changed");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByText("Discard changes?")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("Discard changes?")).not.toBeInTheDocument();
  });
});

describe("CaseEditorDialog — untrusted text", () => {
  it("renders a name and a diff line holding markup as text", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const diff = `--- a/x.ts\n+++ b/x.ts\n@@ -1,1 +1,2 @@\n kept\n+${evil}`;
    const { container } = (renderDialog(makeCase({ name: evil, input_diff: diff })), { container: document.body });

    expect(container.querySelector("img[src='x']")).toBeNull();
    expect(screen.getByText(`Eval case · ${evil}`)).toBeInTheDocument();
    expect(screen.getByText(evil)).toBeInTheDocument();
  });
});

const DRAFT: EvalCaseDraft = {
  expectation_type: "must_not_flag",
  name: "from-finding",
  input_diff: ONE_FILE,
  input_meta: { pr_number: 7, pr_title: "Add Stripe", pr_author: "dev", pr_body: null },
  expected_output: { file: "src/a.ts", start_line: 12, end_line: 13, severity: "WARNING", category: "bug", title: "Odd" },
  problem: null,
};

const TRY_OK = { status: "pass", matched: 1, findings: [], error: null, duration_ms: 1800, cost_usd: 0.02 };
const runCase = () => screen.getByRole("button", { name: /^(run case|running)/i });
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST" || init?.method === "PUT");

function mockTry(body: unknown = TRY_OK, status = 200) {
  fetchMock.mockImplementation(async (url) =>
    String(url).endsWith("/eval-cases/try") ? json(body, status) : json(makeCase(), 200),
  );
}

describe("CaseEditorDialog — from a finding", () => {
  it("opens with the draft, the type as text and the title New eval case", () => {
    renderDialog(null, vi.fn(), { source: { findingId: "f1", draft: DRAFT } });

    expect(screen.getByText("New eval case")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByText("must NOT flag")).toBeInTheDocument();
    expect(field(/^Name/).value).toBe("from-finding");
    expect(field(/^Start line/).value).toBe("12");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each([
    ["file_not_in_diff", "holds no patch for the finding's file"],
    ["lines_outside_diff", "lie outside the changed lines"],
  ] as const)("shows the %s problem as a status above the diff", (problem, text) => {
    renderDialog(null, vi.fn(), { source: { findingId: "f1", draft: { ...DRAFT, problem } } });

    expect(screen.getByRole("status")).toHaveTextContent(text);
  });

  it("opens file_not_in_diff with an empty diff field and Save and Run case disabled", () => {
    renderDialog(null, vi.fn(), {
      source: { findingId: "f1", draft: { ...DRAFT, input_diff: "", problem: "file_not_in_diff" } },
    });

    expect(screen.getByRole("status")).toHaveTextContent("holds no patch for the finding's file");
    expect(field(/^Diff/).value).toBe("");
    expect(save()).toBeDisabled();
    expect(runCase()).toBeDisabled();
  });

  it("closes without a prompt when nothing was edited", () => {
    const onClose = renderDialog(null, vi.fn(), { source: { findingId: "f1", draft: DRAFT } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("saves through the finding route, reports the result and closes", async () => {
    fetchMock.mockImplementation(async () => json(makeCase(), 201));
    const onSaved = vi.fn();
    const onClose = renderDialog(null, vi.fn(), { source: { findingId: "f1", draft: DRAFT }, onSaved });
    change(field(/^Name/), "renamed");
    skipRunOnSave();
    fireEvent.click(save());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/findings\/f1\/eval-case$/);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body)).name).toBe("renamed");
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ created: true }));
  });

  it("shows the API's message and stays open when the save fails", async () => {
    fetchMock.mockImplementation(async () => json({ error: { code: "bad", message: "Cannot save." } }, 400));
    const onClose = renderDialog(null, vi.fn(), { source: { findingId: "f1", draft: DRAFT } });
    fireEvent.click(save());

    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot save.");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("CaseEditorDialog — Run case", () => {
  it("is offered in all three modes, disabled until the form can be saved, with a title", () => {
    renderDialog();
    expect(runCase()).toBeDisabled();
    expect(runCase()).toHaveAttribute("title", "Makes one model call");
    fillValid();
    expect(runCase()).toBeEnabled();
    cleanup();

    renderDialog(makeCase());
    expect(runCase()).toBeEnabled();
    cleanup();

    renderDialog(null, vi.fn(), { source: { findingId: "f1", draft: DRAFT } });
    expect(runCase()).toBeEnabled();
  });

  it("sends nothing on open or typing, and one try body on click that holds only file and lines", async () => {
    mockTry();
    renderDialog();
    fillValid();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(runCase());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/agents\/a1\/eval-cases\/try$/);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      expectation_type: "must_find",
      input_diff: ONE_FILE,
      input_meta: { pr_number: null, pr_author: null, pr_title: "", pr_body: null },
      expected_output: { file: "src/a.ts", start_line: 12, end_line: 13 },
    });
  });

  it("shows the result in a live region while the fields stay editable, and saves nothing", async () => {
    mockTry();
    renderDialog(makeCase());
    fireEvent.click(runCase());

    const region = await screen.findByRole("status", { name: "Result of the run" });
    expect(region).toHaveTextContent("Passed");
    expect(region).toHaveTextContent("expected 1, got 1");
    expect(region).toHaveTextContent("1.8s");
    expect(posts().every(([u]) => String(u).endsWith("/try"))).toBe(true);
    expect(field(/^Name/)).toBeEnabled();
    expect(within(screen.getByRole("status", { name: "Result of the run" })).queryByText(/earlier content/)).toBeNull();
  });

  it("shows Running… and sends no second request while pending", async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    renderDialog(makeCase());
    fireEvent.click(runCase());

    await waitFor(() => expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Running…" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("marks the result stale after a body edit but not after a rename", async () => {
    mockTry();
    renderDialog(makeCase());
    fireEvent.click(runCase());
    await screen.findByText("Passed");

    change(field(/^Name/), "renamed");
    expect(screen.queryByText(/earlier content/)).not.toBeInTheDocument();

    change(field(/^End line/), "12");
    expect(screen.getByText(/earlier content/)).toBeInTheDocument();
    change(field(/^End line/), "13");
    expect(screen.queryByText(/earlier content/)).not.toBeInTheDocument();
  });

  it("renders an errored result and keeps the Last run banner", async () => {
    mockTry({ ...TRY_OK, status: "error", matched: 0, error: "model timed out" });
    renderDialog(makeCase({ last_result: { run_id: "r", status: "pass", matched: 1, error: null } }));
    fireEvent.click(runCase());

    expect(await screen.findByRole("alert")).toHaveTextContent("errored: model timed out");
    expect(screen.getByText("Last run passed")).toBeInTheDocument();
  });

  it.each([
    [400, "The diff holds no patch."],
    [429, "Too many runs, wait."],
  ])("shows the API message of a %i", async (status, message) => {
    mockTry({ error: { code: "x", message } }, status);
    renderDialog(makeCase());
    fireEvent.click(runCase());

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("replaces a shown fail with the later pass", async () => {
    fetchMock.mockImplementationOnce(async () => json({ ...TRY_OK, status: "fail", matched: 0 }));
    fetchMock.mockImplementationOnce(async () => json(TRY_OK));
    renderDialog(makeCase());

    fireEvent.click(runCase());
    const region = await screen.findByRole("status", { name: "Result of the run" });
    await waitFor(() => expect(region).toHaveTextContent("Failed"));
    expect(region).toHaveTextContent("expected 1, got 0");

    fireEvent.click(runCase());
    await waitFor(() => expect(screen.getByRole("status", { name: "Result of the run" })).toHaveTextContent("Passed"));
    const shown = screen.getByRole("status", { name: "Result of the run" });
    expect(shown).not.toHaveTextContent("Failed");
    expect(shown).not.toHaveTextContent("expected 1, got 0");
    expect(shown).toHaveTextContent("expected 1, got 1");
    expect(screen.getAllByRole("status", { name: "Result of the run" })).toHaveLength(1);
  });

  it("discards a try answered after the dialog was closed", async () => {
    let answer!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { answer = resolve; }));
    function Host() {
      const [open, setOpen] = React.useState(true);
      return open ? (
        <CaseEditorDialog agent={{ id: "a1", name: "Security Reviewer" }} evalCase={makeCase()} onClose={() => setOpen(false)} />
      ) : null;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common, shell }}>
          <Host />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(runCase());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    answer(json(TRY_OK));
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(posts().filter(([u]) => !String(u).endsWith("/try"))).toHaveLength(0);
  });

  it("discards edits plus a run on Cancel without any save request", async () => {
    mockTry();
    const onClose = renderDialog(makeCase());
    change(field(/^Name/), "changed");
    fireEvent.click(runCase());
    await screen.findByText("Passed");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(posts().filter(([u]) => !String(u).endsWith("/try"))).toHaveLength(0);
  });

  it("renders markup from a result and a draft name as text", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    mockTry({ ...TRY_OK, status: "fail", matched: 0, findings: [{ file: "a.ts", start_line: 1, end_line: 1, severity: "WARNING", category: "bug", title: evil }] });
    renderDialog(null, vi.fn(), { source: { findingId: "f1", draft: { ...DRAFT, name: evil } } });
    fireEvent.click(runCase());

    expect(await screen.findByText(evil, { selector: "span" })).toBeInTheDocument();
    expect(document.body.querySelector("img[src='x']")).toBeNull();
  });
});

describe("CaseEditorDialog — run on save", () => {
  const savedCase = () => makeCase({ id: "c9", name: "leak" });
  const mockSave = (saveStatus = 201) => {
    fetchMock.mockImplementation(async (url) =>
      String(url).endsWith("/eval-cases/try") ? json(TRY_OK) : json(savedCase(), saveStatus),
    );
  };
  const tries = () => fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/eval-cases/try"));
  const sources = {
    new: () => renderDialog(),
    edit: () => renderDialog(makeCase()),
    finding: () => renderDialog(null, vi.fn(), { source: { findingId: "f1", draft: DRAFT } }),
  };

  it.each(Object.keys(sources) as Array<keyof typeof sources>)("is checked by default in %s mode", (mode) => {
    sources[mode]();
    expect(runOnSaveBox()).toBeChecked();
  });

  it.each(Object.keys(sources) as Array<keyof typeof sources>)(
    "sends exactly one try after a save in %s mode and stays open",
    async (mode) => {
      mockSave();
      const onClose = sources[mode]();
      if (mode === "new") fillValid();
      change(field(/^Name/), "leak");
      fireEvent.click(save());

      expect(await screen.findByRole("status", { name: "Result of the run" })).toHaveTextContent("Passed");
      expect(tries()).toHaveLength(1);
      expect(onClose).not.toHaveBeenCalled();
    },
  );

  it("sends a second Save as a PUT to the stored id", async () => {
    mockSave();
    renderDialog();
    fillValid();
    fireEvent.click(save());
    await screen.findByRole("status", { name: "Result of the run" });
    expect(screen.getByText("Eval case · leak")).toBeInTheDocument();

    change(field(/^Name/), "again");
    fireEvent.click(save());
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, i]) => i?.method === "PUT")).toHaveLength(1));
    const [url] = fetchMock.mock.calls.find(([, i]) => i?.method === "PUT")!;
    expect(String(url)).toMatch(/\/eval-cases\/c9$/);
  });

  it("closes without a try when unchecked", async () => {
    mockSave();
    const onClose = renderDialog();
    fillValid();
    skipRunOnSave();
    fireEvent.click(save());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(tries()).toHaveLength(0);
  });

  it("sends no try when the save fails", async () => {
    fetchMock.mockImplementation(async () => json({ error: { code: "bad", message: "Cannot save." } }, 400));
    renderDialog();
    fillValid();
    fireEvent.click(save());

    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot save.");
    expect(tries()).toHaveLength(0);
  });

  it("keeps the saved case in edit mode and shows the error when the try fails", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).endsWith("/eval-cases/try")
        ? json({ error: { code: "x", message: "Try broke." } }, 500)
        : json(savedCase(), 201),
    );
    const onClose = renderDialog();
    fillValid();
    fireEvent.click(save());

    expect(await screen.findByRole("alert")).toHaveTextContent("Try broke.");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Eval case · leak")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("reports, closes and sends no try when a finding save answers 200", async () => {
    mockSave(200);
    const onSaved = vi.fn();
    const onClose = renderDialog(null, vi.fn(), { source: { findingId: "f1", draft: DRAFT }, onSaved });
    fireEvent.click(save());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ created: false }));
    expect(tries()).toHaveLength(0);
  });
});

const SKILL = { id: "s1", name: "Stripe Rules", host: { id: "h1", name: "Host Agent" } };

function renderSkillDialog(evalCase: EvalCase | null = null, host: typeof SKILL.host | null = SKILL.host) {
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common, shell }}>
        <CaseEditorDialog skill={{ ...SKILL, host }} evalCase={evalCase} onClose={onClose} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return onClose;
}

const skillCase = (over: Partial<EvalCase> = {}) => makeCase({ owner_kind: "skill", owner_id: "s1", ...over });
const urls = () => fetchMock.mock.calls.map(([u]) => String(u));

describe("CaseEditorDialog — skill owner", () => {
  it("opens new empty, names the skill and its host, with an editable type", () => {
    renderSkillDialog();

    expect(screen.getByText("New eval case")).toBeInTheDocument();
    expect(screen.getByText(/Stripe Rules · host agent Host Agent/)).toBeInTheDocument();
    expect(field(/^Name/).value).toBe("");
    expect(field(/^Diff/).value).toBe("");
    expect(screen.getByRole("radio", { name: "must find" })).toBeChecked();
  });

  it("opens an existing case with its stored values and Last run failed", () => {
    renderSkillDialog(skillCase({ last_result: { run_id: "r", status: "fail", matched: 0, error: null } }));

    expect(field(/^Name/).value).toBe("stripe-key-leak");
    expect(field(/^Diff/).value).toBe(ONE_FILE);
    expect(field(/^Start line/).value).toBe("12");
    expect(within(screen.getByRole("status")).getByText("Last run failed")).toBeInTheDocument();
  });

  it("saves a new case to the skill's route and an edit to /eval-cases/<id>, never an agent route", async () => {
    mockTry();
    renderSkillDialog();
    fillValid();
    skipRunOnSave();
    fireEvent.click(save());
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(urls()[0]).toMatch(/\/skills\/s1\/eval-cases$/);
    cleanup();
    fetchMock.mockClear();

    renderSkillDialog(skillCase());
    change(field(/^Name/), "renamed");
    skipRunOnSave();
    fireEvent.click(save());
    await waitFor(() => expect(posts()).toHaveLength(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/eval-cases\/c1$/);
    expect(init?.method).toBe("PUT");
    expect(urls().some((u) => /\/agents\//.test(u))).toBe(false);
  });

  it("sends one try with an edit made after opening and the host id, and saves nothing", async () => {
    mockTry();
    renderSkillDialog(skillCase());
    change(field(/^End line/), "12");
    fireEvent.click(runCase());

    await screen.findByRole("status", { name: "Result of the run" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/skills\/s1\/eval-cases\/try$/);
    const body = JSON.parse(String(init?.body));
    expect(body.host_agent_id).toBe("h1");
    expect(body.expected_output.end_line).toBe(12);
    expect(posts().every(([u]) => String(u).endsWith("/try"))).toBe(true);
  });

  it("sends no request on open or typing", () => {
    renderSkillDialog();
    fillValid();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with no host disables Run case with a description, and a save closes without a try", async () => {
    mockTry();
    const onClose = renderSkillDialog(null, null);
    fillValid();

    expect(screen.getByText(/Stripe Rules · simulate a PR/)).toBeInTheDocument();
    expect(runCase()).toBeDisabled();
    const hint = document.getElementById(runCase().getAttribute("aria-describedby")!);
    expect(hint).toHaveTextContent("A skill is evaluated through a host agent. Create an agent first.");

    fireEvent.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(urls().some((u) => u.endsWith("/try"))).toBe(false);
  });

  it("stays open and runs after a save, with a try on the skill route", async () => {
    mockTry();
    const onClose = renderSkillDialog();
    fillValid();
    fireEvent.click(save());

    expect(await screen.findByRole("status", { name: "Result of the run" })).toHaveTextContent("Passed");
    expect(onClose).not.toHaveBeenCalled();
    expect(urls().filter((u) => u.endsWith("/skills/s1/eval-cases/try"))).toHaveLength(1);
  });

  it("asks before discarding a changed form and shows the API message of a failed save", async () => {
    fetchMock.mockImplementation(async () => json({ error: { code: "bad", message: "Cannot save." } }, 400));
    const onClose = renderSkillDialog(skillCase());
    change(field(/^Name/), "changed");
    fireEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot save.");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Discard changes?")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("marks a result stale after a body edit", async () => {
    mockTry();
    renderSkillDialog(skillCase());
    fireEvent.click(runCase());
    await screen.findByText("Passed");

    change(field(/^End line/), "12");
    expect(screen.getByText(/earlier content/)).toBeInTheDocument();
  });

  it("renders markup in a try's finding title as text", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    mockTry({ ...TRY_OK, status: "fail", matched: 0, findings: [{ file: "a.ts", start_line: 1, end_line: 1, severity: "WARNING", category: "bug", title: evil }] });
    renderSkillDialog(skillCase());
    fireEvent.click(runCase());

    expect(await screen.findByText(evil, { selector: "span" })).toBeInTheDocument();
    expect(document.body.querySelector("img[src='x']")).toBeNull();
  });
});
