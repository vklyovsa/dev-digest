import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RESYNC_POLL_TIMEOUT_MS } from "./blast";
import { useContextRefresh } from "./core";

interface IndexRow {
  lastIndexedSha: string;
  updatedAt: string;
}

const BEFORE: IndexRow = { lastIndexedSha: "aaa111", updatedAt: "2026-10-01T10:00:00Z" };

let indexRow: IndexRow | undefined;
let rejectResync = false;
let polling: boolean | undefined;
const mutate = vi.fn();

vi.mock("./repo-intel", () => ({
  useRepoIntelStatus: (_repoId: string | null | undefined, poll: boolean) => {
    polling = poll;
    return { data: indexRow };
  },
  useResyncRepoIntel: () => ({
    isPending: false,
    mutate: (_vars: undefined, opts?: { onSuccess?: () => void; onError?: () => void }) => {
      mutate();
      if (rejectResync) opts?.onError?.();
      else opts?.onSuccess?.();
    },
  }),
}));

function setup() {
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useContextRefresh("repo1"), { wrapper });
  return { invalidate, ...view };
}

const LIST_KEY = { queryKey: ["context", "repo1"] };
const DOC_KEY = { queryKey: ["context-doc", "repo1"] };

beforeEach(() => {
  mutate.mockReset();
  rejectResync = false;
  polling = undefined;
  indexRow = { ...BEFORE };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useContextRefresh", () => {
  it.each([
    ["updatedAt", { ...BEFORE, updatedAt: "2026-10-01T10:05:00Z" }],
    ["lastIndexedSha", { ...BEFORE, lastIndexedSha: "bbb222" }],
  ])("reads the list again once %s changes (AC-89)", (_field, after) => {
    const { result, invalidate, rerender } = setup();
    expect(result.current.ready).toBe(true);

    act(() => result.current.start());
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(result.current.isRunning).toBe(true);
    expect(polling).toBe(true);

    rerender();
    expect(invalidate).not.toHaveBeenCalled();
    expect(result.current.isRunning).toBe(true);

    indexRow = after;
    rerender();

    const listCalls = invalidate.mock.calls.filter(([filters]) => filters?.queryKey?.[0] === "context");
    expect(listCalls).toEqual([[LIST_KEY]]);
    expect(invalidate).toHaveBeenCalledWith(DOC_KEY);
    expect(result.current.isRunning).toBe(false);
    expect(result.current.timedOut).toBe(false);
    expect(result.current.failed).toBe(false);
    expect(polling).toBe(false);
  });

  it("stops waiting and reports a timeout after 120 seconds without a change (AC-91)", () => {
    vi.useFakeTimers();
    const { result, invalidate } = setup();

    act(() => result.current.start());
    expect(result.current.isRunning).toBe(true);

    act(() => {
      vi.advanceTimersByTime(RESYNC_POLL_TIMEOUT_MS - 1);
    });
    expect(result.current.timedOut).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.timedOut).toBe(true);
    expect(result.current.isRunning).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("reports a rejected request and starts no wait (AC-92)", () => {
    vi.useFakeTimers();
    rejectResync = true;
    const { result, invalidate } = setup();

    act(() => result.current.start());

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(result.current.failed).toBe(true);
    expect(result.current.isRunning).toBe(false);
    expect(polling).toBe(false);

    act(() => {
      vi.advanceTimersByTime(RESYNC_POLL_TIMEOUT_MS);
    });
    expect(result.current.timedOut).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("clears a previous failure and a previous timeout when started again", () => {
    vi.useFakeTimers();
    rejectResync = true;
    const { result } = setup();

    act(() => result.current.start());
    expect(result.current.failed).toBe(true);

    rejectResync = false;
    act(() => result.current.start());
    expect(result.current.failed).toBe(false);
    expect(result.current.isRunning).toBe(true);

    act(() => {
      vi.advanceTimersByTime(RESYNC_POLL_TIMEOUT_MS);
    });
    expect(result.current.timedOut).toBe(true);

    act(() => result.current.start());
    expect(result.current.timedOut).toBe(false);
    expect(result.current.isRunning).toBe(true);
  });

  it("does nothing before the index state has been read", () => {
    indexRow = undefined;
    const { result } = setup();

    expect(result.current.ready).toBe(false);
    act(() => result.current.start());

    expect(mutate).not.toHaveBeenCalled();
    expect(result.current.isRunning).toBe(false);
    expect(result.current.failed).toBe(false);
  });
});
