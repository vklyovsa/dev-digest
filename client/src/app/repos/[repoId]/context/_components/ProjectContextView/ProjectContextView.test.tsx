import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { SpecFile } from "@devdigest/shared";
import { RESYNC_POLL_TIMEOUT_MS } from "@/lib/hooks/blast";
import context from "../../../../../../../messages/en/context.json";
import common from "../../../../../../../messages/en/common.json";

const push = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => search,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

let repoNotFound = false;
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "r1", full_name: "acme/payments-api" } }),
  useRepoNotFound: () => repoNotFound,
}));

import { ProjectContextView } from "./ProjectContextView";

const REFUNDS = "specs/payments/refunds.md";
const OVERVIEW = "docs/api/overview.md";
const RETRO = "insights/retros/q3.md";

const doc = (path: string, type: string, agent_count: number): SpecFile => ({
  path,
  type,
  tokens: 100,
  agent_count,
});

const DOCS: SpecFile[] = [
  doc(REFUNDS, "specs", 3),
  doc(OVERVIEW, "docs", 1),
  doc(RETRO, "insights", 0),
];

const ORIGINAL_CONTENT: Record<string, string> = {
  [REFUNDS]: "# Refund rules\n\n## Limits\n\n- Within 30 days\n- Receipt required\n",
  [OVERVIEW]: "# API overview\n\nPublic endpoints are rate limited.\n",
  [RETRO]: "# Q3 retro\n",
};
let CONTENT = { ...ORIGINAL_CONTENT };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const failure = (status: number) => json({ error: { code: "failed", message: "boom" } }, status);

interface Api {
  list: () => Response | Promise<Response>;
  doc: (path: string) => Response;
  index: () => Response;
  resync: () => Response;
}

const indexState = (updatedAt: string) => ({
  status: "full",
  filesIndexed: 3,
  filesSkipped: 0,
  lastIndexedSha: "aaa111",
  updatedAt,
});
const INDEX_BEFORE = indexState("2026-10-01T10:00:00Z");
const INDEX_AFTER = indexState("2026-10-01T10:05:00Z");

const listBody = (documents: SpecFile[]) => ({ roots: ["specs", "docs", "insights"], documents });

const defaults = (): Api => ({
  list: () => json(listBody(DOCS)),
  doc: (path) => {
    const found = DOCS.find((d) => d.path === path);
    return found && CONTENT[path] !== undefined
      ? json({ path, type: found.type, tokens: found.tokens, content: CONTENT[path] })
      : failure(404);
  },
  index: () => json(INDEX_BEFORE),
  resync: () => json({ status: "queued" }, 202),
});

let api: Api = defaults();
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input));
  if (url.pathname === "/repos/r1/context") return api.list();
  if (url.pathname === "/repos/r1/context/document") return api.doc(url.searchParams.get("path") ?? "");
  if (url.pathname === "/repos/r1/index-state") return api.index();
  if (url.pathname === "/repos/r1/resync" && init?.method === "POST") return api.resync();
  throw new Error(`unexpected request ${url.pathname}`);
});

const requestsTo = (pathname: string) =>
  fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname === pathname);

