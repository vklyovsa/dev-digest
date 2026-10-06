import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import skills from "../../../../../messages/en/skills.json";
import context from "../../../../../messages/en/context.json";
import { ToastProvider } from "@/lib/toast";

const push = vi.fn();
const replace = vi.fn();
let id = "sk-1";
let search = new URLSearchParams("tab=preview");
vi.mock("next/navigation", () => ({
  useParams: () => ({ id }),
  useRouter: () => ({ push, replace }),
  useSearchParams: () => search,
}));

const SKILL: Skill = {
  id: "sk-1",
  name: "repo-conventions",
  description: "Flags changes that violate the house conventions.",
  type: "convention",
  source: "extracted",
  body: "# repo-conventions",
  enabled: true,
  version: 1,
  evidence_files: null,
  agent_count: 1,
};
let list: Skill[] = [SKILL];
vi.mock("@/lib/hooks/skills", async () => ({
  ...(await vi.importActual<typeof import("@/lib/hooks/skills")>("@/lib/hooks/skills")),
  useSkills: () => ({ data: list, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "r1", full_name: "acme/payments-api" }, reposLoaded: true }),
}));

// The detail has its own tests; the pane tests below see a stub of it, except the
// Context tab ones, which need the real tab bar and the real tab behind it.
let realDetail = false;
vi.mock("../SkillDetail", async () => {
  const actual = await vi.importActual<typeof import("../SkillDetail")>("../SkillDetail");
  return {
    SkillDetail: (props: { skill: Skill; tab: string; onTab: (t: string) => void; onDeleted: () => void }) =>
      realDetail ? (
        <actual.SkillDetail {...props} />
      ) : (
        <div>
          <span>detail:{props.skill.name}</span>
          <span>tab:{props.tab}</span>
          <button onClick={() => props.onTab("versions")}>switch tab</button>
        </div>
      ),
  };
});

import { SkillDetailPane } from "./SkillDetailPane";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const { pathname } = new URL(String(input));
  if (pathname === "/repos/r1/context") return json({ roots: ["specs"], documents: [] });
  if (pathname === "/skills/sk-1/context") return json({ paths: [] });
  throw new Error(`unexpected request ${pathname}`);
});

function renderPane() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ skills, context }}>
        <ToastProvider>
          <SkillDetailPane />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockClear();
  realDetail = false;
  push.mockClear();
  replace.mockClear();
  id = "sk-1";
  search = new URLSearchParams("tab=preview");
  list = [SKILL];
});

describe("SkillDetailPane", () => {
  it("opens the skill from the path on the tab from the query", () => {
    renderPane();
    expect(screen.getByText("detail:repo-conventions")).toBeInTheDocument();
    expect(screen.getByText("tab:preview")).toBeInTheDocument();
  });

  it("hands the detail the context tab instead of falling back to Config (AC-29)", () => {
    search = new URLSearchParams("tab=context");
    renderPane();
    expect(screen.getByText("tab:context")).toBeInTheDocument();
  });

  it("keeps the tab in the address when it changes", () => {
    renderPane();
    fireEvent.click(screen.getByRole("button", { name: "switch tab" }));
    expect(replace).toHaveBeenCalledWith("/skills/sk-1?tab=versions");
  });

  it("says the skill is gone instead of rendering an empty pane", () => {
    id = "deleted-elsewhere";
    renderPane();
    expect(screen.getByText("Skill not found")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /all skills/i }));
    expect(push).toHaveBeenCalledWith("/skills");
  });
});

describe("SkillDetailPane — Context tab", () => {
  beforeEach(() => {
    realDetail = true;
  });

  const tabLabels = () =>
    Array.from(screen.getByRole("button", { name: "Config" }).parentElement!.children).map((b) => b.textContent);

  it("is the second tab, after Config (AC-81)", () => {
    renderPane();
    expect(tabLabels().slice(0, 2)).toEqual(["Config", "Context"]);
  });

  it("replaces the address with tab=context when the tab is clicked (AC-81)", () => {
    renderPane();
    fireEvent.click(screen.getByRole("button", { name: "Context" }));
    expect(replace).toHaveBeenCalledWith("/skills/sk-1?tab=context");
  });

  it("shows the Context tab for ?tab=context (AC-29)", () => {
    search = new URLSearchParams("tab=context");
    renderPane();
    expect(screen.getByRole("heading", { name: context.skillTab.title })).toBeInTheDocument();
  });
});
