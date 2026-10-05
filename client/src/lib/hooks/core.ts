/* hooks/core.ts — typed React Query hooks over the F1 API (contracts):
   settings, secrets, repos, pulls, and project context. Scaffolding screens use
   these; feature-domain hooks live in the sibling files (agents/reviews/trace/…)
   and are re-exported alongside these from hooks/index.ts. */
"use client";

import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { RESYNC_POLL_TIMEOUT_MS } from "./blast";
import { useRepoIntelStatus, useResyncRepoIntel } from "./repo-intel";
import type {
  Settings,
  SettingsUpdate,
  ConnTestProvider,
  ConnTestResult,
  SecretsStatus,
  Repo,
  PrMeta,
  PrDetail,
  ContextDocumentList,
  SpecDocument,
} from "../types";

// ---- Settings (F1: GET/PUT /settings, POST /settings/test-connection) ----
export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<Settings>("/settings"),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsUpdate) => api.put<Settings>("/settings", patch),
    onSuccess: (data) => qc.setQueryData(["settings"], data),
  });
}

export function useTestConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConnTestProvider | { provider: ConnTestProvider; key?: string }) => {
      const body = typeof input === "string" ? { provider: input } : input;
      return api.post<ConnTestResult>("/settings/test-connection", body);
    },
    // Saving/validating a provider key can change which models resolve — drop the
    // cached (possibly empty) model lists so the agent picker refetches, and
    // refresh the "Configured / Not set" key-status badges.
    onSuccess: (res) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: ["provider-models"] });
        qc.invalidateQueries({ queryKey: ["secrets-status"] });
      }
    },
  });
}

/** Which provider keys are configured (booleans only — never the values). */
export function useSecretsStatus() {
  return useQuery({
    queryKey: ["secrets-status"],
    queryFn: () => api.get<SecretsStatus>("/settings/secrets-status"),
    staleTime: 30_000,
  });
}

// ---- Repos (F1: GET/POST /repos, refresh, delete) ----
export function useRepos() {
  return useQuery({
    queryKey: ["repos"],
    queryFn: () => api.get<Repo[]>("/repos"),
  });
}

export function useAddRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => api.post<Repo>("/repos", { url }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });
}

export function useRefreshRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.post<Repo>(`/repos/${repoId}/refresh`),
    onSuccess: (_d, repoId) => {
      qc.invalidateQueries({ queryKey: ["repos"] });
      qc.invalidateQueries({ queryKey: ["pulls", repoId] });
    },
  });
}

export function useDeleteRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.del<{ deleted: string }>(`/repos/${repoId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });
}

// ---- Pull requests (F1: GET /repos/:id/pulls, GET /pulls/:id) ----
export function usePulls(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["pulls", repoId],
    queryFn: () => api.get<PrMeta[]>(`/repos/${repoId}/pulls`),
    enabled: !!repoId,
    // Auto-refresh PR statuses: re-sync from GitHub every 60s while the page is
    // open, and whenever the window regains focus.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function usePullDetail(prId: string | number | null | undefined) {
  return useQuery({
    queryKey: ["pull", prId],
    queryFn: () => api.get<PrDetail>(`/pulls/${prId}`),
    enabled: prId != null,
  });
}

// ---- Project Context (GET /repos/:id/context, GET /repos/:id/context/document) ----
/** Every Markdown document of the repository, with its `agent_count` and the roots searched. */
export function useContextFiles(repoId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["context", repoId],
    queryFn: () => api.get<ContextDocumentList>(`/repos/${repoId}/context`),
    enabled: !!repoId && enabled,
  });
}

/** One document's full text; the server answers 404 for a path outside the list. */
export function useContextDocument(
  repoId: string | null | undefined,
  path: string | null | undefined,
) {
  return useQuery({
    queryKey: ["context-doc", repoId, path],
    queryFn: () =>
      api.get<SpecDocument>(`/repos/${repoId}/context/document?path=${encodeURIComponent(path ?? "")}`),
    enabled: !!repoId && !!path,
  });
}

/** POST /repos/:id/resync answers 202 before the index is rebuilt, so the list is read again
    when the index row's `lastIndexedSha@updatedAt` differs from the one read before the request. */
export function useContextRefresh(repoId: string | null | undefined): {
  start: () => void;
  isRunning: boolean;
  timedOut: boolean;
  failed: boolean;
  ready: boolean;
} {
  const qc = useQueryClient();
  const [baseline, setBaseline] = React.useState<string | null>(null);
  const [timedOut, setTimedOut] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const status = useRepoIntelStatus(repoId, baseline !== null);
  const resync = useResyncRepoIntel(repoId);
  const stamp = status.data ? `${status.data.lastIndexedSha}@${status.data.updatedAt}` : null;

  React.useEffect(() => {
    if (baseline !== null && stamp !== null && stamp !== baseline) {
      setBaseline(null);
      qc.invalidateQueries({ queryKey: ["context", repoId] });
      qc.invalidateQueries({ queryKey: ["context-doc", repoId] });
    }
  }, [baseline, stamp, repoId, qc]);

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
    setFailed(false);
    resync.mutate(undefined, {
      onSuccess: () => setBaseline(before),
      onError: () => setFailed(true),
    });
  };

  return {
    start,
    isRunning: resync.isPending || baseline !== null,
    timedOut,
    failed,
    ready: stamp !== null,
  };
}
