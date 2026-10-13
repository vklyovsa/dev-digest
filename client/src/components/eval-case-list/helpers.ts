import type { EvalCase } from "@devdigest/shared";

/** P / R of the "P / R passing" badge: R = cases that have a last result, P = those that passed. */
export function passingCounts(cases: readonly EvalCase[]): { passed: number; run: number } {
  const ran = cases.filter((c) => c.last_result !== null);
  return { passed: ran.filter((c) => c.last_result?.status === "pass").length, run: ran.length };
}
