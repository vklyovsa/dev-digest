/* hooks/multi-agent.ts — Multi-Agent Review: start a run, read one, the newest
   one of a repo, and the per-agent estimates. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  MultiAgentEstimates,
  MultiAgentRun,
  MultiAgentRunLatest,
} from "@devdigest/shared";
import { invalidatePrFindings } from "./reviews";

export const multiAgentRunKey = (id: string | null | undefined) => ["multi-agent-run", id] as const;

const POLL_WHILE_RUNNING_MS = 4000;

export function useMultiAgentRun(id: string | null | undefined) {
  return useQuery({
    queryKey: multiAgentRunKey(id),
    queryFn: () => api.get<MultiAgentRun>(`/multi-agent-runs/${id}`),
    enabled: !!id,
    refetchInterval: (q) =>
      q.state.data?.columns.some((c) => c.status === "running") ? POLL_WHILE_RUNNING_MS : false,
  });
}

export function useLatestMultiAgentRun(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent-latest", repoId],
    queryFn: () => api.get<MultiAgentRunLatest>(`/repos/${repoId}/multi-agent-runs/latest`),
    enabled: !!repoId,
  });
}

export function useMultiAgentEstimates() {
  return useQuery({
    queryKey: ["multi-agent-estimates"],
    queryFn: () => api.get<MultiAgentEstimates>("/multi-agent-runs/estimates"),
  });
}

export function useStartMultiAgentRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentIds }: { prId: string; agentIds: string[] }) =>
      api.post<MultiAgentRun>(`/pulls/${prId}/multi-agent-run`, { agent_ids: agentIds }),
    onSuccess: (run, { prId }) => {
      qc.setQueryData(multiAgentRunKey(run.id), run);
      qc.invalidateQueries({ queryKey: ["multi-agent-latest"] });
      invalidatePrFindings(qc, prId);
    },
  });
}
