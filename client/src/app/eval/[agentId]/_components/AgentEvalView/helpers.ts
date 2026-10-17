import type { EvalRun, EvalRunDetail } from "@devdigest/shared";
import { deltaPoints } from "@/components/eval-runs";

/**
 * Precision fell from the previous completed run to the latest one. The size is
 * taken between the two displayed whole percents, so a dip that rounds to zero
 * is no dip.
 */
export function precisionDip(
  latest: EvalRun | null,
  previous: EvalRun | null,
): { points: number; version: number } | null {
  if (!latest || !previous) return null;
  const delta = deltaPoints(latest.precision, previous.precision);
  if (delta === null || delta >= 0) return null;
  return { points: -delta, version: latest.agent_version };
}

/** Names of the `must_not_flag` cases that fail in `latest` and passed in `previous`. */
export function newlyFailingMustNotFlag(
  latest: EvalRunDetail | undefined,
  previous: EvalRunDetail | undefined,
): string[] {
  if (!latest || !previous) return [];
  const passedBefore = new Set(
    previous.results.filter((r) => r.expectation_type === "must_not_flag" && r.status === "pass").map((r) => r.case_id),
  );
  return latest.results
    .filter((r) => r.expectation_type === "must_not_flag" && r.status === "fail" && passedBefore.has(r.case_id))
    .map((r) => r.case_name);
}
