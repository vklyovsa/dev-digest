import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCompareSide, EvalRunCompare, EvalSkillCompareSide, EvalSkillRunCompare } from "@devdigest/shared";
import evalMessages from "../../../../../../messages/en/eval.json";
import commonMessages from "../../../../../../messages/en/common.json";
import { createQueryClient } from "@/lib/providers";
import { CompareRunsDialog } from "./CompareRunsDialog";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function side(over: Partial<EvalCompareSide> = {}): EvalCompareSide {
  return {
    run_id: "r1",
    agent_version: 6,
    system_prompt: "You are a reviewer.\nReturn at most 5 findings.",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    skills: ["repo-conventions"],
    started_at: "2026-05-27T16:40:00Z",
    recall: 0.78,
    precision: 0.93,
    citation_accuracy: 0.94,
    cost_usd: 0.21,
    cases_total: 20,
    cases_passed: 16,
    ...over,
  };
}

function compare(base: Partial<EvalCompareSide> = {}, head: Partial<EvalCompareSide> = {}, rest: Partial<EvalRunCompare> = {}): EvalRunCompare {
  return {
    base: side(base),
    head: side({
      run_id: "r2",
      agent_version: 7,
      started_at: "2026-05-29T09:14:00Z",
      recall: 0.82,
      precision: 0.91,
      citation_accuracy: 0.95,
      cost_usd: 0.23,
      cases_passed: 17,
      ...head,
    }),
    cases_only_in_base: [],
    cases_only_in_head: [],
    cases_edited: [],
    ...rest,
  };
}

const fetchMock = vi.fn();
let qc: QueryClient;

function mount(onClose = vi.fn()) {
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common: commonMessages }}>
        <CompareRunsDialog agentId="a1" baseId="r1" headId="r2" onClose={onClose} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return onClose;
}

const cardOf = (label: string) => screen.getByText(label).closest("li")!;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  qc = createQueryClient();
  qc.setDefaultOptions({ queries: { retry: false } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  qc.clear();
});

