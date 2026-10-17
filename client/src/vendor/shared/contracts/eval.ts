import { z } from 'zod';
import { FindingCategory, Severity } from './findings.js';
import { EvalOwnerKind } from './knowledge.js';

/**
 * Eval pipeline contracts — cases, runs, comparison and the dashboard.
 *
 * `EvalOwnerKind` stays in `knowledge.ts`; everything else about an eval lives
 * here so the two `@devdigest/shared` copies can hold this file byte for byte.
 */

const Metric = z.number().min(0).max(1).nullable();

export const EvalExpectationType = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectationType = z.infer<typeof EvalExpectationType>;

/** Severity and category are plain strings: `findings.severity` is a free-text column. */
export const EvalExpectedOutput = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  severity: z.string(),
  category: z.string(),
  title: z.string(),
});
export type EvalExpectedOutput = z.infer<typeof EvalExpectedOutput>;

export const EvalInputMeta = z.object({
  pr_number: z.number().int().nullable(),
  pr_title: z.string(),
  pr_author: z.string().nullable(),
  pr_body: z.string().nullable(),
});
export type EvalInputMeta = z.infer<typeof EvalInputMeta>;

export const EvalOutcomeStatus = z.enum(['pass', 'fail', 'error']);
export type EvalOutcomeStatus = z.infer<typeof EvalOutcomeStatus>;

export const EvalCaseLastResult = z.object({
  run_id: z.string(),
  status: EvalOutcomeStatus,
  matched: z.number().int(),
  error: z.string().nullable(),
});
export type EvalCaseLastResult = z.infer<typeof EvalCaseLastResult>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  expectation_type: EvalExpectationType,
  expected_output: EvalExpectedOutput,
  input_diff: z.string(),
  input_files: z.array(z.string()),
  input_meta: EvalInputMeta,
  source_finding_id: z.string().nullable(),
  notes: z.string().nullable(),
  revision: z.number().int().min(1),
  created_at: z.string(),
  last_result: EvalCaseLastResult.nullable(),
});
export type EvalCase = z.infer<typeof EvalCase>;

const NotBlank = z.string().refine((v) => v.trim().length > 0);

export const EvalCaseExpectationInput = z
  .object({
    file: NotBlank,
    start_line: z.number().int().min(1),
    end_line: z.number().int(),
    title: z.string().default(''),
    severity: z.union([Severity, z.literal('')]).default(''),
    category: z.union([FindingCategory, z.literal('')]).default(''),
  })
  .refine((v) => v.end_line >= v.start_line, { path: ['end_line'] });
export type EvalCaseExpectationInput = z.infer<typeof EvalCaseExpectationInput>;

export const EvalCaseUpdateInput = z.object({
  name: z.string().trim().min(1).max(64),
  input_diff: NotBlank,
  input_meta: z.object({
    pr_title: z.string().default(''),
    pr_body: z.string().nullable(),
  }),
  expected_output: EvalCaseExpectationInput,
});
export type EvalCaseUpdateInput = z.infer<typeof EvalCaseUpdateInput>;

export const EvalCaseCreateInput = EvalCaseUpdateInput.extend({
  expectation_type: EvalExpectationType,
});
export type EvalCaseCreateInput = z.infer<typeof EvalCaseCreateInput>;

export const EvalDraftProblem = z.enum(['file_not_in_diff', 'lines_outside_diff']);
export type EvalDraftProblem = z.infer<typeof EvalDraftProblem>;

export const EvalCaseDraft = z.object({
  expectation_type: EvalExpectationType,
  name: z.string(),
  input_diff: z.string(),
  input_meta: z.object({
    pr_number: z.number().int(),
    pr_title: z.string(),
    pr_author: z.string(),
    pr_body: z.string().nullable(),
  }),
  expected_output: EvalExpectedOutput,
  problem: EvalDraftProblem.nullable(),
});
export type EvalCaseDraft = z.infer<typeof EvalCaseDraft>;

export const EvalCaseDraftResponse = z.object({
  agent: z.object({ id: z.string(), name: z.string() }),
  case: EvalCase.nullable(),
  draft: EvalCaseDraft.nullable(),
});
export type EvalCaseDraftResponse = z.infer<typeof EvalCaseDraftResponse>;

export const EvalCaseTryInput = z.object({
  expectation_type: EvalExpectationType,
  input_diff: NotBlank,
  input_meta: EvalInputMeta,
  expected_output: z
    .object({
      file: NotBlank,
      start_line: z.number().int().min(1),
      end_line: z.number().int(),
    })
    .refine((v) => v.end_line >= v.start_line, { path: ['end_line'] }),
});
export type EvalCaseTryInput = z.infer<typeof EvalCaseTryInput>;

export const EvalRunStatus = z.enum(['running', 'done', 'failed']);
export type EvalRunStatus = z.infer<typeof EvalRunStatus>;

