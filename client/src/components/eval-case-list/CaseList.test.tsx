import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase } from "@devdigest/shared";
import evalMessages from "../../../messages/en/eval.json";
import common from "../../../messages/en/common.json";
import { CaseList } from "./CaseList";
import { EVAL_NO_HOST_HINT_ID } from "@/components/eval-runs";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function makeCase(over: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "c1",
    owner_kind: "agent",
    owner_id: "a1",
    name: "must-find-leaked-key",
    expectation_type: "must_find",
    expected_output: {
      file: "src/config.ts",
      start_line: 4,
      end_line: 6,
      severity: "critical",
      category: "security",
      title: "Leaked key",
    },
    input_diff: "",
    input_files: ["src/config.ts"],
    input_meta: { pr_number: 1, pr_title: "t", pr_author: "a", pr_body: null },
    source_finding_id: "f1",
    notes: null,
    revision: 1,
    created_at: "2026-10-12T10:00:00Z",
    last_result: null,
    ...over,
  };
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function renderList(cases: EvalCase[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common }}>
        <CaseList cases={cases} agentId="a1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const row = (name: string) => screen.getByText(name).closest("li")!;

describe("CaseList — rows (AC-22)", () => {
  it("shows name, expectation in words, file with range, severity and category", () => {
    renderList([
      makeCase(),
      makeCase({
        id: "c2",
        name: "no-clean-rename",
        expectation_type: "must_not_flag",
        expected_output: {
          file: "src/util.ts",
          start_line: 10,
          end_line: 12,
          severity: "warning",
          category: "bug",
          title: "x",
        },
      }),
    ]);

    const first = within(row("must-find-leaked-key"));
    expect(first.getByText(evalMessages.evalsTab.expectation.mustFind)).toBeInTheDocument();
    expect(first.getByText("src/config.ts:4–6")).toBeInTheDocument();
    expect(first.getByText("critical")).toBeInTheDocument();
    expect(first.getByText(/security/)).toBeInTheDocument();

    const second = within(row("no-clean-rename"));
    expect(second.getByText(evalMessages.evalsTab.expectation.mustNotFlag)).toBeInTheDocument();
    expect(second.getByText("src/util.ts:10–12")).toBeInTheDocument();
  });

  it("renders the control and the actions slot passed to it", () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common }}>
          <CaseList cases={[makeCase()]} agentId="a1" control={<button>run it</button>} actions={<button>new one</button>} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: "run it" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "new one" })).toBeInTheDocument();
  });
});