describe("CompareRunsDialog", () => {
  it("names the two versions, older first", async () => {
    fetchMock.mockResolvedValue(json(compare()));
    mount();
    expect(await screen.findByText("Compare runs · v6 → v7")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/agents\/a1\/eval-runs\/compare\?base=r1&head=r2$/);
  });

  it("names versions 7 and 8 too", async () => {
    fetchMock.mockResolvedValue(json(compare({ agent_version: 7 }, { agent_version: 8 })));
    mount();
    expect(await screen.findByText("Compare runs · v7 → v8")).toBeInTheDocument();
  });

  it("shows older value, newer value and the difference with its direction", async () => {
    fetchMock.mockResolvedValue(json(compare()));
    mount();
    await screen.findByText("Compare runs · v6 → v7");

    const recall = within(cardOf("Recall"));
    expect(recall.getByText("78%")).toBeInTheDocument();
    expect(recall.getByText("82%")).toBeInTheDocument();
    expect(recall.getByText("4pt")).toBeInTheDocument();
    expect(recall.getByRole("img", { name: "up" })).toBeInTheDocument();

    const precision = within(cardOf("Precision"));
    expect(precision.getByText("2pt")).toBeInTheDocument();
    expect(precision.getByRole("img", { name: "down" })).toBeInTheDocument();

    const cost = within(cardOf("Cost"));
    expect(cost.getByText("$0.210")).toBeInTheDocument();
    expect(cost.getByText("$0.230")).toBeInTheDocument();
    expect(cost.getByText("$0.020")).toBeInTheDocument();
    expect(cost.getByRole("img", { name: "up" })).toBeInTheDocument();
  });

  it("lays the comparison out as four cards, each naming its metric and its two sides", async () => {
    fetchMock.mockResolvedValue(json(compare()));
    mount();
    await screen.findByText("Compare runs · v6 → v7");

    const cards = screen.getAllByRole("listitem");
    expect(cards.map((c) => c.firstElementChild!.textContent)).toEqual(["Recall", "Precision", "Citation", "Cost"]);
    expect(cardOf("Citation")).toHaveTextContent(/Older\s*94%.*Newer\s*95%.*Difference.*1pt/);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a dash for a metric a run does not have", async () => {
    fetchMock.mockResolvedValue(json(compare({ recall: null })));
    mount();
    await screen.findByText("Compare runs · v6 → v7");
    const recall = within(cardOf("Recall"));
    expect(recall.getAllByText("—")).toHaveLength(2);
    expect(recall.queryByRole("img")).toBeNull();
  });

  it("marks an added prompt line with a sign and a label, not by colour alone", async () => {
    fetchMock.mockResolvedValue(
      json(compare({}, { system_prompt: "You are a reviewer.\nReturn at most 5 findings.\nFlag unused imports." })),
    );
    mount();

    const line = (await screen.findByText("Flag unused imports.")).closest("div")!;
    expect(within(line).getByText("added")).toBeInTheDocument();
    expect(line).toHaveTextContent("+");
    expect(screen.queryByText("removed")).toBeNull();
  });

  it("marks a removed prompt line", async () => {
    fetchMock.mockResolvedValue(json(compare({}, { system_prompt: "You are a reviewer." })));
    mount();

    const line = (await screen.findByText("Return at most 5 findings.")).closest("div")!;
    expect(within(line).getByText("removed")).toBeInTheDocument();
    expect(line).toHaveTextContent("−");
  });

  it("says the prompt did not change when the two are identical", async () => {
    fetchMock.mockResolvedValue(json(compare()));
    mount();
    expect(await screen.findByText("The prompt did not change between these runs.")).toBeInTheDocument();
    expect(screen.queryByText("added")).toBeNull();
  });

  it("names the cases left out of one run", async () => {
    fetchMock.mockResolvedValue(json(compare({}, {}, { cases_only_in_head: ["must-find-new-case"] })));
    mount();
    expect(await screen.findByText(/different cases/)).toBeInTheDocument();
    expect(screen.getByText("Only in v7: must-find-new-case")).toBeInTheDocument();
    expect(screen.queryByText(/Only in v6/)).toBeNull();
  });

  it("names the cases edited between the runs, with no different-cases line when none was left out of one run", async () => {
    fetchMock.mockResolvedValue(json(compare({}, {}, { cases_edited: ["must-find-leaked-key"] })));
    mount();
    expect(
      await screen.findByText(
        "This case was edited between the two runs and is left out of the values: must-find-leaked-key",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/different cases/)).toBeNull();
  });

  it("lists a different model above the prompt and leaves equal settings out", async () => {
    fetchMock.mockResolvedValue(json(compare({}, { model: "anthropic/claude-haiku-5.5" })));
    mount();

    const item = (await screen.findByText("Model")).closest("li")!;
    expect(item).toHaveTextContent("deepseek/deepseek-v4-flash → anthropic/claude-haiku-5.5");
    expect(screen.queryByText("Provider")).toBeNull();
    expect(screen.queryByText("Skills")).toBeNull();
  });

  it("lists changed skills", async () => {
    fetchMock.mockResolvedValue(json(compare({}, { skills: [] })));
    mount();
    expect((await screen.findByText("Skills")).closest("li")).toHaveTextContent("repo-conventions → —");
  });

  it("shows prompt text as text, never as markup", async () => {
    const prompt = "<img src=x onerror=alert(1)>";
    fetchMock.mockResolvedValue(json(compare({}, { system_prompt: prompt })));
    mount();

    expect(await screen.findByText(prompt)).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("offers Close", async () => {
    fetchMock.mockResolvedValue(json(compare()));
    const onClose = mount();
    await screen.findByText("Compare runs · v6 → v7");

    const closers = screen.getAllByRole("button", { name: "Close" });
    fireEvent.click(closers.at(-1)!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps Tab inside the dialog", async () => {
    fetchMock.mockResolvedValue(json(compare()));
    mount();
    await screen.findByText("Compare runs · v6 → v7");
    const closers = screen.getAllByRole("button", { name: "Close" });
    const first = closers[0]!;
    const last = closers.at(-1)!;

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();

    document.body.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();
  });

  it("shows the API message when the read fails", async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: "eval_runs_not_comparable", message: "These runs cannot be compared." } }, 400),
    );
    mount();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not compare these runs.");
    expect(alert).toHaveTextContent("These runs cannot be compared.");
  });

  it("closes on Escape and returns focus to the control that opened it", async () => {
    fetchMock.mockResolvedValue(json(compare()));
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <QueryClientProvider client={qc}>
          <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common: commonMessages }}>
            <button onClick={() => setOpen(true)}>Open compare</button>
            {open && <CompareRunsDialog agentId="a1" baseId="r1" headId="r2" onClose={() => setOpen(false)} />}
          </NextIntlClientProvider>
        </QueryClientProvider>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open compare" });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByText("Compare runs · v6 → v7");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(opener).toHaveFocus();
  });

  describe("promote", () => {
    const snapshot = {
      agent_id: "a1",
      version: 7,
      config: {
        provider: "openrouter",
        model: "deepseek/deepseek-v4-flash",
        system_prompt: "Promoted prompt.",
        output_schema: { type: "object" },
        strategy: "single",
        ci_fail_on: "critical",
        repo_intel: true,
        skills: ["s1"],
      },
      created_at: "2026-05-29T09:14:00Z",
    };

    function routes(opts: { agentVersion: number; putVersion?: number; snapshotStatus?: number }) {
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.includes("/eval-runs/compare")) return json(compare());
        if (url.includes("/versions/7")) {
          return opts.snapshotStatus && opts.snapshotStatus !== 200
            ? json({ error: { code: "not_found", message: "Agent version not found" } }, opts.snapshotStatus)
            : json(snapshot);
        }
        if (method === "PUT") return json({ id: "a1", version: opts.putVersion ?? opts.agentVersion });
        return json({ id: "a1", version: opts.agentVersion });
      });
    }

    const writes = () => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "PUT");

    it("offers Promote v7 when the agent is on another version", async () => {
      routes({ agentVersion: 8 });
      mount();
      expect(await screen.findByRole("button", { name: "Promote v7" })).toBeEnabled();
    });

    it("disables the control, with the reason as its description, when the agent is already on that version", async () => {
      routes({ agentVersion: 7 });
      mount();
      const button = await screen.findByRole("button", { name: "Promote v7" });
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription("v7 is already the agent's current configuration.");
    });

    it("asks first and sends nothing until confirmed", async () => {
      routes({ agentVersion: 8 });
      mount();
      fireEvent.click(await screen.findByRole("button", { name: "Promote v7" }));

      expect(await screen.findByText("Promote v7?")).toBeInTheDocument();
      expect(screen.getByText(/moves from v8 to the configuration of v7/)).toBeInTheDocument();
      expect(writes()).toHaveLength(0);

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByText("Promote v7?")).toBeNull());
      expect(writes()).toHaveLength(0);
    });

    it("sends the seven snapshot values and no skills request, then reports the new version", async () => {
      routes({ agentVersion: 8, putVersion: 9 });
      mount();
      fireEvent.click(await screen.findByRole("button", { name: "Promote v7" }));
      fireEvent.click(await screen.findByRole("button", { name: "Promote" }));

      expect(await screen.findByText("Promoted: the agent is now at v9.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Promote v7" })).toBeNull();
      const [put] = writes();
      expect(String(put![0])).toMatch(/\/agents\/a1$/);
      expect(JSON.parse(String((put![1] as RequestInit).body))).toEqual({
        provider: "openrouter",
        model: "deepseek/deepseek-v4-flash",
        system_prompt: "Promoted prompt.",
        strategy: "single",
        output_schema: { type: "object" },
        ci_fail_on: "critical",
        repo_intel: true,
      });
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/skills"))).toBe(false);
    });

    it("says nothing changed when the answer keeps the current version", async () => {
      routes({ agentVersion: 8, putVersion: 8 });
      mount();
      fireEvent.click(await screen.findByRole("button", { name: "Promote v7" }));
      fireEvent.click(await screen.findByRole("button", { name: "Promote" }));

      expect(
        await screen.findByText("Nothing changed: the agent already had this configuration (v8)."),
      ).toBeInTheDocument();
    });

    it("shows the API message and keeps the control enabled when the snapshot read fails", async () => {
      routes({ agentVersion: 8, snapshotStatus: 404 });
      mount();
      fireEvent.click(await screen.findByRole("button", { name: "Promote v7" }));
      fireEvent.click(await screen.findByRole("button", { name: "Promote" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Agent version not found");
      expect(screen.getByRole("button", { name: "Promote v7" })).toBeEnabled();
      expect(writes()).toHaveLength(0);
    });

    it("keeps Tab inside the dialog with the promote control in it", async () => {
      routes({ agentVersion: 8 });
      mount();
      const promoteButton = await screen.findByRole("button", { name: "Promote v7" });
      const last = screen.getAllByRole("button", { name: "Close" }).at(-1)!;

      promoteButton.focus();
      fireEvent.keyDown(document, { key: "Tab" });
      expect(document.activeElement).toBe(promoteButton);

      last.focus();
      fireEvent.keyDown(document, { key: "Tab" });
      expect(screen.getAllByRole("button", { name: "Close" })[0]).toHaveFocus();
    });

    it("returns focus to the promote control when the confirmation is cancelled", async () => {
      routes({ agentVersion: 8 });
      mount();
      const promoteButton = await screen.findByRole("button", { name: "Promote v7" });
      promoteButton.focus();
      fireEvent.click(promoteButton);
      await screen.findByText("Promote v7?");

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByText("Promote v7?")).toBeNull());
      expect(promoteButton).toHaveFocus();
    });
  });
});

