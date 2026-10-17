/* hooks/evals.ts — React Query hooks for the eval pipeline: cases, runs,
   comparison and the dashboard. Scoring happens on the server; nothing here
   calls a model. */
"use client";

import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalCase,
  EvalCaseCreateInput,
  EvalCaseDraftResponse,
  EvalCaseTryInput,
  EvalCaseTryResult,
  EvalCaseUpdateInput,
  EvalDashboard,
  EvalRun,
  EvalRunCompare,
  EvalRunDetail,
  EvalSkillCaseTryInput,
  EvalSkillRunCompare,
  EvalSkillRunStartInput,
} from "@devdigest/shared";

export const EVAL_RUN_POLL_MS = 3000;
const RUN_LIST_LIMIT = 20;

/** Whose cases and runs a hook reads. A bare string is an agent id. `hostAgentId` rides along on a skill's run and try calls and is never part of a key. */
export type EvalOwner =
  | { kind: "agent"; id: string }
  | { kind: "skill"; id: string; hostAgentId: string | null };

type EvalOwnerInput = string | EvalOwner;

function ownerOf(input: EvalOwnerInput | null | undefined): EvalOwner | null {
  if (!input) return null;
  return typeof input === "string" ? { kind: "agent", id: input } : input;
}

const ownerPath = (owner: EvalOwner) =>
  owner.kind === "skill" ? `/skills/${owner.id}` : `/agents/${owner.id}`;

const ownerCasesKey = (owner: EvalOwner | null) =>
  owner ? evalKeys.cases(owner.id, owner.kind) : evalKeys.cases("");

const ownerRunsKey = (owner: EvalOwner | null) =>
  owner ? evalKeys.runs(owner.id, owner.kind) : evalKeys.runs("");

export const evalKeys = {
  cases: (id: string, kind: EvalOwner["kind"] = "agent") =>
    kind === "skill" ? (["eval-cases", "skill", id] as const) : (["eval-cases", id] as const),
  runs: (id: string, kind: EvalOwner["kind"] = "agent") =>
    kind === "skill" ? (["eval-runs", "skill", id] as const) : (["eval-runs", id] as const),
  run: (runId: string) => ["eval-run", runId] as const,
  compare: (agentId: string, base: string, head: string) =>
    ["eval-compare", agentId, base, head] as const,
  skillCompare: (skillId: string, base: string, head: string) =>
    ["eval-compare", "skill", skillId, base, head] as const,
  dashboard: () => ["eval-dashboard"] as const,
};

/** Read the draft of a case from a finding. A click-time read, never cached. */
export function useEvalCaseDraft() {
  return useMutation({
    mutationFn: (findingId: string) =>
      api.get<EvalCaseDraftResponse>(`/findings/${findingId}/eval-case-draft`),
    meta: { inlineError: true },
  });
}

/** Save the edited draft of a finding as an eval case; `created` is false when the finding already had one. */
export function useSaveEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ findingId, body }: { findingId: string; body: EvalCaseUpdateInput }) => {
      const { status, data } = await api.postWithStatus<EvalCase>(
        `/findings/${findingId}/eval-case`,
        body
      );
      return { case: data, created: status === 201 };
    },
    meta: { inlineError: true },
    onSuccess: ({ case: evalCase }) => {
      qc.invalidateQueries({ queryKey: evalKeys.cases(evalCase.owner_id) });
    },
  });
}

/** One model call on the form's current content; nothing is stored, so nothing is invalidated. */
export function useTryEvalCase(input: EvalOwnerInput) {
  const owner = ownerOf(input)!;
  return useMutation({
    mutationFn: (body: EvalCaseTryInput) => {
      const payload: EvalCaseTryInput | EvalSkillCaseTryInput =
        owner.kind === "skill"
          ? ({ ...body, host_agent_id: owner.hostAgentId } as unknown as EvalSkillCaseTryInput)
          : body;
      return api.post<EvalCaseTryResult>(`${ownerPath(owner)}/eval-cases/try`, payload);
    },
    meta: { inlineError: true },
  });
}

/** Create a case by hand for an agent or a skill; the server stores the diff exactly as sent. */
export function useCreateManualEvalCase(input: EvalOwnerInput) {
  const qc = useQueryClient();
  const owner = ownerOf(input)!;
  return useMutation({
    mutationFn: (body: EvalCaseCreateInput) =>
      api.post<EvalCase>(`${ownerPath(owner)}/eval-cases`, body),
    meta: { inlineError: true },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ownerCasesKey(owner) });
    },
  });
}

export function useUpdateEvalCase(input: EvalOwnerInput) {
  const qc = useQueryClient();
  const owner = ownerOf(input)!;
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: EvalCaseUpdateInput }) =>
      api.put<EvalCase>(`/eval-cases/${id}`, body),
    meta: { inlineError: true },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ownerCasesKey(owner) });
    },
  });
}

export function useEvalCases(input: EvalOwnerInput | null | undefined) {
  const owner = ownerOf(input);
  return useQuery({
    queryKey: ownerCasesKey(owner),
    queryFn: () => api.get<EvalCase[]>(`${ownerPath(owner!)}/eval-cases`),
    enabled: !!owner?.id,
  });
}

