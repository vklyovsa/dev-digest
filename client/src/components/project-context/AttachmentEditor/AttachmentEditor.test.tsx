import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { ContextInheritedDoc, SpecFile } from "@devdigest/shared";
import context from "../../../../messages/en/context.json";
import { ToastProvider } from "@/lib/toast";

let activeRepo: { id: string; full_name: string } | null = null;
let reposLoaded = true;
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo, reposLoaded }),
}));

import { useAttachments, type AttachmentOwner } from "../useAttachments";
import { AttachmentEditor } from "./AttachmentEditor";
import { buildRows, move, sumTokens, toggle } from "./helpers";

const doc = (path: string, type: string, tokens: number): SpecFile => ({
  path,
  type,
  tokens,
  agent_count: 0,
});

const SEC = "specs/security-baseline.md";
const PUB = "specs/public-api.md";
const RATE = "specs/rate-limiting.md";
const ARCH = "docs/architecture.md";
const DEPLOY = "docs/deployment.md";
const INCIDENT = "insights/incident-2026-04-checkout.md";
const PERF = "insights/perf-budget.md";

const DOCS: SpecFile[] = [
  doc(SEC, "specs", 120),
  doc(PUB, "specs", 90),
  doc(RATE, "specs", 80),
  doc(ARCH, "docs", 210),
  doc(DEPLOY, "docs", 107),
  doc(INCIDENT, "insights", 1240),
  doc(PERF, "insights", 60),
];
const ROOTS = ["specs", "docs", "insights"];

const AGENT: AttachmentOwner = { kind: "agent", id: "a1" };
const SKILL: AttachmentOwner = { kind: "skill", id: "s1" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const failure = (status: number) => json({ error: { code: "failed", message: "boom" } }, status);
const never = () => new Promise<Response>(() => {});

interface Api {
  list: () => Response | Promise<Response>;
  attachments: () => Response | Promise<Response>;
  put: (paths: string[]) => Response | Promise<Response>;
  doc: (path: string) => Response | Promise<Response>;
}

let documents: SpecFile[];
let attached: string[];
let inherited: ContextInheritedDoc[];
let api: Api;

const defaults = (): Api => ({
  list: () => json({ roots: ROOTS, documents }),
  attachments: () => json({ paths: attached, inherited }),
  put: (paths) => json({ paths, inherited }),
  doc: (path) =>
    json({
      path,
      type: "specs",
      tokens: 1240,
      content: "# Refund rules\n\nNo refunds after 30 days.\n",
    }),
});

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  if (url.pathname === "/repos/r1/context") return api.list();
  if (url.pathname === "/repos/r1/context/document") return api.doc(url.searchParams.get("path") ?? "");
  if (/^\/(agents|skills)\/[^/]+\/context$/.test(url.pathname)) {
    if (method === "PUT") return api.put((JSON.parse(String(init?.body)) as { paths: string[] }).paths);
    return api.attachments();
  }
  throw new Error(`unexpected request ${method} ${url.pathname}`);
});

const requestsTo = (pathname: string) =>
  fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname === pathname);
const puts = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === "PUT")
    .map(([input, init]) => ({
      pathname: new URL(String(input)).pathname,
      paths: (JSON.parse(String(init?.body)) as { paths: string[] }).paths,
    }));

const rows = () => within(screen.getByRole("list")).getAllByRole("listitem");
const names = () => rows().map((row) => /^.+?\.md/.exec(row.textContent ?? "")?.[0]);
const checkbox = (path: string) => screen.getByRole("checkbox", { name: `Attach ${path}` });
const filterBox = () => screen.getByRole("searchbox", { name: context.attach.filter });

function Editor({ owner, preview }: { owner: AttachmentOwner; preview: "button" | "icon" }) {
  const state = useAttachments(owner);
  return <AttachmentEditor state={state} preview={preview} />;
}

function renderEditor(owner: AttachmentOwner = AGENT, preview: "button" | "icon" = "button") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ context }}>
        <ToastProvider>
          <Editor owner={owner} preview={preview} />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/** Renders, then waits until both the document list and the attachment list have arrived. */
