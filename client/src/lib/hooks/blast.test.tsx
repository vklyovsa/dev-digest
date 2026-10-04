import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RESYNC_POLL_TIMEOUT_MS, useBlastResync } from "./blast";

interface IndexRow {
  lastIndexedSha: string;
  updatedAt: string;
}

let indexRow: IndexRow | undefined;
const mutate = vi.fn();

vi.mock("./repo-intel", () => ({
  useRepoIntelStatus: () => ({ data: indexRow }),
  useResyncRepoIntel: () => ({
    isPending: false,
    mutate: (_vars: undefined, opts?: { onSuccess?: () => void }) => {
      mutate();
      opts?.onSuccess?.();
    },
  }),
}));

function setup() {
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useBlastResync("repo1", "pr1"), { wrapper });
  return { invalidate, ...view };
}

beforeEach(() => {
  mutate.mockReset();
  indexRow = { lastIndexedSha: "aaa111", updatedAt: "2026-10-01T10:00:00Z" };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useBlastResync", () => {
  it("refreshes the map only once the index stamp advances", () => {
    const { result, invalidate, rerender } = setup();
    expect(result.current.ready).toBe(true);
    expect(result.current.isRunning).toBe(false);

    act(() => result.current.start());
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(result.current.isRunning).toBe(true);

    rerender();
    expect(invalidate).not.toHaveBeenCalled();
    expect(result.current.isRunning).toBe(true);

    indexRow = { lastIndexedSha: "aaa111", updatedAt: "2026-10-01T10:05:00Z" };
    rerender();

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["blast", "pr1"] });
    expect(result.current.isRunning).toBe(false);
    expect(result.current.timedOut).toBe(false);
  });

  it("gives up after the timeout when the stamp never advances", () => {
    vi.useFakeTimers();
    const { result, invalidate } = setup();

    act(() => result.current.start());
    expect(result.current.isRunning).toBe(true);

    act(() => {
      vi.advanceTimersByTime(RESYNC_POLL_TIMEOUT_MS);
    });

    expect(result.current.timedOut).toBe(true);
    expect(result.current.isRunning).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("clears a previous timeout when started again", () => {
    vi.useFakeTimers();
    const { result } = setup();

    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(RESYNC_POLL_TIMEOUT_MS);
    });
    expect(result.current.timedOut).toBe(true);

    act(() => result.current.start());
    expect(result.current.timedOut).toBe(false);
    expect(result.current.isRunning).toBe(true);
  });

  it("does nothing before the index state has loaded", () => {
    indexRow = undefined;
    const { result } = setup();

    expect(result.current.ready).toBe(false);
    act(() => result.current.start());

    expect(mutate).not.toHaveBeenCalled();
    expect(result.current.isRunning).toBe(false);
  });
});
