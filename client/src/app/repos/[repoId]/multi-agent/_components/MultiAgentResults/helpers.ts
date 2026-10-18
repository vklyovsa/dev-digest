import type { AgentColumn } from "@devdigest/shared";
import { formatUsd } from "@/components/run-cost/helpers";
import { formatDuration } from "../../helpers";

export const SEVERITIES = ["CRITICAL", "WARNING", "SUGGESTION", "INFO"] as const;

export type ViewMode = "columns" | "tabs";

export function isKnownSeverity(v: string): v is (typeof SEVERITIES)[number] {
  return (SEVERITIES as readonly string[]).includes(v);
}

export function durationCost(c: Pick<AgentColumn, "duration_ms" | "cost_usd">): string {
  return `${formatDuration(c.duration_ms)} · ${formatUsd(c.cost_usd)}`;
}

export function findingLine(f: { start_line: number; end_line?: number | null }): string {
  return f.end_line != null && f.end_line !== f.start_line ? `${f.start_line}-${f.end_line}` : String(f.start_line);
}

export function groupLabel(g: { file: string; start_line: number; end_line: number }): string {
  return `${g.file}:${findingLine(g)}`;
}

export function startNewReviewHref(repoId: string, prId: string, columns: AgentColumn[]): string {
  const ids = columns.flatMap((c) => (c.agent_id ? [c.agent_id] : []));
  return `/repos/${repoId}/multi-agent/new?pr=${encodeURIComponent(prId)}&agents=${ids.map(encodeURIComponent).join(",")}`;
}
