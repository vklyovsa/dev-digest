/**
 * Delay before retry number `attempt` (1-based): exponential from `baseMs`,
 * capped at `maxMs`, optionally jittered into the upper half of the window so
 * a burst of clients does not retry in lockstep.
 */
export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  jitter?: boolean;
  random?: () => number;
}

export function backoffDelay(attempt: number, opts: BackoffOptions = {}): number {
  const base = opts.baseMs ?? 250;
  const max = opts.maxMs ?? 8_000;
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError(`attempt must be a positive integer, got ${attempt}`);
  }
  const exponential = Math.min(max, base * 2 ** (attempt - 1));
  if (!opts.jitter) return exponential;
  const random = opts.random ?? Math.random;
  return Math.round(exponential / 2 + random() * (exponential / 2));
}
