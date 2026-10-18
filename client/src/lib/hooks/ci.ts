/* hooks/ci.ts — React Query hooks for Export to CI and CI Runs. The studio never
   calls a model here: it asks the API for the generated files, installs them,
   and pulls finished runs back from GitHub on `sync`. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE, ApiError, api } from "../api";
import type { CiExport, CiExportInputBody, CiFile, CiInstallation, CiRun, CiSyncResult } from "@devdigest/shared";

export const ciKeys = {
  installations: (agentId: string) => ["ci-installations", agentId] as const,
  runs: (agentId: string | "all") => ["ci-runs", agentId] as const,
};

/** Request body of `POST /agents/:id/ci/preview`. */
export type CiPreviewInput = Pick<CiExportInputBody, "repo" | "triggers" | "post_as">;

/** Request body of `POST /agents/:id/export-ci` and `POST /agents/:id/ci/zip`. */
export type CiInstallInput = Pick<CiExportInputBody, "repo" | "triggers" | "post_as" | "workflow_yaml">;

export interface CiPreview {
  files: CiFile[];
}

export function useCiInstallations(agentId: string) {
  return useQuery({
    queryKey: ciKeys.installations(agentId),
    queryFn: () => api.get<CiInstallation[]>(`/agents/${agentId}/ci/installations`),
  });
}

export function useCiRuns(agentId?: string) {
  return useQuery({
    queryKey: ciKeys.runs(agentId ?? "all"),
    queryFn: () => api.get<CiRun[]>(agentId ? `/ci/runs?agent_id=${encodeURIComponent(agentId)}` : "/ci/runs"),
  });
}

export function useCiPreview(agentId: string) {
  return useMutation({
    mutationFn: (input: CiPreviewInput) => api.post<CiPreview>(`/agents/${agentId}/ci/preview`, input),
    meta: { inlineError: true },
  });
}

export function useExportCi(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CiInstallInput) => api.post<CiExport>(`/agents/${agentId}/export-ci`, input),
    meta: { inlineError: true },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ciKeys.installations(agentId) });
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
    },
  });
}

/** `api.ts` parses JSON only, so the zip download is the one raw fetch. */
export function useDownloadCiZip(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CiInstallInput) => {
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/agents/${agentId}/ci/zip`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
      } catch (e) {
        throw new ApiError(
          `Cannot reach the DevDigest engine at ${API_BASE}. Is the API running?`,
          0,
          "network_error",
          e,
        );
      }
      if (!res.ok) {
        let message = `${res.status} ${res.statusText}`;
        let code: string | undefined;
        try {
          const body = await res.json();
          if (body?.error) {
            code = body.error.code;
            message = body.error.message ?? message;
          }
        } catch {
          /* non-JSON error body */
        }
        throw new ApiError(message, res.status, code);
      }
      const url = URL.createObjectURL(await res.blob());
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = "devdigest-ci.zip";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    meta: { inlineError: true },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ciKeys.installations(agentId) });
    },
  });
}

export function useCiSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CiSyncResult>("/ci/sync"),
    meta: { inlineError: true },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
      qc.invalidateQueries({ queryKey: ["ci-installations"] });
    },
  });
}
