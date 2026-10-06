import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { BlastRadius, Intent, IntentConfidence, IntentSource, PrBrief, PrHistory, SmartDiff } from './brief.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run. The
 * persisted reviews are also returned once the (synchronous) run completes.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

/** Intent persisted for a PR: the Intent plus confidence, sources, the model
    used and the derived usage/cost — everything the Intent card renders. */
export const PrIntentRecord = Intent.extend({
  pr_id: z.string(),
  risk_areas: z.array(z.string()),
  confidence: IntentConfidence,
  sources: z.array(IntentSource),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  head_sha: z.string().nullable(),
  derived_at: z.string(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  /** True when the stored intent no longer matches the PR's current head_sha. */
  stale: z.boolean(),
});
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

/** Response of GET/POST .../intent (derive) — null before the first derivation. */
export const PrIntentResponse = z.object({ intent: PrIntentRecord.nullable() });
export type PrIntentResponse = z.infer<typeof PrIntentResponse>;

/** A stored PR Brief with its generation metadata. `stale` is computed on every
    read and not stored; `cost_usd` is null for a model without a price. */
export const PrBriefRecord = PrBrief.extend({
  pr_id: z.string(),
  head_sha: z.string(),
  stale: z.boolean(),
  provider: z.string(),
  model: z.string(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  cost_usd: z.number().nullable(),
  documents_read: z.array(z.string()),
});
export type PrBriefRecord = z.infer<typeof PrBriefRecord>;

/** Response of GET/POST .../brief — null on GET when no brief is stored. */
export const PrBriefResponse = z.object({ brief: PrBriefRecord.nullable() });
export type PrBriefResponse = z.infer<typeof PrBriefResponse>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;

export const BlastDegradedReason = z.enum([
  'flag_off',
  'index_failed',
  'index_partial',
  'repo_too_large',
  'no_data',
]);
export type BlastDegradedReason = z.infer<typeof BlastDegradedReason>;

export const BlastTotals = z.object({
  symbols: z.number().int().nonnegative(),
  callers: z.number().int().nonnegative(),
  endpoints: z.number().int().nonnegative(),
  crons: z.number().int().nonnegative(),
});
export type BlastTotals = z.infer<typeof BlastTotals>;

export const BlastCallerFileFacts = z.object({
  file: z.string(),
  endpoints: z.array(z.string()),
  crons: z.array(z.string()),
});
export type BlastCallerFileFacts = z.infer<typeof BlastCallerFileFacts>;

/** Response of GET /pulls/:id/blast — a superset of BlastRadius. */
export const BlastRadiusResponse = BlastRadius.extend({
  totals: BlastTotals,
  degraded: z.boolean(),
  reason: BlastDegradedReason.nullable(),
  max_callers_per_symbol: z.number().int().positive(),
  indexed_sha: z.string().nullable(),
  changed_files_count: z.number().int().nonnegative(),
  caller_file_facts: z.array(BlastCallerFileFacts),
});
export type BlastRadiusResponse = z.infer<typeof BlastRadiusResponse>;

export const BlastHistoryUnavailableReason = z.enum(['no_token', 'github_error', 'no_changed_files']);
export type BlastHistoryUnavailableReason = z.infer<typeof BlastHistoryUnavailableReason>;

/** Response of GET /pulls/:id/blast/history — a superset of PrHistory. */
export const BlastHistoryResponse = PrHistory.extend({
  available: z.boolean(),
  unavailable_reason: BlastHistoryUnavailableReason.nullable(),
});
export type BlastHistoryResponse = z.infer<typeof BlastHistoryResponse>;
