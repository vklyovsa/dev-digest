import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SpecFile } from "@devdigest/shared";
import context from "../../../../../../../messages/en/context.json";
import { ToastProvider } from "@/lib/toast";

let activeRepo: { id: string; full_name: string } | null = null;
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo, reposLoaded: true }),
}));

import { ContextTab } from "./ContextTab";

const SKILL: Skill = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "Rubric for evaluating overall PR quality.",
  type: "rubric",
  source: "manual",
  body: "# pr-quality-rubric",
  enabled: true,
  version: 5,
  evidence_files: null,
  agent_count: 3,
};

const doc = (path: string, type: string, tokens: number): SpecFile => ({ path, type, tokens, agent_count: 0 });

const SEC = "specs/security-baseline.md";
const PUB = "specs/public-api.md";
const RATE = "specs/rate-limiting.md";
const ARCH = "docs/architecture.md";
const INCIDENT = "insights/incident-2026-04-checkout.md";

const DOCS: SpecFile[] = [
  doc(SEC, "specs", 120),
  doc(PUB, "specs", 90),
  doc(RATE, "specs", 80),
  doc(ARCH, "docs", 210),
  doc(INCIDENT, "insights", 1240),
];
const ROOTS = ["specs", "docs", "insights"];

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const never = () => new Promise<Response>(() => {});

let attached: string[];
let list: () => Response | Promise<Response>;

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const { pathname } = new URL(String(input));
  if (pathname === "/repos/r1/context") return list();
  if (pathname === "/skills/sk1/context") {
    if (init?.method === "PUT") return json({ paths: (JSON.parse(String(init.body)) as { paths: string[] }).paths });
    return json({ paths: attached });
  }
  throw new Error(`unexpected request ${pathname}`);
});

const puts = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === "PUT")
    .map(([input, init]) => ({
      pathname: new URL(String(input)).pathname,
      paths: (JSON.parse(String(init?.body)) as { paths: string[] }).paths,
    }));

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ context }}>
        <ToastProvider>
          <ContextTab skill={SKILL} />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

async function renderLoaded() {
  renderTab();
  const rows = await screen.findByRole("list");
  await waitFor(() => expect(rows).toHaveAttribute("aria-busy", "false"));
}

const serializedBox = () => screen.getByText(/^## Project /);

beforeEach(() => {
  activeRepo = { id: "r1", full_name: "acme/payments-api" };
  attached = [];
  list = () => json({ roots: ROOTS, documents: DOCS });
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Skill Context tab — heading and count", () => {
  it("shows the heading, the number attached and the inheritance line (AC-53)", async () => {
    attached = [PUB];
    await renderLoaded();

    expect(screen.getByRole("heading", { name: context.skillTab.title })).toBeInTheDocument();
    expect(screen.getByText("1 attached")).toBeInTheDocument();
    expect(screen.getByText("Any agent using this skill inherits these documents.")).toBeInTheDocument();
  });

  it("shows no count and no sum until both lists have arrived", async () => {
    attached = [PUB];
    list = never;
    renderTab();

    expect(await screen.findByRole("heading", { name: context.skillTab.title })).toBeInTheDocument();
    expect(screen.queryByText(/attached$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/tokens$/)).not.toBeInTheDocument();
  });
});

describe("Skill Context tab — token sum", () => {
  it("shows the tokens of the attached documents (AC-57)", async () => {
    attached = [ARCH];
    await renderLoaded();
    expect(screen.getByText("≈ 210 tokens")).toBeInTheDocument();
  });

  it("groups the digits of a sum over 999 (AC-57, NFR-7)", async () => {
    attached = [INCIDENT];
    await renderLoaded();
    expect(screen.getByText("≈ 1,240 tokens")).toBeInTheDocument();
  });

  it("carries no agent-only note", async () => {
    attached = [ARCH];
    await renderLoaded();
    expect(screen.queryByText(context.agentTab.note)).not.toBeInTheDocument();
  });

  it("warns once the attached documents pass the token budget", async () => {
    const RUNBOOK = "docs/runbook.md";
    list = () => json({ roots: ROOTS, documents: [...DOCS, doc(RUNBOOK, "docs", 7800)] });
    attached = [RUNBOOK];
    await renderLoaded();
    expect(screen.queryByText("over the 8,000-token budget")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: `Attach ${ARCH}` }));

    expect(await screen.findByText("≈ 8,010 tokens")).toBeInTheDocument();
    expect(screen.getByText("over the 8,000-token budget")).toBeInTheDocument();
  });
});

