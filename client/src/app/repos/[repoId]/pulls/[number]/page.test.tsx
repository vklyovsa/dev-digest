import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const replace = vi.fn();
let search: URLSearchParams;
let diffProps: { target?: { file: string | null; line: string | null } } | undefined;

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1", number: "7" }),
  useRouter: () => ({ replace }),
  useSearchParams: () => search,
}));

vi.mock("@/lib/hooks/core", () => ({
  usePulls: () => ({ data: [{ id: "pr1", number: 7 }], isLoading: false }),
  usePullDetail: () => ({
    data: { number: 7, body: "", head_sha: "abc1234", status: "open", commits: [], files: [] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: [] }),
  usePrActiveRuns: () => ({ data: [] }),
  usePrRuns: () => ({ data: [] }),
  useDeleteRun: () => ({ mutate: vi.fn() }),
  useCancelRun: () => ({ mutate: vi.fn() }),
  useRefreshWhenRunsSettle: () => undefined,
  invalidatePrFindings: vi.fn(),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/payments-api" } }),
  useRepoNotFound: () => false,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("./_components/PrDetailHeader", () => ({
  PrDetailHeader: ({ onSetTab }: { onSetTab: (tab: string) => void }) => (
    <div>
      <button onClick={() => onSetTab("overview")}>to overview</button>
      <button onClick={() => onSetTab("diff")}>to diff</button>
    </div>
  ),
}));
vi.mock("./_components/OverviewTab", () => ({ OverviewTab: () => <div>overview tab</div> }));
vi.mock("./_components/FindingsTab", () => ({ FindingsTab: () => <div>findings tab</div> }));
vi.mock("./_components/RunTraceDrawer", () => ({ default: () => null }));
vi.mock("./_components/DiffTab", () => ({
  DiffTab: (props: NonNullable<typeof diffProps>) => {
    diffProps = props;
    return <div>diff tab</div>;
  },
}));

import PRDetailPage from "./page";

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PRDetailPage />
    </QueryClientProvider>,
  );
}

const lastUrl = () => String(replace.mock.calls.at(-1)?.[0]);

beforeEach(() => {
  replace.mockReset();
  diffProps = undefined;
});

afterEach(cleanup);

describe("PR page — Files changed target", () => {
  it("hands the file and line of the URL to the Files changed tab", () => {
    search = new URLSearchParams("tab=diff&file=a.ts&line=3");
    renderPage();

    expect(screen.getByText("diff tab")).toBeInTheDocument();
    expect(diffProps?.target).toEqual({ file: "a.ts", line: "3" });
  });

  it("hands over nulls when the URL carries no file", () => {
    search = new URLSearchParams("tab=diff");
    renderPage();

    expect(diffProps?.target).toEqual({ file: null, line: null });
  });

  it("passes no target on another tab", () => {
    search = new URLSearchParams("tab=overview&file=a.ts&line=3");
    renderPage();

    expect(screen.getByText("overview tab")).toBeInTheDocument();
    expect(screen.queryByText("diff tab")).not.toBeInTheDocument();
    expect(diffProps).toBeUndefined();
  });

  it("drops file and line from the URL when the reviewer picks a tab", () => {
    search = new URLSearchParams("tab=diff&file=a.ts&line=3&trace=run1");
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "to overview" }));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(lastUrl()).toBe("/repos/r1/pulls/7?tab=overview&trace=run1");
    expect(lastUrl()).not.toMatch(/file=|line=/);

    fireEvent.click(screen.getByRole("button", { name: "to diff" }));
    expect(replace).toHaveBeenCalledTimes(2);
    expect(lastUrl()).toBe("/repos/r1/pulls/7?tab=diff&trace=run1");
    expect(lastUrl()).not.toMatch(/file=|line=/);
  });
});