export function useDeleteEvalCase(input: EvalOwnerInput) {
  const qc = useQueryClient();
  const owner = ownerOf(input)!;
  return useMutation({
    mutationFn: (caseId: string) => api.del<{ ok: boolean }>(`/eval-cases/${caseId}`),
    meta: { inlineError: true },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ownerCasesKey(owner) });
    },
  });
}

/** Newest 20 runs. Polls while the newest one runs; when it settles, the data that depends on it is read again. */
export function useEvalRuns(input: EvalOwnerInput | null | undefined) {
  const qc = useQueryClient();
  const owner = ownerOf(input);
  const ownerId = owner?.id;
  const kind = owner?.kind;
  const query = useQuery({
    queryKey: ownerRunsKey(owner),
    queryFn: () => api.get<EvalRun[]>(`${ownerPath(owner!)}/eval-runs`),
    enabled: !!ownerId,
    refetchInterval: (q) => (q.state.data?.[0]?.status === "running" ? EVAL_RUN_POLL_MS : false),
  });

  const head = query.data?.[0];
  const seen = React.useRef<{ id: string; status: EvalRun["status"] } | null>(null);
  React.useEffect(() => {
    const before = seen.current;
    seen.current = head ? { id: head.id, status: head.status } : null;
    if (!ownerId || !kind || !head || !before) return;
    if (before.id === head.id && before.status === "running" && head.status !== "running") {
      qc.invalidateQueries({ queryKey: evalKeys.cases(ownerId, kind) });
      if (kind === "agent") qc.invalidateQueries({ queryKey: evalKeys.dashboard() });
      qc.invalidateQueries({ queryKey: evalKeys.run(head.id) });
    }
  }, [ownerId, kind, head, qc]);

  return query;
}

/** Starts a run; the 202 record goes to the head of the run list so the running state shows at once. */
export function useStartEvalRun(input: EvalOwnerInput) {
  const qc = useQueryClient();
  const owner = ownerOf(input)!;
  return useMutation({
    mutationFn: () => {
      const path = `${ownerPath(owner)}/eval-runs`;
      if (owner.kind === "agent") return api.post<EvalRun>(path);
      const body = { host_agent_id: owner.hostAgentId } as unknown as EvalSkillRunStartInput;
      return api.post<EvalRun>(path, body);
    },
    meta: { inlineError: true },
    onSuccess: (run) => {
      qc.setQueryData<EvalRun[]>(ownerRunsKey(owner), (old) =>
        [run, ...(old ?? []).filter((r) => r.id !== run.id)].slice(0, RUN_LIST_LIMIT),
      );
    },
  });
}

export function useEvalRun(runId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.run(runId ?? ""),
    queryFn: () => api.get<EvalRunDetail>(`/eval-runs/${runId}`),
    enabled: !!runId,
  });
}

export function useEvalCompare(
  agentId: string | null | undefined,
  base: string | null | undefined,
  head: string | null | undefined,
) {
  return useQuery({
    queryKey: evalKeys.compare(agentId ?? "", base ?? "", head ?? ""),
    queryFn: () =>
      api.get<EvalRunCompare>(
        `/agents/${agentId}/eval-runs/compare?base=${encodeURIComponent(base!)}&head=${encodeURIComponent(head!)}`,
      ),
    enabled: !!agentId && !!base && !!head,
  });
}

/** Two runs of one skill, side by side; idle until all three ids are known. */
export function useSkillEvalCompare(
  skillId: string | null | undefined,
  base: string | null | undefined,
  head: string | null | undefined,
) {
  return useQuery({
    queryKey: evalKeys.skillCompare(skillId ?? "", base ?? "", head ?? ""),
    queryFn: () =>
      api.get<EvalSkillRunCompare>(
        `/skills/${skillId}/eval-runs/compare?base=${encodeURIComponent(base!)}&head=${encodeURIComponent(head!)}`,
      ),
    enabled: !!skillId && !!base && !!head,
  });
}

export function useEvalDashboard() {
  return useQuery({
    queryKey: evalKeys.dashboard(),
    queryFn: () => api.get<EvalDashboard>("/eval/dashboard"),
    refetchInterval: (q) =>
      q.state.data?.agents.some((a) => a.run_in_progress) ? EVAL_RUN_POLL_MS : false,
  });
}

export type AgentRunStart = { agentId: string; ok: boolean; message: string | null };

/** Starts a run for each agent; one refusal does not stop the others. */
export function useStartEvalRunsForAgents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (agentIds: string[]): Promise<AgentRunStart[]> => {
      const settled = await Promise.allSettled(
        agentIds.map((id) => api.post<EvalRun>(`/agents/${id}/eval-runs`)),
      );
      return settled.map((r, i) => ({
        agentId: agentIds[i]!,
        ok: r.status === "fulfilled",
        message:
          r.status === "fulfilled"
            ? null
            : r.reason instanceof Error
              ? r.reason.message
              : String(r.reason),
      }));
    },
    onSettled: (_data, _err, agentIds) => {
      qc.invalidateQueries({ queryKey: evalKeys.dashboard() });
      for (const id of agentIds ?? []) qc.invalidateQueries({ queryKey: evalKeys.runs(id) });
    },
  });
}
