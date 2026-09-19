import { scoreFromFindings } from '@devdigest/reviewer-core';
import { Severity, type FindingsSummary, type SeverityCount } from '@devdigest/shared';

/**
 * Severity roll-up for the PR list's FINDINGS and SCORE columns. Pure and
 * hermetic: the numbers are a group-by over findings that are already
 * persisted, never a model call and never a per-row query.
 *
 * Both columns are fed from the SAME set — every open (non-dismissed) finding
 * of the PR — so a row can never show a score that contradicts the severities
 * beside it.
 */

/** Worst-first, straight from the contract enum so a new severity flows in. */
const SEVERITY_ORDER: readonly string[] = Severity.options;

/** How many previews the popover gets; the rest is implied by `total`. */
export const PREVIEW_LIMIT = 5;

/** The finding columns the summary needs — a row shape, not a DB dependency. */
export interface SummarizableFinding {
  id: string;
  severity: string;
  category: string;
  title: string;
  file: string;
  startLine: number;
  endLine: number;
  confidence: number;
  rationale: string;
}

function rank(severity: string): number {
  const i = SEVERITY_ORDER.indexOf(severity);
  // An unknown severity sorts last rather than jumping to the front.
  return i === -1 ? SEVERITY_ORDER.length : i;
}

/**
 * Group a PR's findings by severity and pick the previews. `counts` lists only
 * the severities present (worst first), so the UI cannot render a
 * "0 CRITICAL" pill.
 */
export function summarizeFindings(findings: SummarizableFinding[]): FindingsSummary {
  const tally = new Map<string, number>();
  for (const f of findings) tally.set(f.severity, (tally.get(f.severity) ?? 0) + 1);

  const counts: SeverityCount[] = [...tally.entries()]
    .map(([severity, count]) => ({ severity, count }) as SeverityCount)
    .sort((a, b) => rank(a.severity) - rank(b.severity));

  const previews = [...findings]
    .sort((a, b) => rank(a.severity) - rank(b.severity) || b.confidence - a.confidence)
    .slice(0, PREVIEW_LIMIT)
    .map((f) => ({
      id: f.id,
      severity: f.severity as SeverityCount['severity'],
      category: f.category as FindingsSummary['previews'][number]['category'],
      title: f.title,
      file: f.file,
      start_line: f.startLine,
      end_line: f.endLine,
      confidence: f.confidence,
      rationale: f.rationale,
    }));

  return { total: findings.length, counts, previews };
}

/**
 * The PR's 0–100 score, derived from the very findings the FINDINGS column
 * shows: `scoreFromFindings` in `@devdigest/reviewer-core` (100 − 35 per
 * critical, 12 per warning, 3 per suggestion).
 *
 * Deliberately NOT the score of the latest review row: a multi-agent review
 * writes one review per agent, so "latest" is whichever agent happened to
 * finish last. The engine's table is the only definition of severity weight in
 * the repo — never re-implement it here.
 */
export function scoreForFindings(findings: SummarizableFinding[]): number {
  // The DB column is free text, so a stray value can reach here; the engine's
  // penalty lookup is `?? 0`, i.e. an unknown severity costs no points.
  return scoreFromFindings(findings.map((f) => ({ severity: f.severity as Severity })));
}
