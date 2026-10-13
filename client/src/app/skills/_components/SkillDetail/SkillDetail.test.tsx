import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import skills from "../../../../../messages/en/skills.json";
import common from "../../../../../messages/en/common.json";
import { ToastProvider } from "@/lib/toast";
import { SkillDetail } from "./SkillDetail";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "sk-1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const SKILL: Skill = {
  id: "sk-1",
  name: "repo-conventions",
  description: "d",
  type: "convention",
  source: "extracted",
  body: "# repo-conventions",
  enabled: true,
  version: 1,
  evidence_files: null,
  agent_count: 1,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
const onDeleted = vi.fn();

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ skills, common }}>
        <ToastProvider>
          <SkillDetail skill={SKILL} tab="preview" onTab={vi.fn()} onDeleted={onDeleted} />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_input, init) => {
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return json([]);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  onDeleted.mockClear();
});

const deletes = () => fetchMock.mock.calls.filter(([, i]) => i?.method === "DELETE");

describe("SkillDetail", () => {
  it("has six tabs with Evals between Preview and Stats (AC-37)", () => {
    renderDetail();
    const labels = Array.from(screen.getByRole("button", { name: "Config" }).parentElement!.children).map(
      (b) => b.textContent,
    );
    expect(labels).toEqual(["Config", "Context", "Preview", "Evals", "Stats", "Versions"]);
  });

  it("says in the delete confirmation that the eval cases and runs go too, and deletes only on Confirm (AC-36)", async () => {
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Delete skill" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/eval cases and eval runs are deleted/i);
    expect(deletes()).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete skill" }));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(new URL(String(deletes()[0]![0])).pathname).toBe("/skills/sk-1");
  });
});
