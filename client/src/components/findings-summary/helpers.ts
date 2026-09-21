import type { Severity, SeverityCount } from "@devdigest/shared";

/**
 * Worst-first severity order, mirroring the `Severity` enum in
 * `@devdigest/shared`. Written out rather than derived from the Zod enum
 * because the client imports the contracts as TYPES only — pulling the schema
 * value in would drag zod into the browser bundle.
 */
export const SEVERITY_ORDER: readonly Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

/** Sort weight; an unknown severity sorts last instead of jumping to the top. */
export function severityRank(severity: string): number {
  const i = SEVERITY_ORDER.indexOf(severity as Severity);
  return i === -1 ? SEVERITY_ORDER.length : i;
}

/**
 * Group findings by severity, worst first, omitting the severities that are
 * absent — that is what keeps a "0 CRITICAL" pill off the screen. Plain
 * counting: no request, no model call.
 */
export function countBySeverity(findings: readonly { severity: Severity }[]): SeverityCount[] {
  const tally = new Map<Severity, number>();
  for (const f of findings) tally.set(f.severity, (tally.get(f.severity) ?? 0) + 1);
  return [...tally.entries()]
    .map(([severity, count]) => ({ severity, count }))
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

/** How many previews the hover popover shows before it says "+N more". */
export const PREVIEW_LIMIT = 5;
