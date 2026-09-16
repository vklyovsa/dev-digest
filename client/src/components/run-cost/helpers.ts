/** Shown wherever a run carries no cost: unpriced model, or a run that predates
 *  cost tracking. Deliberately not "$0.00" — that is a real, different value. */
export const NO_COST = "—";

/**
 * USD cost for display. The decimal count scales with the magnitude because a
 * single fixed precision is wrong at both ends: two decimals turn every cheap
 * run into "$0.00", four make a dollar-sized run unreadable.
 */
export function formatUsd(cost: number | null | undefined): string {
  if (cost == null || Number.isNaN(cost)) return NO_COST;
  if (cost === 0) return "$0.00";
  const abs = Math.abs(cost);
  const decimals = abs < 0.01 ? 4 : abs < 1 ? 3 : 2;
  return `$${cost.toFixed(decimals)}`;
}

/** Total tokens of a run, or null when the run never reported any. */
export function totalTokens(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): number | null {
  if (tokensIn == null && tokensOut == null) return null;
  return (tokensIn ?? 0) + (tokensOut ?? 0);
}
