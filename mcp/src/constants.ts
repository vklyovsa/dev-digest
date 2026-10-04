export const RUN_BUDGET_MS_DEFAULT = 100_000;
export const RUN_BUDGET_MS_MIN = 10_000;
export const RUN_BUDGET_MS_MAX = 120_000;
export const REQUEST_TIMEOUT_MS = 15_000;
export const FINAL_READ_TIMEOUT_MS = 5_000;
export const PROGRESS_INTERVAL_MS = 15_000;

export const FINDINGS_LIMIT_DEFAULT = 10;
export const FINDINGS_LIMIT_MAX = 50;
export const FINDINGS_LIMIT_DETAILED_MAX = 15;
export const CONVENTIONS_LIMIT_DEFAULT = 20;
export const CONVENTIONS_LIMIT_MAX = 50;
export const AGENTS_LIMIT = 50;
export const BLAST_SYMBOLS_MAX = 20;
export const HINT_LIST_MAX = 10;

export const CLIP = {
  title: 120,
  path: 160,
  description: 160,
  rule: 300,
  rationale: 400,
  suggestion: 300,
  summary: 400,
  error: 300,
} as const;

export const LABEL_MAX = 24;

export const MAX_RESULT_CHARS = 20_000;
export const TOOLS_LIST_MAX_CHARS = 5_000;
export const INSTRUCTIONS_MAX_CHARS = 600;
