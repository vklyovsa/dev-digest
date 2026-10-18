import type { CiFailOn } from "@devdigest/shared";

export const FAIL_ON_OPTIONS = ["critical", "warning", "never"] as const satisfies readonly CiFailOn[];

export const HISTORY_LIMIT = 20;
