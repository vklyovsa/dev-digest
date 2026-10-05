"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { PrBriefResponse } from "@devdigest/shared";

export const briefKey = (prId: string | null | undefined) => ["pr-brief", prId] as const;

export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: briefKey(prId),
    queryFn: () => api.get<PrBriefResponse>(`/pulls/${prId}/brief`),
    enabled: !!prId,
    staleTime: 0,
  });
}

export function useGenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrBriefResponse>(`/pulls/${prId}/brief`),
    onSuccess: (data) => qc.setQueryData(briefKey(prId), data),
    meta: { inlineError: true },
  });
}
