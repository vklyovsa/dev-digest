import type { MultiAgentEstimate } from "@devdigest/shared";

export interface EstimateTotal {
  durationMs: number;
  costUsd: number;
}

/** Longest duration and summed cost over the checked agents that have an estimate. */
export function estimateTotal(
  checked: Iterable<string>,
  estimates: Map<string, MultiAgentEstimate>,
): EstimateTotal {
  let durationMs = 0;
  let costUsd = 0;
  for (const id of checked) {
    const e = estimates.get(id);
    if (!e || e.duration_ms == null) continue;
    durationMs = Math.max(durationMs, e.duration_ms);
    costUsd += e.cost_usd ?? 0;
  }
  return { durationMs, costUsd };
}
