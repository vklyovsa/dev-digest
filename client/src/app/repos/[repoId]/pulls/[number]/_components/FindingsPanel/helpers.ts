import type { FindingRecord, Severity } from "@devdigest/shared";
import { severityRank } from "@/components/findings-summary";
import { LOW_CONFIDENCE_THRESHOLD } from "./constants";

/** Everything the panel considers at all — the confidence gate only. */
export function confidentFindings(findings: FindingRecord[], hideLow: boolean): FindingRecord[] {
  return hideLow ? findings.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD) : findings;
}

/**
 * What the list actually renders: the confidence-gated set, optionally narrowed
 * to one severity, worst severity first.
 *
 * The severity pills count `confidentFindings`, i.e. the SAME set this filters
 * from — that is what keeps "3 CRITICAL" equal to the number of cards a click
 * on that pill leaves behind, and makes the pills follow the hide-low toggle.
 */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  severity: Severity | null = null,
): FindingRecord[] {
  const confident = confidentFindings(findings, hideLow);
  const shown = severity ? confident.filter((f) => f.severity === severity) : confident;
  return [...shown].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}
