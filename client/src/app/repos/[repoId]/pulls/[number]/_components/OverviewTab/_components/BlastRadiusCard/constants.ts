import type { BlastDegradedReason, BlastHistoryUnavailableReason, BlastTotals } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

export const BLAST_VIEWS = ["tree", "graph"] as const;
export type BlastView = (typeof BLAST_VIEWS)[number];

export const STAT_ITEMS = [
  { key: "symbols", icon: "Code" },
  { key: "callers", icon: "CornerDownRight" },
  { key: "endpoints", icon: "Globe" },
  { key: "crons", icon: "Clock" },
] as const satisfies readonly { key: keyof BlastTotals; icon: IconName }[];

/**
 * Written out rather than read off the zod enums: the client's vendored
 * `@devdigest/shared` is a TYPE-only dependency (a value import type-checks
 * and passes vitest, then fails `next build`). The guards below turn a new
 * contract value into a compile error instead of a missing message key.
 */
export const DEGRADED_REASONS = ["flag_off", "index_failed", "index_partial", "repo_too_large", "no_data"] as const;

type MissingDegradedReason = Exclude<BlastDegradedReason, (typeof DEGRADED_REASONS)[number]>;
const _degradedExhaustive: MissingDegradedReason extends never ? true : never = true;
void _degradedExhaustive;

export const HISTORY_UNAVAILABLE_REASONS = ["no_token", "github_error", "no_changed_files"] as const;

type MissingHistoryReason = Exclude<BlastHistoryUnavailableReason, (typeof HISTORY_UNAVAILABLE_REASONS)[number]>;
const _historyExhaustive: MissingHistoryReason extends never ? true : never = true;
void _historyExhaustive;

export const GRAPH_NODE_KINDS = ["symbol", "caller", "endpoint", "cron"] as const;
export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number];

export const GRAPH_MAX_SYMBOLS = 6;
export const GRAPH_MAX_CALLERS = 12;
export const GRAPH_MAX_FACTS = 12;
export const GRAPH_WIDTH = 600;
export const GRAPH_NODE_WIDTH = 156;
export const GRAPH_NODE_HEIGHT = 28;
export const GRAPH_ROW_GAP = 12;
export const GRAPH_PADDING = 12;
export const GRAPH_LABEL_MAX_CHARS = 20;

export const NODE_STYLE: Record<GraphNodeKind, { stroke: string; text: string }> = {
  symbol: { stroke: "var(--accent)", text: "var(--text-primary)" },
  caller: { stroke: "var(--border-strong)", text: "var(--text-primary)" },
  endpoint: { stroke: "var(--accent)", text: "var(--accent-text)" },
  cron: { stroke: "var(--warn)", text: "var(--warn)" },
};

export const HISTORY_FILES_SHOWN = 3;
