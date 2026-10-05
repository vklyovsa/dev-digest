import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrBriefRecord, PrBriefResponse } from "@devdigest/shared";
import { createQueryClient } from "../providers";
import { notify } from "../toast";
import { ApiError } from "../api";
import { briefKey, useGenerateBrief, usePrBrief } from "./brief";
import { useDeriveIntent } from "./intent";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const BRIEF: PrBriefRecord = {
  pr_id: "pr1",
  head_sha: "abc123",
  stale: false,
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  tokens_in: 1200,
  tokens_out: 300,
  cost_usd: 0.0013,
  documents_read: [],
  summary: "Adds a refund limit.",
  review_focus: [{ file: "src/refund.ts", line: 4, reason: "New limit check." }],
  risks: { risks: [] },
  intent: null,
  blast: null,
};

const fetchMock = vi.fn();
let qc: QueryClient;
let toast: MockInstance<typeof notify.error>;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  toast = vi.spyOn(notify, "error").mockImplementation(() => {});
  qc = createQueryClient();
});

afterEach(() => {
  toast.mockRestore();
  vi.unstubAllGlobals();
  qc.clear();
});

describe("useGenerateBrief", () => {
  it("rejects with the server's message and leaves the global error toast alone", async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: "external_service_error", message: "model answered nothing" } }, 502),
    );
    const { result } = renderHook(() => useGenerateBrief("pr1"), { wrapper });

    let caught: unknown;
    await act(async () => {
      caught = await result.current.mutateAsync().catch((e: unknown) => e);
    });

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).message).toBe("model answered nothing");
    expect((caught as ApiError).status).toBe(502);
    expect(toast).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves the answer under briefKey in the cache", async () => {
    fetchMock.mockResolvedValue(json({ brief: BRIEF }));
    const { result } = renderHook(() => useGenerateBrief("pr1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(qc.getQueryData<PrBriefResponse>(briefKey("pr1"))).toEqual({ brief: BRIEF });
    expect(fetchMock.mock.calls[0]![0]).toMatch(/\/pulls\/pr1\/brief$/);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "POST" });
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("usePrBrief", () => {
  it("reads the stored brief with a GET and no POST", async () => {
    fetchMock.mockResolvedValue(json({ brief: BRIEF }));
    const { result } = renderHook(() => usePrBrief("pr1"), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual({ brief: BRIEF }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]?.method).toBeUndefined();
  });
});

describe("the global mutation toast", () => {
  it("still fires once for a mutation that does not opt out", async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: "external_service_error", message: "model answered nothing" } }, 502),
    );
    const { result } = renderHook(() => useDeriveIntent("pr1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith("model answered nothing");
  });
});
