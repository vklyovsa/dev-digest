export const PERIOD_KINDS = ["1d", "30d", "custom"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

export const DEFAULT_PERIOD = "30d" satisfies PeriodKind;

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export const PERIOD_PARAM = "period";
export const START_PARAM = "start";
export const END_PARAM = "end";