function skillSide(over: Partial<EvalSkillCompareSide> = {}): EvalSkillCompareSide {
  return {
    run_id: "r1",
    skill_version: 3,
    skill_body: "Check imports.\nCheck names.",
    agent_id: "h1",
    agent_version: 2,
    provider: "openrouter",
    model: "m1",
    started_at: "2026-10-10T10:00:00Z",
    recall: 0.5,
    precision: 0.6,
    citation_accuracy: 0.7,
    cost_usd: 0.01,
    cases_total: 4,
    cases_passed: 2,
    ...over,
  };
}

function skillCompare(
  base: Partial<EvalSkillCompareSide> = {},
  head: Partial<EvalSkillCompareSide> = {},
  rest: Partial<EvalSkillRunCompare> = {},
): EvalSkillRunCompare {
  return {
    base: skillSide(base),
    head: skillSide({ run_id: "r2", skill_version: 4, skill_body: "Check imports.\nCheck names.\nCheck tests.", recall: 0.75, ...head }),
    cases_only_in_base: [],
    cases_only_in_head: [],
    cases_edited: [],
    ...rest,
  };
}

function mountSkill(onClose = vi.fn()) {
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common: commonMessages }}>
        <CompareRunsDialog
          skillId="s1"
          hostNames={new Map([["h1", "Security Reviewer"], ["h2", "Style Reviewer"]])}
          baseId="r1"
          headId="r2"
          onClose={onClose}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return onClose;
}

