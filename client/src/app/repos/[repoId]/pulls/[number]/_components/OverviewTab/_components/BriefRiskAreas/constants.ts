import type { RiskSeverity } from "@devdigest/shared";

/** Not read off the `RiskSeverity` zod enum: client contracts are type-only, and a value import fails `next build`. The guard below breaks the typecheck when the contract gains a level. */
export const RISK_SEVERITIES = ["high", "medium", "low"] as const;

type MissingSeverity = Exclude<RiskSeverity, (typeof RISK_SEVERITIES)[number]>;
const _exhaustive: MissingSeverity extends never ? true : never = true;
void _exhaustive;

export const RISK_SEVERITY_COLOR: Record<(typeof RISK_SEVERITIES)[number], string> = {
  high: "var(--crit)",
  medium: "var(--warn)",
  low: "var(--info)",
};