async function renderLoaded(owner?: AttachmentOwner, preview?: "button" | "icon") {
  renderEditor(owner, preview);
  const list = await screen.findByRole("list");
  await waitFor(() => expect(list).toHaveAttribute("aria-busy", "false"));
}

beforeEach(() => {
  activeRepo = { id: "r1", full_name: "acme/payments-api" };
  reposLoaded = true;
  documents = DOCS;
  attached = [];
  inherited = [];
  api = defaults();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AttachmentEditor — the rows", () => {
  it("renders every document with a checkbox, file name, folder, type badge and Preview control (AC-30, NFR-6)", async () => {
    await renderLoaded();

    expect(rows()).toHaveLength(7);
    DOCS.forEach((d, i) => {
      const row = within(rows()[i]!);
      const slash = d.path.lastIndexOf("/") + 1;
      expect(row.getByRole("checkbox", { name: `Attach ${d.path}` })).toBeInTheDocument();
      expect(row.getByText(d.path.slice(slash))).toBeInTheDocument();
      expect(row.getByText(d.path.slice(0, slash))).toBeInTheDocument();
      expect(row.getByText(d.type)).toBeInTheDocument();
      expect(row.getByRole("button", { name: `Preview ${d.path}` })).toBeInTheDocument();
    });
  });

  it("puts attached documents first in attachment order, then the rest in API order (AC-31)", async () => {
    attached = [DEPLOY, PUB];
    await renderLoaded();

    expect(names()).toEqual([
      "deployment.md",
      "public-api.md",
      "security-baseline.md",
      "rate-limiting.md",
      "architecture.md",
      "incident-2026-04-checkout.md",
      "perf-budget.md",
    ]);
    expect(checkbox(DEPLOY)).toBeChecked();
    expect(checkbox(PUB)).toBeChecked();
    expect(checkbox(SEC)).not.toBeChecked();
  });

  it("filters every row by the typed text, ignoring case, without a request (AC-32, NFR-13)", async () => {
    attached = [DEPLOY, PUB];
    await renderLoaded();
    const before = fetchMock.mock.calls.length;

    fireEvent.change(filterBox(), { target: { value: "PUBLIC" } });
    expect(names()).toEqual(["public-api.md"]);

    fireEvent.change(filterBox(), { target: { value: "docs/" } });
    expect(names()).toEqual(["deployment.md", "architecture.md"]);

    fireEvent.change(filterBox(), { target: { value: "nothing-like-this" } });
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText(context.page.emptyTitle)).toBeInTheDocument();

    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("marks a document whose type has no colour with the type's own text (AC-28)", async () => {
    documents = [doc("adr/0001-choice.md", "adr", 10)];
    await renderLoaded();
    expect(within(rows()[0]!).getByText("adr")).toBeInTheDocument();
  });

  it("renders the Preview control as an icon button on the skill tab", async () => {
    await renderLoaded(SKILL, "icon");
    expect(screen.queryByText(context.attach.preview)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Preview ${PUB}` })).toBeInTheDocument();
  });
});

describe("AttachmentEditor — changing the attachments", () => {
  it("appends a ticked document to the attachment list with a PUT to the agent route (AC-33)", async () => {
    attached = [PUB];
    await renderLoaded();

    fireEvent.click(checkbox(RATE));
    expect(checkbox(RATE)).toBeChecked();

    await waitFor(() => expect(puts()).toEqual([{ pathname: "/agents/a1/context", paths: [PUB, RATE] }]));
    await waitFor(() => expect(names().slice(0, 2)).toEqual(["public-api.md", "rate-limiting.md"]));
  });

  it("sends the same change to the skill route in the skill editor (AC-33)", async () => {
    attached = [PUB];
    api.attachments = () => json({ paths: attached });
    api.put = (paths) => json({ paths });
    await renderLoaded(SKILL, "icon");

    fireEvent.click(checkbox(RATE));

    await waitFor(() => expect(puts()).toEqual([{ pathname: "/skills/s1/context", paths: [PUB, RATE] }]));
  });

  it("sends the list without a cleared document, keeping the order of the rest (AC-34)", async () => {
    attached = [SEC, PUB, RATE];
    await renderLoaded();

    fireEvent.click(checkbox(PUB));

    await waitFor(() => expect(puts()).toEqual([{ pathname: "/agents/a1/context", paths: [SEC, RATE] }]));
  });

  it("moves a dragged attached row to the position of the row it is dropped on (AC-35)", async () => {
    attached = [SEC, PUB, RATE];
    await renderLoaded();

    fireEvent.dragStart(rows()[0]!);
    fireEvent.dragOver(rows()[2]!);
    fireEvent.drop(rows()[2]!);

    await waitFor(() =>
      expect(puts()).toEqual([{ pathname: "/agents/a1/context", paths: [PUB, RATE, SEC] }]),
    );
  });

  it("does nothing when an attached row is dropped on a document that is not attached", async () => {
    attached = [SEC, PUB];
    await renderLoaded();

    fireEvent.dragStart(rows()[0]!);
    fireEvent.drop(rows()[3]!);

    expect(puts()).toEqual([]);
  });

  it("moves an attached row by one position with its buttons, and disables the ends (AC-36)", async () => {
    attached = [SEC, PUB];
    await renderLoaded();

    expect(screen.getByRole("button", { name: `Move ${SEC} earlier in the prompt` })).toBeDisabled();
    expect(screen.getByRole("button", { name: `Move ${PUB} later in the prompt` })).toBeDisabled();
    expect(screen.queryByRole("button", { name: `Move ${RATE} earlier in the prompt` })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: `Move ${PUB} earlier in the prompt` }));

    await waitFor(() => expect(puts()).toEqual([{ pathname: "/agents/a1/context", paths: [PUB, SEC] }]));
  });

  it("keeps every checkbox disabled and sends nothing while the attachment list is loading (AC-37)", async () => {
    api.attachments = never;
    renderEditor();
    await screen.findByRole("list");

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(7);
    boxes.forEach((box) => expect(box).toBeDisabled());
    expect(screen.queryAllByRole("button", { name: /in the prompt$/ })).toHaveLength(0);

    fireEvent.click(boxes[0]!);
    expect(puts()).toEqual([]);
  });

  it("shows no checkbox while the document list is loading (AC-37)", async () => {
    api.list = never;
    renderEditor();
    await waitFor(() => expect(requestsTo("/agents/a1/context")).toHaveLength(1));

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("shows the last saved list again, with an error message, when the save fails (AC-38)", async () => {
    attached = [PUB];
    api.put = () => failure(500);
    await renderLoaded();

    fireEvent.click(checkbox(RATE));
    expect(checkbox(RATE)).toBeChecked();

    expect(await screen.findByText(context.attach.saveError)).toBeInTheDocument();
    await waitFor(() => expect(checkbox(RATE)).not.toBeChecked());
    expect(checkbox(PUB)).toBeChecked();
    expect(names()[0]).toBe("public-api.md");
  });
});

describe("AttachmentEditor — paths the repository does not list", () => {
  it("marks an attached path that is not in the list and lets it be cleared (AC-39, NFR-6)", async () => {
    attached = ["specs/gone.md", PUB];
    await renderLoaded();

    const gone = within(rows()[0]!);
    expect(gone.getByText("gone.md")).toBeInTheDocument();
    expect(gone.getByText(context.attach.notFound)).toBeInTheDocument();
    expect(gone.queryByRole("button", { name: /^Preview/ })).not.toBeInTheDocument();
    expect(checkbox("specs/gone.md")).toBeChecked();
    expect(checkbox("specs/gone.md")).toBeEnabled();

    fireEvent.click(checkbox("specs/gone.md"));

    await waitFor(() => expect(puts()).toEqual([{ pathname: "/agents/a1/context", paths: [PUB] }]));
  });

  it("shows an attached path as not found while the list holds no document at all (AC-39)", async () => {
    documents = [];
    attached = ["specs/gone.md"];
    await renderLoaded();

    expect(screen.getByText(context.attach.notFound)).toBeInTheDocument();
    expect(screen.queryByText(/No Markdown files under/)).not.toBeInTheDocument();
  });

  it("shows an inherited path that is not in the list as not found, with no Preview (AC-39)", async () => {
    inherited = [{ path: "docs/removed.md", skill_id: "k1", skill_name: "pr-rubric" }];
    await renderLoaded();

    const row = within(rows()[0]!);
    expect(row.getByText(context.attach.notFound)).toBeInTheDocument();
    expect(row.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("AttachmentEditor — inherited documents", () => {
  it("shows each inherited document read-only, naming its skill, between attached and unattached (AC-82)", async () => {
    attached = [PUB];
    inherited = [{ path: ARCH, skill_id: "k1", skill_name: "pr-quality-rubric" }];
    await renderLoaded();

    expect(names().slice(0, 3)).toEqual(["public-api.md", "architecture.md", "security-baseline.md"]);
    const row = within(rows()[1]!);
    expect(row.getByText("via pr-quality-rubric")).toBeInTheDocument();
    expect(row.getByRole("button", { name: `Preview ${ARCH}` })).toBeInTheDocument();
    expect(row.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(row.queryByRole("button", { name: /in the prompt$/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
  });

  it("lists a path once when it is both attached and inherited", async () => {
    attached = [ARCH];
    inherited = [{ path: ARCH, skill_id: "k1", skill_name: "pr-quality-rubric" }];
    await renderLoaded();

    expect(names().filter((name) => name === "architecture.md")).toHaveLength(1);
    expect(screen.queryByText(/^via /)).not.toBeInTheDocument();
  });
});

describe("AttachmentEditor — the preview dialog", () => {
  it("opens the rendered document with its token estimate and closes without touching the rows or the filter (AC-41, NFR-7)", async () => {
    await renderLoaded();
    fireEvent.change(filterBox(), { target: { value: "docs/" } });
    expect(requestsTo("/repos/r1/context/document")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: `Preview ${ARCH}` }));

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("heading", { name: "Refund rules" })).toBeInTheDocument();
    expect(within(dialog).getByText("No refunds after 30 days.")).toBeInTheDocument();
    expect(within(dialog).getByText("≈ 1,240 tokens")).toBeInTheDocument();
    expect(within(dialog).getByText(ARCH)).toBeInTheDocument();
    const [request] = requestsTo("/repos/r1/context/document");
    expect(new URL(String(request![0])).searchParams.get("path")).toBe(ARCH);

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(filterBox()).toHaveValue("docs/");
    expect(names()).toEqual(["architecture.md", "deployment.md"]);
  });

  it("closes on Escape", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: `Preview ${PUB}` }));
    await screen.findByRole("dialog");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows an error inside the dialog when the document cannot be read", async () => {
    api.doc = () => failure(404);
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: `Preview ${PUB}` }));

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(context.attach.loadError);
  });
});

describe("AttachmentEditor — states of the list", () => {
  it("names the searched folders when there is no document and nothing attached (AC-42)", async () => {
    documents = [];
    renderEditor();

    expect(
      await screen.findByText("No Markdown files under specs/ · docs/ · insights/ in this repository."),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("shows a notice and requests no document list when no repository is active (AC-43)", async () => {
    activeRepo = null;
    renderEditor();

    expect(screen.getByText(context.attach.noRepo)).toBeInTheDocument();
    await waitFor(() => expect(requestsTo("/agents/a1/context")).toHaveLength(1));
    expect(fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname.startsWith("/repos/"))).toHaveLength(0);
  });

  it("shows neither the notice nor a list request while the repository list is loading", async () => {
    activeRepo = null;
    reposLoaded = false;
    renderEditor();
    await waitFor(() => expect(requestsTo("/agents/a1/context")).toHaveLength(1));

    expect(screen.queryByText(context.attach.noRepo)).not.toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname.startsWith("/repos/"))).toHaveLength(0);
  });

  it("shows an error with a control that repeats a failed document list request (AC-44)", async () => {
    api.list = () => failure(500);
    renderEditor();

    expect(await screen.findByText(context.attach.loadError)).toBeInTheDocument();
    expect(requestsTo("/repos/r1/context")).toHaveLength(1);

    api.list = defaults().list;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(requestsTo("/repos/r1/context")).toHaveLength(2));
    expect(await screen.findByRole("checkbox", { name: `Attach ${PUB}` })).toBeInTheDocument();
  });

  it("shows an error with a control that repeats a failed attachment list request (AC-44)", async () => {
    api.attachments = () => failure(500);
    renderEditor();

    expect(await screen.findByText(context.attach.loadError)).toBeInTheDocument();
    expect(requestsTo("/agents/a1/context")).toHaveLength(1);

    api.attachments = defaults().attachments;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(requestsTo("/agents/a1/context")).toHaveLength(2));
    expect(await screen.findByRole("checkbox", { name: `Attach ${PUB}` })).toBeInTheDocument();
  });
});

describe("AttachmentEditor — keyboard and names (NFR-5)", () => {
  it("gives every control an accessible name with the path and keeps it a native, focusable control", async () => {
    attached = [SEC, PUB];
    await renderLoaded();

    const controls = [
      screen.getByRole("checkbox", { name: `Attach ${PUB}` }),
      screen.getByRole("button", { name: `Move ${PUB} earlier in the prompt` }),
      screen.getByRole("button", { name: `Preview ${PUB}` }),
    ];
    controls.forEach((control) => {
      expect(["INPUT", "BUTTON"]).toContain(control.tagName);
      expect(control).not.toHaveAttribute("tabindex", "-1");
      control.focus();
      expect(control).toHaveFocus();
    });
    expect(controls[0]).toHaveAttribute("type", "checkbox");
  });
});

describe("attachment helpers", () => {
  const inheritedDoc = (path: string, skill_name = "rubric"): ContextInheritedDoc => ({
    path,
    skill_id: "k1",
    skill_name,
  });

  it("buildRows() orders own, inherited, then the rest, and flags a path the list lacks", () => {
    const result = buildRows(DOCS, [DEPLOY, "specs/gone.md"], [inheritedDoc(PUB)], "");
    expect(result.map((row) => [row.path, row.source, row.missing])).toEqual([
      [DEPLOY, "attached", false],
      ["specs/gone.md", "attached", true],
      [PUB, "inherited", false],
      [SEC, "available", false],
      [RATE, "available", false],
      [ARCH, "available", false],
      [INCIDENT, "available", false],
      [PERF, "available", false],
    ]);
    expect(result[0]).toMatchObject({ type: "docs", index: 0, skillName: null });
    expect(result[1]).toMatchObject({ type: null, index: 1 });
    expect(result[2]).toMatchObject({ skillName: "rubric", index: -1 });
  });

  it("buildRows() keeps a path that repeats at its first position only and applies the filter to every row", () => {
    const result = buildRows(DOCS, [ARCH], [inheritedDoc(ARCH), inheritedDoc(PUB), inheritedDoc(PUB)], "");
    expect(result.filter((row) => row.path === ARCH)).toHaveLength(1);
    expect(result.filter((row) => row.path === PUB)).toHaveLength(1);
    expect(buildRows(DOCS, [ARCH], [inheritedDoc(PUB)], "PUBLIC").map((row) => row.path)).toEqual([PUB]);
  });

  it("move() returns a new array and leaves a no-op or out-of-range move alone", () => {
    expect(move(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    const same = ["a", "b"];
    expect(move(same, 0, 0)).toBe(same);
    expect(move(same, 0, 5)).toBe(same);
    expect(move(same, -1, 0)).toBe(same);
  });

  it("toggle() appends on attach and keeps the order of the rest on detach", () => {
    expect(toggle(["a"], "b")).toEqual(["a", "b"]);
    expect(toggle(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("sumTokens() adds own and inherited documents that are in the list, each path once (AC-84)", () => {
    expect(sumTokens(DOCS, [ARCH, DEPLOY], [])).toBe(317);
    expect(sumTokens(DOCS, [ARCH, DEPLOY], [inheritedDoc(PUB)])).toBe(407);
    expect(sumTokens(DOCS, [ARCH, DEPLOY], [inheritedDoc(ARCH), inheritedDoc(PUB)])).toBe(407);
    expect(sumTokens(DOCS, ["specs/gone.md"], [inheritedDoc("docs/removed.md")])).toBe(0);
    expect(sumTokens(DOCS, [INCIDENT], [])).toBe(1240);
  });
});