describe("CompareRunsDialog of a skill", () => {
  it("names the skill versions and lays out four cards with the added body line labelled", async () => {
    fetchMock.mockResolvedValue(json(skillCompare()));
    mountSkill();

    expect(await screen.findByText("Compare runs · skill v3 → v4")).toBeInTheDocument();
    expect(screen.getByText("Skill body")).toBeInTheDocument();
    const cards = screen.getAllByRole("listitem").filter((c) => ["Recall", "Precision", "Citation", "Cost"].includes(c.firstElementChild!.textContent ?? ""));
    expect(cards).toHaveLength(4);
    expect(cardOf("Recall")).toHaveTextContent(/Older\s*50%.*Newer\s*75%.*Difference.*25pt/);
    const line = screen.getByText("Check tests.").closest("div")!;
    expect(within(line).getByText("added")).toBeInTheDocument();
    expect(line).toHaveTextContent("+");
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/skills\/s1\/eval-runs\/compare\?base=r1&head=r2$/);
  });

  it("says the body is the same when both runs used one skill version", async () => {
    fetchMock.mockResolvedValue(json(skillCompare({ skill_version: 2 }, { skill_version: 2, skill_body: "changed" })));
    mountSkill();

    expect(await screen.findByText("Both runs used the same skill body.")).toBeInTheDocument();
    expect(screen.queryByText("changed")).toBeNull();
  });

  it("lists different hosts and models above the body, by name", async () => {
    fetchMock.mockResolvedValue(json(skillCompare({}, { agent_id: "h2", agent_version: 5, model: "m2" })));
    mountSkill();

    const host = (await screen.findByText("Host agent")).closest("li")!;
    expect(host).toHaveTextContent("Security Reviewer → Style Reviewer");
    expect(screen.getByText("Host agent version").closest("li")).toHaveTextContent("v2 → v5");
    expect(screen.getByText("Model").closest("li")).toHaveTextContent("m1 → m2");
    expect(screen.queryByText("Provider")).toBeNull();
    const config = screen.getByText("Configuration");
    const body = screen.getByText("Skill body");
    expect(config.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers no Promote and sends no request to /agents/", async () => {
    fetchMock.mockResolvedValue(json(skillCompare()));
    mountSkill();
    await screen.findByText("Compare runs · skill v3 → v4");

    expect(screen.queryByRole("button", { name: /Promote/ })).toBeNull();
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("/agents/"))).toBe(true);
  });

  it("shows the API message when the runs cannot be compared", async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: "eval_runs_not_comparable", message: "These runs cannot be compared." } }, 400),
    );
    mountSkill();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not compare these runs.");
    expect(alert).toHaveTextContent("These runs cannot be compared.");
  });

  it("names the cases left out of the older run, the newer run and the edited ones", async () => {
    fetchMock.mockResolvedValue(
      json(skillCompare({}, {}, { cases_only_in_base: ["Old case"], cases_only_in_head: ["New case"], cases_edited: ["Edited case"] })),
    );
    mountSkill();

    expect(await screen.findByText("Only in the older run: Old case")).toBeInTheDocument();
    expect(screen.getByText("Only in the newer run: New case")).toBeInTheDocument();
    expect(screen.getByText(/This case was edited between the two runs/)).toHaveTextContent("Edited case");
  });

  it("shows a body as text, never as markup", async () => {
    const body = "<img src=x onerror=alert(1)>";
    fetchMock.mockResolvedValue(json(skillCompare({}, { skill_body: body })));
    mountSkill();

    expect(await screen.findByText(body)).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("closes on Escape and returns focus to the control that opened it", async () => {
    fetchMock.mockResolvedValue(json(skillCompare()));
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <QueryClientProvider client={qc}>
          <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common: commonMessages }}>
            <button onClick={() => setOpen(true)}>Open compare</button>
            {open && <CompareRunsDialog skillId="s1" hostNames={new Map()} baseId="r1" headId="r2" onClose={() => setOpen(false)} />}
          </NextIntlClientProvider>
        </QueryClientProvider>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open compare" });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByText("Compare runs · skill v3 → v4");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(opener).toHaveFocus();
  });
});