describe("CaseList — edit (AC-27)", () => {
  it("gives every row a button named for its case, beside Delete", () => {
    const onEdit = vi.fn();
    const first = makeCase();
    const second = makeCase({ id: "c2", name: "no-clean-rename" });
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common }}>
          <CaseList cases={[first, second]} agentId="a1" onEdit={onEdit} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    const edit = screen.getByRole("button", { name: "Edit must-find-leaked-key" });
    expect(screen.getByRole("button", { name: "Edit no-clean-rename" })).toBeInTheDocument();
    expect(edit.parentElement).toBe(screen.getByRole("button", { name: "Delete must-find-leaked-key" }).parentElement);
    expect(within(row("no-clean-rename")).getByRole("button", { name: "Edit no-clean-rename" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit no-clean-rename" }));
    expect(onEdit).toHaveBeenCalledWith(second);
  });
});

describe("CaseList — last result (AC-23)", () => {
  it("never run", () => {
    renderList([makeCase()]);
    expect(within(row("must-find-leaked-key")).getByText("never run")).toBeInTheDocument();
  });

  it("passed, with expected 1 and got 1 for a must_find case", () => {
    renderList([makeCase({ last_result: { run_id: "r1", status: "pass", matched: 1, error: null } })]);
    const r = within(row("must-find-leaked-key"));
    expect(r.getByText("passed")).toBeInTheDocument();
    expect(r.getByText("expected 1, got 1")).toBeInTheDocument();
  });

  it("failed, with expected 0 and got 2 for a must_not_flag case", () => {
    renderList([
      makeCase({
        expectation_type: "must_not_flag",
        last_result: { run_id: "r1", status: "fail", matched: 2, error: null },
      }),
    ]);
    const r = within(row("must-find-leaked-key"));
    expect(r.getByText("failed")).toBeInTheDocument();
    expect(r.getByText("expected 0, got 2")).toBeInTheDocument();
  });

  it("errored, with the reason", () => {
    renderList([makeCase({ last_result: { run_id: "r1", status: "error", matched: 0, error: "provider timeout" } })]);
    expect(within(row("must-find-leaked-key")).getByText("errored: provider timeout")).toBeInTheDocument();
  });
});

describe("CaseList — delete (AC-28)", () => {
  it("sends nothing before the confirmation and one DELETE after it", async () => {
    renderList([makeCase()]);
    fireEvent.click(screen.getByRole("button", { name: "Delete must-find-leaked-key" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/must-find-leaked-key/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe("/eval-cases/c1");
    expect(init?.method).toBe("DELETE");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("sends nothing when the dialog is cancelled", () => {
    renderList([makeCase()]);
    fireEvent.click(screen.getByRole("button", { name: "Delete must-find-leaked-key" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and says why when the API refuses", async () => {
    fetchMock.mockImplementation(async () => json({ error: { code: "not_found", message: "Eval case not found" } }, 404));
    renderList([makeCase()]);
    fireEvent.click(screen.getByRole("button", { name: "Delete must-find-leaked-key" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("Eval case not found");
  });
});

describe("CaseList — untrusted text (NFR-5)", () => {
  it("renders a case name that looks like markup as text", () => {
    const name = "<img src=x onerror=alert(1)>";
    const { container } = renderList([makeCase({ name })]);
    expect(screen.getByText(name)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("CaseList — empty set (AC-25)", () => {
  it("says so and shows no passing badge", () => {
    renderList([]);
    expect(screen.getByText(evalMessages.evalsTab.emptyCases)).toBeInTheDocument();
    expect(screen.queryByText(/passing/)).not.toBeInTheDocument();
  });
});

describe("CaseList — run a case (AC-66…71)", () => {
  const tryResult = {
    status: "pass",
    matched: 1,
    findings: [],
    error: null,
    duration_ms: 1200,
    cost_usd: 0.001,
  };
  const stored = makeCase({
    input_diff: "diff --git a/src/config.ts b/src/config.ts",
    input_meta: { pr_number: 7, pr_title: "Add config", pr_author: "ann", pr_body: "body" },
  });
  const runButton = (name = "must-find-leaked-key") => screen.getByRole("button", { name: `Run ${name}` });

  it("sends the stored case as the try body and nothing else (AC-66, AC-67)", async () => {
    fetchMock.mockImplementation(async () => json(tryResult));
    renderList([stored]);
    fireEvent.click(runButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe("/agents/a1/eval-cases/try");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      expectation_type: "must_find",
      input_diff: stored.input_diff,
      input_meta: { pr_number: 7, pr_title: "Add config", pr_author: "ann", pr_body: "body" },
      expected_output: { file: "src/config.ts", start_line: 4, end_line: 6 },
    });
    expect(await screen.findByText(evalMessages.evalsTab.trial)).toBeInTheDocument();
  });

  it("disables only the row that is running (AC-68)", async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    renderList([stored, makeCase({ id: "c2", name: "other" })]);
    fireEvent.click(runButton());
    await waitFor(() => expect(runButton()).toBeDisabled());
    expect(within(row("must-find-leaked-key")).getByText(evalMessages.evalsTab.running)).toBeInTheDocument();
    expect(runButton("other")).toBeEnabled();
  });

  it("keeps the stored result beside the trial result (AC-69, AC-71)", async () => {
    fetchMock.mockImplementation(async () => json(tryResult));
    renderList([stored]);
    fireEvent.click(runButton());
    await screen.findByText(evalMessages.evalsTab.trial);
    const r = within(row("must-find-leaked-key"));
    expect(r.getByText("never run")).toBeInTheDocument();
    expect(r.getByRole("status")).toBeInTheDocument();
  });

  it("drops the trial result when the list is re-read (AC-70)", async () => {
    fetchMock.mockImplementation(async () => json(tryResult));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (stamp: number) => (
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common }}>
          <CaseList cases={[stored]} agentId="a1" listStamp={stamp} />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(ui(1));
    fireEvent.click(runButton());
    await screen.findByText(evalMessages.evalsTab.trial);
    rerender(ui(2));
    expect(screen.queryByText(evalMessages.evalsTab.trial)).not.toBeInTheDocument();
  });

  it("is a native button with a title and a polite live region (AC-60, NFR-11)", async () => {
    fetchMock.mockImplementation(async () => json(tryResult));
    renderList([stored]);
    const button = runButton();
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("title", evalMessages.evalsTab.runCaseTitle);
    fireEvent.click(button);
    expect(await screen.findByRole("status")).toHaveAttribute("aria-live", "polite");
  });
});

describe("CaseList — a skill as owner", () => {
  const host = { id: "ag1", name: "Host" };
  const skill = { id: "s1", name: "Sk", host };
  const skillCase = (over: Partial<EvalCase> = {}) => makeCase({ owner_kind: "skill", owner_id: "s1", ...over });
  const tryOk = { status: "pass", matched: 1, findings: [], error: null, duration_ms: 1, cost_usd: 0.001 };

  function renderSkill(cases: EvalCase[], target: typeof skill | { id: string; name: string; host: null } = skill) {
    const onEdit = () => {};
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common }}>
          <p id={EVAL_NO_HOST_HINT_ID}>hint</p>
          <CaseList cases={cases} skill={target} onEdit={onEdit} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  }

  it("shows one row per result state, each with three named buttons (AC-42)", () => {
    renderSkill([
      skillCase({ id: "c1", name: "n-never" }),
      skillCase({ id: "c2", name: "n-pass", last_result: { status: "pass", matched: 1, error: null } as EvalCase["last_result"] }),
      skillCase({ id: "c3", name: "n-fail", last_result: { status: "fail", matched: 0, error: null } as EvalCase["last_result"] }),
      skillCase({ id: "c4", name: "n-err", last_result: { status: "error", matched: 0, error: "boom" } as EvalCase["last_result"] }),
    ]);
    for (const n of ["n-never", "n-pass", "n-fail", "n-err"]) {
      const r = within(row(n));
      expect(r.getByRole("button", { name: `Run ${n}` })).toBeInTheDocument();
      expect(r.getByRole("button", { name: `Edit ${n}` })).toBeInTheDocument();
      expect(r.getByRole("button", { name: `Delete ${n}` })).toBeInTheDocument();
    }
    expect(screen.getByText(/errored: boom/)).toBeInTheDocument();
  });

  it("posts one try with the case plus the host id and no other write (AC-56)", async () => {
    fetchMock.mockImplementation(async () => json(tryOk));
    renderSkill([skillCase()]);
    fireEvent.click(screen.getByRole("button", { name: "Run must-find-leaked-key" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe("/skills/s1/eval-cases/try");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      expectation_type: "must_find",
      input_diff: "",
      input_meta: { pr_number: 1, pr_title: "t", pr_author: "a", pr_body: null },
      expected_output: { file: "src/config.ts", start_line: 4, end_line: 6 },
      host_agent_id: "ag1",
    });
  });

  it("pends one row, labels a trial beside a never-run result, and shows a 400 on the row (AC-57)", async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      return path.includes("/eval-cases/try") ? json(tryOk) : json({}, 200);
    });
    renderSkill([skillCase(), skillCase({ id: "c2", name: "other" })]);
    fireEvent.click(screen.getByRole("button", { name: "Run must-find-leaked-key" }));
    const r = within(row("must-find-leaked-key"));
    expect(await r.findByText(evalMessages.evalsTab.trial)).toBeInTheDocument();
    expect(r.getByText("never run")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run other" })).toBeEnabled();

    fetchMock.mockImplementation(async () => json({ error: { code: "bad_request", message: "Host agent is gone" } }, 400));
    fireEvent.click(screen.getByRole("button", { name: "Run other" }));
    expect(await within(row("other")).findByText(/Host agent is gone/)).toBeInTheDocument();
  });

  it("deletes through /eval-cases/:id and drops no other call (AC-58)", async () => {
    renderSkill([skillCase()]);
    fireEvent.click(screen.getByRole("button", { name: "Delete must-find-leaked-key" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe("/eval-cases/c1");
    expect(init?.method).toBe("DELETE");
  });

  it("with no host disables and describes the run buttons, leaving edit and delete enabled (AC-47)", () => {
    const onEdit = vi.fn();
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common }}>
          <p id={EVAL_NO_HOST_HINT_ID}>hint</p>
          <CaseList cases={[skillCase()]} skill={{ id: "s1", name: "Sk", host: null }} onEdit={onEdit} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    const run = screen.getByRole("button", { name: "Run must-find-leaked-key" });
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute("aria-describedby", EVAL_NO_HOST_HINT_ID);
    expect(screen.getByRole("button", { name: "Edit must-find-leaked-key" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Delete must-find-leaked-key" })).toBeEnabled();
  });

  it("renders a markup-looking case name as text (NFR-7)", () => {
    const name = "<img src=x onerror=alert(1)>";
    const { container } = renderSkill([skillCase({ name })]);
    expect(screen.getByText(name)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});