describe("Skill Context tab — what the skill serializes as", () => {
  it("shows the heading line and one path line per attached document, in attachment order (AC-54)", async () => {
    attached = [SEC, PUB];
    await renderLoaded();

    expect(screen.getByText("SERIALIZES AS")).toBeInTheDocument();
    const box = serializedBox();
    expect(box.tagName).toBe("PRE");
    expect(box.textContent).toBe(`## Project specifications\n- ${SEC}\n- ${PUB}`);
  });

  it("is a read-only box holding no input and no document text (AC-54)", async () => {
    attached = [PUB];
    await renderLoaded();

    const box = serializedBox();
    expect(within(box).queryByRole("textbox")).not.toBeInTheDocument();
    expect(box.children).toHaveLength(0);
    expect(box.textContent).toBe(`## Project specifications\n- ${PUB}`);
  });

  it("is absent while nothing is attached (AC-54)", async () => {
    await renderLoaded();

    expect(screen.queryByText("SERIALIZES AS")).not.toBeInTheDocument();
    expect(screen.queryByText(/^## Project /)).not.toBeInTheDocument();
  });

  it("groups the documents under one heading per type, in the order of the roots", async () => {
    attached = [INCIDENT, PUB, ARCH, SEC];
    await renderLoaded();

    expect(serializedBox().textContent).toBe(
      [
        "## Project specifications",
        `- ${PUB}`,
        `- ${SEC}`,
        "## Project docs",
        `- ${ARCH}`,
        "## Project insights",
        `- ${INCIDENT}`,
      ].join("\n"),
    );
  });

  it("leaves out the heading of a type nothing is attached from", async () => {
    attached = [ARCH];
    await renderLoaded();

    expect(serializedBox().textContent).toBe(`## Project docs\n- ${ARCH}`);
  });

  it("names a configured root by its folder and puts a path under no root last", async () => {
    const ADR = "adr/0001-record-decisions.md";
    const STRAY = "notes/removed-root.md";
    list = () => json({ roots: ["adr", "docs"], documents: [doc(ADR, "adr", 40), doc(ARCH, "docs", 210)] });
    attached = [STRAY, ARCH, ADR];
    await renderLoaded();

    expect(serializedBox().textContent).toBe(
      ["## Project adr", `- ${ADR}`, "## Project docs", `- ${ARCH}`, "## Project documents", `- ${STRAY}`].join("\n"),
    );
  });

  it("groups by the default folder names when no repository is active", async () => {
    activeRepo = null;
    attached = [ARCH, SEC];
    renderTab();

    await waitFor(() =>
      expect(serializedBox().textContent).toBe(`## Project specifications\n- ${SEC}\n## Project docs\n- ${ARCH}`),
    );
  });

  it("follows a change of the attachment list", async () => {
    attached = [PUB];
    await renderLoaded();

    fireEvent.click(screen.getByRole("checkbox", { name: `Attach ${RATE}` }));

    await waitFor(() =>
      expect(serializedBox().textContent).toBe(`## Project specifications\n- ${PUB}\n- ${RATE}`),
    );
  });
});

describe("Skill Context tab — saving", () => {
  it("sends a ticked document to the skill's context route with the path appended (AC-33)", async () => {
    attached = [PUB];
    await renderLoaded();

    fireEvent.click(screen.getByRole("checkbox", { name: `Attach ${RATE}` }));

    await waitFor(() => expect(puts()).toEqual([{ pathname: "/skills/sk1/context", paths: [PUB, RATE] }]));
  });
});
