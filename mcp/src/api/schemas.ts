import { z } from 'zod';

/*
 * Hand-mirrored slices of the server's wire contracts, keeping only the fields this
 * package reads; unknown keys are stripped, drift surfaces as an ApiError 'shape'.
 * Paths are under server/src/ — nothing is imported from vendor/shared on purpose
 * (its strict Severity enum would reject the free-text findings.severity column).
 *
 *   ApiAgent            Agent              vendor/shared/contracts/knowledge.ts
 *   ApiRepo             Repo               vendor/shared/contracts/platform.ts
 *   ApiPull             PrMeta             vendor/shared/contracts/platform.ts
 *   ApiActiveRun        row of GET /pulls/:id/runs/active   modules/reviews/repository/run.repo.ts
 *   ApiStartReview      ReviewRunResponse  vendor/shared/contracts/review-api.ts
 *   ApiRunSummary       RunSummary         vendor/shared/contracts/trace.ts
 *   ApiReview           ReviewDto          modules/reviews/helpers.ts
 *   ApiFinding          ReviewDtoFinding   modules/reviews/helpers.ts (severity widened to string)
 *   ApiConventionsPage  ConventionsPage    vendor/shared/contracts/knowledge.ts
 *   ApiBlastRadius      BlastRadiusResponse  vendor/shared/contracts/review-api.ts (reason widened to string)
 *   ApiErrorBody        error envelope     app.ts setErrorHandler
 */

export const ApiAgent = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  model: z.string(),
  enabled: z.boolean(),
});
export type ApiAgent = z.infer<typeof ApiAgent>;

export const ApiRepo = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
});
export type ApiRepo = z.infer<typeof ApiRepo>;

export const ApiPull = z.object({
  id: z.string().uuid().nullish(),
  number: z.number().int(),
  title: z.string(),
});
export type ApiPull = z.infer<typeof ApiPull>;

export const ApiActiveRun = z.object({
  run_id: z.string().uuid(),
  agent_id: z.string().uuid().nullable(),
  agent_name: z.string().nullable(),
  ran_at: z.string().nullable(),
});
export type ApiActiveRun = z.infer<typeof ApiActiveRun>;

export const ApiStartReview = z.object({
  runs: z.array(
    z.object({
      run_id: z.string().uuid(),
      agent_id: z.string().uuid(),
      agent_name: z.string(),
    }),
  ),
});
export type ApiStartReview = z.infer<typeof ApiStartReview>;

export const ApiRunSummary = z.object({
  run_id: z.string().uuid(),
  agent_id: z.string().uuid().nullable(),
  agent_name: z.string().nullable(),
  model: z.string().nullable(),
  status: z.string().nullable(),
  error: z.string().nullable(),
  duration_ms: z.number().nullable(),
  cost_usd: z.number().nullable(),
  ran_at: z.string().nullable(),
  score: z.number().nullable(),
  blockers: z.number().nullable(),
});
export type ApiRunSummary = z.infer<typeof ApiRunSummary>;

export const ApiFinding = z.object({
  id: z.string().uuid(),
  severity: z.string(),
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  rationale: z.string(),
  suggestion: z.string().nullish(),
  confidence: z.number(),
  dismissed_at: z.string().nullable(),
});
export type ApiFinding = z.infer<typeof ApiFinding>;

export const ApiReview = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid().nullable(),
  verdict: z.string().nullable(),
  summary: z.string().nullable(),
  score: z.number().nullable(),
  model: z.string().nullable(),
  created_at: z.string(),
  findings: z.array(ApiFinding),
});
export type ApiReview = z.infer<typeof ApiReview>;

export const ApiConvention = z.object({
  id: z.string().uuid(),
  category: z.string(),
  rule: z.string(),
  rationale: z.string().nullish(),
  status: z.string(),
  confidence: z.number(),
  evidence_path: z.string(),
  evidence_line_start: z.number().int().nullish(),
  evidence_line_end: z.number().int().nullish(),
});
export type ApiConvention = z.infer<typeof ApiConvention>;

export const ApiConventionsPage = z.object({
  scan: z
    .object({
      started_at: z.string(),
      finished_at: z.string().nullish(),
    })
    .nullable(),
  candidates: z.array(ApiConvention),
});
export type ApiConventionsPage = z.infer<typeof ApiConventionsPage>;

export const ApiBlastRadius = z.object({
  changed_symbols: z.array(z.object({ name: z.string() })),
  downstream: z.array(
    z.object({
      symbol: z.string(),
      callers: z.array(z.object({ file: z.string(), line: z.number().int() })),
      endpoints_affected: z.array(z.string()),
      crons_affected: z.array(z.string()),
    }),
  ),
  summary: z.string(),
  totals: z.object({
    symbols: z.number(),
    callers: z.number(),
    endpoints: z.number(),
    crons: z.number(),
  }),
  degraded: z.boolean(),
  reason: z.string().nullable(),
  max_callers_per_symbol: z.number().int(),
  changed_files_count: z.number().int(),
});
export type ApiBlastRadius = z.infer<typeof ApiBlastRadius>;

export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string().optional(),
    message: z.string().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