export const EvalOutcomeFinding = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  severity: z.string(),
  category: z.string(),
  title: z.string(),
});
export type EvalOutcomeFinding = z.infer<typeof EvalOutcomeFinding>;

export const EvalCaseTryResult = z.object({
  status: EvalOutcomeStatus,
  matched: z.number().int(),
  findings: z.array(EvalOutcomeFinding),
  error: z.string().max(500).nullable(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
});
export type EvalCaseTryResult = z.infer<typeof EvalCaseTryResult>;

export const EvalCaseOutcome = z.object({
  case_id: z.string(),
  case_name: z.string(),
  case_revision: z.number().int().min(1),
  expectation_type: EvalExpectationType,
  status: EvalOutcomeStatus,
  matched: z.number().int(),
  findings: z.array(EvalOutcomeFinding),
  error: z.string().nullable(),
});
export type EvalCaseOutcome = z.infer<typeof EvalCaseOutcome>;

/** The run record as the list and the dashboard return it — no per-case outcomes. */
export const EvalRun = z.object({
  id: z.string(),
  agent_id: z.string(),
  agent_version: z.number().int(),
  skill_id: z.string().nullable(),
  skill_version: z.number().int().nullable(),
  status: EvalRunStatus,
  started_at: z.string(),
  duration_ms: z.number().int().nullable(),
  recall: Metric,
  precision: Metric,
  citation_accuracy: Metric,
  cases_total: z.number().int(),
  cases_passed: z.number().int(),
  cases_failed: z.number().int(),
  cases_errored: z.number().int(),
  findings_total: z.number().int(),
  findings_grounded: z.number().int(),
  cost_usd: z.number().nullable(),
  provider: z.string(),
  model: z.string(),
  skills: z.array(z.string()),
  case_ids: z.array(z.string()),
  error: z.string().nullable(),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalRunDetail = EvalRun.extend({ results: z.array(EvalCaseOutcome) });
export type EvalRunDetail = z.infer<typeof EvalRunDetail>;

export const EvalCompareSide = z.object({
  run_id: z.string(),
  agent_version: z.number().int(),
  system_prompt: z.string(),
  provider: z.string(),
  model: z.string(),
  skills: z.array(z.string()),
  started_at: z.string(),
  recall: Metric,
  precision: Metric,
  citation_accuracy: Metric,
  cost_usd: z.number().nullable(),
  cases_total: z.number().int(),
  cases_passed: z.number().int(),
});
export type EvalCompareSide = z.infer<typeof EvalCompareSide>;

export const EvalRunCompare = z.object({
  base: EvalCompareSide,
  head: EvalCompareSide,
  cases_only_in_base: z.array(z.string()),
  cases_only_in_head: z.array(z.string()),
  cases_edited: z.array(z.string()),
});
export type EvalRunCompare = z.infer<typeof EvalRunCompare>;

export const EvalSkillRunStartInput = z.object({ host_agent_id: z.string().uuid() });
export type EvalSkillRunStartInput = z.infer<typeof EvalSkillRunStartInput>;

export const EvalSkillCaseTryInput = EvalCaseTryInput.extend({ host_agent_id: z.string().uuid() });
export type EvalSkillCaseTryInput = z.infer<typeof EvalSkillCaseTryInput>;

export const EvalSkillCompareSide = z.object({
  run_id: z.string(),
  skill_version: z.number().int(),
  skill_body: z.string(),
  agent_id: z.string(),
  agent_version: z.number().int(),
  provider: z.string(),
  model: z.string(),
  started_at: z.string(),
  recall: Metric,
  precision: Metric,
  citation_accuracy: Metric,
  cost_usd: z.number().nullable(),
  cases_total: z.number().int(),
  cases_passed: z.number().int(),
});
export type EvalSkillCompareSide = z.infer<typeof EvalSkillCompareSide>;

export const EvalSkillRunCompare = z.object({
  base: EvalSkillCompareSide,
  head: EvalSkillCompareSide,
  cases_only_in_base: z.array(z.string()),
  cases_only_in_head: z.array(z.string()),
  cases_edited: z.array(z.string()),
});
export type EvalSkillRunCompare = z.infer<typeof EvalSkillRunCompare>;

export const EvalDashboardAgent = z.object({
  agent_id: z.string(),
  name: z.string(),
  model: z.string(),
  latest_run: EvalRun.nullable(),
  case_count: z.number().int().nonnegative(),
  run_in_progress: z.boolean(),
  trend: z
    .array(z.object({ recall: Metric, precision: Metric, citation_accuracy: Metric }))
    .max(20),
});
export type EvalDashboardAgent = z.infer<typeof EvalDashboardAgent>;

export const EvalDashboard = z.object({
  agents: z.array(EvalDashboardAgent),
  recent_runs: z.array(EvalRun.extend({ agent_name: z.string() })),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;
