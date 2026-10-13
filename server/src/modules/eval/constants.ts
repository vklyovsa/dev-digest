export const EVAL_CASE_SLUG_MAX = 34;

export const EVAL_RUN_LIST_LIMIT = 20;
export const EVAL_RECENT_RUNS_LIMIT = 6;

export const EVAL_RUN_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

export const EVAL_INTERRUPTED_ERROR = 'interrupted';

export const EVAL_ERROR = {
  findingUndecided: 'finding_undecided',
  ownerMissing: 'eval_owner_missing',
  expectationOutsideDiff: 'expectation_outside_diff',
  noCases: 'eval_no_cases',
  providerUnavailable: 'eval_provider_unavailable',
  runInProgress: 'eval_run_in_progress',
  runsNotComparable: 'eval_runs_not_comparable',
  caseNotStored: 'eval_case_not_stored',
  diffInvalid: 'eval_diff_invalid',
  hostAgentMissing: 'eval_host_agent_missing',
} as const;
