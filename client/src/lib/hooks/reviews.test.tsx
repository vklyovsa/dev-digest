import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRefreshWhenRunsSettle } from "./reviews";

function setup(initialRunning: boolean) {
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const view = renderHook(({ running }) => useRefreshWhenRunsSettle("pr1", running), {
    wrapper,
    initialProps: { running: initialRunning },
  });
  return { invalidate, rerender: view.rerender };
}

describe("useRefreshWhenRunsSettle", () => {
  it("refreshes runs, reviews and smart-diff when a run settles, and not otherwise", () => {
    const { invalidate, rerender } = setup(true);
    expect(invalidate).not.toHaveBeenCalled();

    rerender({ running: false });
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([["pr-runs", "pr1"], ["reviews", "pr1"], ["smart-diff", "pr1"]]),
    );

    invalidate.mockClear();
    rerender({ running: false });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("does nothing for a PR that was never running", () => {
    const { invalidate, rerender } = setup(false);
    rerender({ running: false });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
