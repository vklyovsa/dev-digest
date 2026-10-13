import type { FindingCategory, Severity } from "@devdigest/shared";

/*
 * Written out rather than taken from the zod enums: the client's vendored
 * `@devdigest/shared` is a type-only dependency (a value import fails `next build`).
 * The guards turn a contract change into a compile error.
 */
export const SEVERITIES = ["CRITICAL", "WARNING", "SUGGESTION"] as const;
export const CATEGORIES = ["bug", "security", "perf", "style", "test"] as const;

type MissingSeverity = Exclude<Severity, (typeof SEVERITIES)[number]>;
type MissingCategory = Exclude<FindingCategory, (typeof CATEGORIES)[number]>;
const _severities: MissingSeverity extends never ? true : never = true;
const _categories: MissingCategory extends never ? true : never = true;
void _severities;
void _categories;

export const NAME_MAX_LENGTH = 64;
