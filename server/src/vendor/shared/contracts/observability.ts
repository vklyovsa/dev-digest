import { z } from 'zod';
import { Severity } from './findings.js';
import { FindingRecord } from './review-api.js';

/**
 * A5 — Observability / Multi-agent contracts (L07).
 *
 * These are NEW contracts (A5 owns this file; the barrel re-exports it). They
 * sit alongside A2's `review-api.ts`:
 *   - MultiAgentRun        the response of POST /pulls/:id/multi-agent-run
 *   - MultiAgentRunRequest / MultiAgentRunLatest / MultiAgentEstimate(s)
 *                          request, latest-run and estimate shapes of the multi-agent routes
 *   - AgentColumn          one agent's column in the multi-agent view
 *   - FindingGroup / ConflictTake  findings of several agents on the same file range
 *   - AgentStats           per-agent quality aggregates (GET /agents/:id/stats)
 *   - CuratorResult        the cross-session memory curator outcome
 *
 * The single-document run trace itself stays in `contracts/trace.ts` (RunTrace).
 */

// ---------------------------------------------------------------------------
// Multi-Agent Review
// ---------------------------------------------------------------------------

/** One agent's result column in the multi-agent review. */
export const AgentColumn = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  agent_name: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(['running', 'done', 'failed', 'cancelled']),
  error: z.string().nullable(),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings: z.array(FindingRecord),
});
export type AgentColumn = z.infer<typeof AgentColumn>;

/** One agent's stance on a contended file range. */
export const ConflictTake = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  agent_name: z.string(),
  finding_ids: z.array(z.string()),
  /** Severity if the agent flagged it, or 'ignored' when it did not. */
  verdict: z.union([Severity, z.literal('ignored')]),
  note: z.string(),
});
export type ConflictTake = z.infer<typeof ConflictTake>;

/**
 * A group = findings of one or more agents on overlapping lines of a file.
 * `conflict` is true when the agents disagree (one flagged it and another that
 * also reviewed did not, or severities diverge). Computed, not stored.
 */
export const FindingGroup = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  title: z.string(),
  conflict: z.boolean(),
  takes: z.array(ConflictTake),
});
export type FindingGroup = z.infer<typeof FindingGroup>;

/** Response of POST /pulls/:id/multi-agent-run and GET /multi-agent-runs/:id. */
export const MultiAgentRun = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullable(),
  pr_title: z.string().nullable(),
  ran_at: z.string(),
  agent_count: z.number().int(),
  total_duration_ms: z.number().int(),
  total_cost_usd: z.number().nullable(),
  columns: z.array(AgentColumn),
  groups: z.array(FindingGroup),
});
export type MultiAgentRun = z.infer<typeof MultiAgentRun>;

export const MultiAgentRunRequest = z.object({
  agent_ids: z.array(z.string().uuid()).min(1),
});
export type MultiAgentRunRequest = z.infer<typeof MultiAgentRunRequest>;

export const MultiAgentRunLatest = z.object({ run: MultiAgentRun.nullable() });
export type MultiAgentRunLatest = z.infer<typeof MultiAgentRunLatest>;

export const MultiAgentEstimate = z.object({
  agent_id: z.string(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type MultiAgentEstimate = z.infer<typeof MultiAgentEstimate>;

export const MultiAgentEstimates = z.object({ estimates: z.array(MultiAgentEstimate) });
export type MultiAgentEstimates = z.infer<typeof MultiAgentEstimates>;

// ---------------------------------------------------------------------------
// Per-agent Stats (GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/** A single (date, value) point for a sparkline/trend. */
export const StatPoint = z.object({ label: z.string(), value: z.number() });
export type StatPoint = z.infer<typeof StatPoint>;

export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  /** accept-rate is the headline quality signal. 0..1 over acted findings. */
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  /** recent runs for a small trend chart (oldest→newest). */
  trend: z.array(StatPoint),
});
export type AgentStats = z.infer<typeof AgentStats>;

// ---------------------------------------------------------------------------
// Cross-session memory curator
// ---------------------------------------------------------------------------

/** A merge the curator performed (or would perform in dry-run). */
export const CuratorMerge = z.object({
  kept_id: z.string(),
  merged_ids: z.array(z.string()),
  content: z.string(),
  similarity: z.number(),
});
export type CuratorMerge = z.infer<typeof CuratorMerge>;

export const CuratorResult = z.object({
  scanned: z.number().int(),
  merges: z.array(CuratorMerge),
  removed: z.number().int(),
  dry_run: z.boolean(),
});
export type CuratorResult = z.infer<typeof CuratorResult>;
