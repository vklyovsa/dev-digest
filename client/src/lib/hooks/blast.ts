"use client";

import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BlastHistoryResponse, BlastRadiusResponse } from "@devdigest/shared";
import { api } from "../api";
import { useRepoIntelStatus, useResyncRepoIntel } from "./repo-intel";

export const RESYNC_POLL_TIMEOUT_MS = 120_000;

export const blastKey = (prId: string | null | undefined) => ["blast", prId] as const;
export const blastHistoryKey = (prId: string | null | undefined) => ["blast-history", prId] as const;

/** `staleTime: 0` so returning to Overview re-reads the index. */
export function useBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: blastKey(prId),
    queryFn: () => api.get<BlastRadiusResponse>(`/pulls/${prId}/blast`),
    enabled: !!prId,
    staleTime: 0,
  });
}

/** One GitHub round trip per call server-side, so cache it and do not retry. */
export function useBlastHistory(prId: string | null | undefined) {
  return useQuery({
    queryKey: blastHistoryKey(prId),
    queryFn: () => api.get<BlastHistoryResponse>(`/pulls/${prId}/blast/history`),
    enabled: !!prId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** POST /repos/:id/resync answers 202 before the index is rebuilt, so completion is
    the index row's `lastIndexedSha@updatedAt` advancing, not the mutation resolving. */
export function useBlastResync(
  repoId: string,
  prId: string,
): { start: () => void; isRunning: boolean; timedOut: boolean; ready: boolean } {
  const qc = useQueryClient();
  const [baseline, setBaseline] = React.useState<string | null>(null);
  const [timedOut, setTimedOut] = React.useState(false);
  const status = useRepoIntelStatus(repoId, baseline !== null);
  const resync = useResyncRepoIntel(repoId);
  const stamp = status.data ? `${status.data.lastIndexedSha}@${status.data.updatedAt}` : null;

  React.useEffect(() => {
    if (baseline !== null && stamp !== null && stamp !== baseline) {
      setBaseline(null);
      qc.invalidateQueries({ queryKey: blastKey(prId) });
    }
  }, [baseline, stamp, prId, qc]);

  React.useEffect(() => {
    if (baseline === null) return;
    const timer = setTimeout(() => {
      setBaseline(null);
      setTimedOut(true);
    }, RESYNC_POLL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [baseline]);

  const start = () => {
    const before = stamp;
    if (before === null) return;
    setTimedOut(false);
    resync.mutate(undefined, { onSuccess: () => setBaseline(before) });
  };

  return { start, isRunning: resync.isPending || baseline !== null, timedOut, ready: stamp !== null };
}
