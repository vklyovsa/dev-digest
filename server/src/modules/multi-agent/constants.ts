/** Severity weight for ranking; any value outside the contract ranks 0. */
export const SEVERITY_RANK: Record<string, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };

export const START_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };
