"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { SmartDiffResponse } from "@devdigest/shared";

export const smartDiffKey = (prId: string | null | undefined) => ["smart-diff", prId] as const;

export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: smartDiffKey(prId),
    queryFn: () => api.get<SmartDiffResponse>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
    staleTime: 0,
  });
}