const panel = () => within(screen.getByRole("complementary"));
const findRows = () => panel().findAllByRole("listitem");
const getRows = () => panel().getAllByRole("listitem");
const rowButton = (rows: HTMLElement[], i: number) => within(rows[i]!).getByRole("button");

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ context, common }}>
        <ProjectContextView />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api = defaults();
  CONTENT = { ...ORIGINAL_CONTENT };
  search = new URLSearchParams();
  repoNotFound = false;
  push.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ProjectContextView — the list", () => {
  it("renders one row per document with its file name, folder and type badge (AC-11)", async () => {
    renderView();
    const rows = await findRows();

    expect(rows).toHaveLength(3);
    const expected: [string, string, string][] = [
      ["refunds.md", "specs/payments/", "specs"],
      ["overview.md", "docs/api/", "docs"],
      ["q3.md", "insights/retros/", "insights"],
    ];
    expected.forEach(([name, folder, type], i) => {
      const row = within(rows[i]!);
      expect(row.getByText(name)).toBeInTheDocument();
      expect(row.getByText(folder)).toBeInTheDocument();
      expect(row.getByText(type)).toBeInTheDocument();
    });
  });

  it("filters rows by the typed text, ignoring case, without a request (AC-12, NFR-13)", async () => {
    renderView();
    await findRows();
    await screen.findByText("Refund rules");
    const before = fetchMock.mock.calls.length;

    fireEvent.change(screen.getByRole("searchbox", { name: "Search documents…" }), {
      target: { value: "API/OVER" },
    });

    const rows = getRows();
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText("overview.md")).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it.each([
    [1, "1 file"],
    [12, "12 files"],
    [1240, "1,240 files"],
  ])("shows the number of documents found: %i → %s (AC-18, NFR-7)", async (count, label) => {
    const many = Array.from({ length: count }, (_, i) => doc(`docs/d${i}.md`, "docs", 0));
    api.list = () => json(listBody(many));
    renderView();

    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it("offers no control that creates, edits, uploads or deletes (AC-19)", async () => {
    renderView();
    await findRows();

    expect(
      screen.queryByRole("button", { name: /\b(edit|add|new|create|upload|delete)\b/i }),
    ).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows a loading placeholder and no rows while the list is pending (AC-20)", () => {
    api.list = () => new Promise<Response>(() => {});
    const { container } = renderView();

    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    expect(panel().queryAllByRole("listitem")).toHaveLength(0);
  });

  it("names the searched folders when the list is empty (AC-21)", async () => {
    api.list = () => json(listBody([]));
    renderView();

    expect(await screen.findByText("No documents found")).toBeInTheDocument();
    expect(
      screen.getByText("No Markdown files under specs/ · docs/ · insights/ in this repository."),
    ).toBeInTheDocument();
    expect(requestsTo("/repos/r1/context/document")).toHaveLength(0);
  });

  it("shows an error with a control that repeats the request (AC-22)", async () => {
    let calls = 0;
    api.list = () => (++calls === 1 ? failure(500) : json(listBody(DOCS)));
    renderView();

    expect(await screen.findByText("Couldn’t load the documents")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await findRows()).toHaveLength(3);
    expect(requestsTo("/repos/r1/context")).toHaveLength(2);
  });

  it("shows the no-repository state and issues no request for an unknown repository (AC-23)", () => {
    repoNotFound = true;
    renderView();

    expect(screen.getByText("No repo selected")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ProjectContextView — the selected document", () => {
  it("renders the content as Markdown with heading and list elements (AC-13)", async () => {
    const { container } = renderView();
    await screen.findByText("Refund rules");

    const body = container.querySelector(".dd-doc");
    expect(body?.querySelector("h1")).toHaveTextContent("Refund rules");
    expect(body?.querySelector("h2")).toHaveTextContent("Limits");
    expect(body?.querySelectorAll("li")).toHaveLength(2);
  });

  it("shows how many agents use it, singular and plural (AC-15)", async () => {
    renderView();
    expect(await screen.findByText("Used by 3 agents")).toBeInTheDocument();
    cleanup();

    search = new URLSearchParams(`doc=${OVERVIEW}`);
    renderView();
    expect(await screen.findByText("Used by 1 agent")).toBeInTheDocument();
  });

  it("writes the selected path into the doc parameter (AC-24)", async () => {
    renderView();
    const rows = await findRows();

    fireEvent.click(rowButton(rows, 1));

    expect(push).toHaveBeenCalledTimes(1);
    const target = new URL(push.mock.calls[0]![0], "http://localhost");
    expect(target.pathname).toBe("/repos/r1/context");
    expect(target.searchParams.get("doc")).toBe(OVERVIEW);
  });

  it("shows the document named by the doc parameter, and requests only that one (AC-25, NFR-11)", async () => {
    search = new URLSearchParams(`doc=${OVERVIEW}`);
    renderView();

    expect(await screen.findByText("API overview")).toBeInTheDocument();
    const rows = getRows();
    expect(rowButton(rows, 1)).toHaveAttribute("aria-current", "true");
    expect(rowButton(rows, 0)).not.toHaveAttribute("aria-current");

    const requested = requestsTo("/repos/r1/context/document");
    expect(requested).toHaveLength(1);
    expect(new URL(String(requested[0]![0])).searchParams.get("path")).toBe(OVERVIEW);
  });

  it.each([
    ["no doc parameter", ""],
    ["a doc parameter that names no listed document", "doc=specs/gone.md"],
  ])("shows the first document for %s (AC-26)", async (_label, query) => {
    search = new URLSearchParams(query);
    renderView();

    expect(await screen.findByText("Refund rules")).toBeInTheDocument();
    const requested = requestsTo("/repos/r1/context/document");
    expect(requested).toHaveLength(1);
    expect(new URL(String(requested[0]![0])).searchParams.get("path")).toBe(REFUNDS);
    expect(push).not.toHaveBeenCalled();
  });

  it("shows an error in the pane when the document request fails, and keeps the list usable (AC-27)", async () => {
    api.doc = () => failure(404);
    renderView();

    expect(await screen.findByText("Couldn’t load this document")).toBeInTheDocument();
    const rows = getRows();
    expect(rows).toHaveLength(3);
    fireEvent.click(rowButton(rows, 2));
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("renders neither a raw script nor a raw image element from a document (NFR-4)", async () => {
    CONTENT[REFUNDS] =
      '# Safe heading\n\n<script>window.pwned = true</script>\n\n<img src="x" onerror="window.pwned = true">\n';
    const { container } = renderView();
    await screen.findByText("Safe heading");

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined();
  });
});

describe("ProjectContextView — refresh", () => {
  const REFRESH = "Refresh from GitHub";
  const RUNNING = "Syncing…";

  async function startRefresh() {
    renderView();
    await findRows();
    const control = await screen.findByRole("button", { name: REFRESH });
    await waitFor(() => expect(control).toBeEnabled());
    fireEvent.click(control);
  }

  it("sends POST /repos/:id/resync and reads no list until the index state changes (AC-17)", async () => {
    await startRefresh();

    await waitFor(() => expect(requestsTo("/repos/r1/resync")).toHaveLength(1));
    expect(requestsTo("/repos/r1/resync")[0]![1]?.method).toBe("POST");
    await waitFor(() => expect(requestsTo("/repos/r1/index-state").length).toBeGreaterThan(1));
    expect(requestsTo("/repos/r1/context")).toHaveLength(1);
  });

  it("disables the control, shows the running label and keeps the rows while syncing (AC-90)", async () => {
    await startRefresh();

    const running = await screen.findByRole("button", { name: RUNNING });
    expect(running).toBeDisabled();
    expect(getRows()).toHaveLength(3);
    expect(screen.queryByRole("button", { name: REFRESH })).toBeNull();
  });

  it("reads the list again when the index state changes and shows the new document (AC-89)", async () => {
    await startRefresh();
    await screen.findByRole("button", { name: RUNNING });

    api.list = () => json(listBody([...DOCS, doc("docs/new/added.md", "docs", 0)]));
    api.index = () => json(INDEX_AFTER);

    expect(await panel().findByText("added.md", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(requestsTo("/repos/r1/context")).toHaveLength(2);
    await waitFor(() => expect(screen.getByRole("button", { name: REFRESH })).toBeEnabled());
  }, 10_000);

  it("shows a notice and frees the control after 120 seconds without a change (AC-91)", async () => {
    renderView();
    await findRows();
    const control = await screen.findByRole("button", { name: REFRESH });
    await waitFor(() => expect(control).toBeEnabled());

    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(control);
    await screen.findByRole("button", { name: RUNNING });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESYNC_POLL_TIMEOUT_MS);
    });

    expect(
      await screen.findByText("The sync is taking longer than expected. The list may be out of date."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: REFRESH })).toBeEnabled();
    expect(getRows()).toHaveLength(3);
  });

  it("shows an error and leaves the list as it was when the request is rejected (AC-92)", async () => {
    api.resync = () => failure(500);
    await startRefresh();

    expect(
      await screen.findByText("The sync could not be started. The list is unchanged."),
    ).toBeInTheDocument();
    expect(getRows()).toHaveLength(3);
    expect(screen.getByRole("button", { name: REFRESH })).toBeEnabled();
    expect(requestsTo("/repos/r1/context")).toHaveLength(1);
  });
});
