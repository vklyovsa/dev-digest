import type { EvalExpectationType, EvalRun } from "@devdigest/shared";
import type { EvalOwner } from "@/lib/hooks/evals";
import { TREND_METRICS, type TrendMetric } from "./constants";

export type Direction = "up" | "down" | "same";

/** Start time of a run, as `YYYY-MM-DD HH:mm` in the viewer's time zone. Shared by every screen that lists runs. */
export const RUN_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
};

export function formatRunTime(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-CA", { ...RUN_TIME_OPTIONS, timeZone }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

/** A 0..1 metric as a rounded whole percent; null stays null. */
export function toPercent(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100);
}

/** Difference in whole percentage points, taken between the two displayed values; null when either side has none. */
export function deltaPoints(newer: number | null, older: number | null): number | null {
  const a = toPercent(newer);
  const b = toPercent(older);
  return a === null || b === null ? null : a - b;
}

/** Difference of two costs in USD; null when either is unknown. */
export function costDelta(newer: number | null, older: number | null): number | null {
  return newer === null || older === null ? null : newer - older;
}

export function directionOf(delta: number): Direction {
  return delta > 0 ? "up" : delta < 0 ? "down" : "same";
}

export function completedRuns(runs: readonly EvalRun[]): EvalRun[] {
  return runs.filter((r) => r.status === "done");
}

/** Toggles `id`; a third distinct id drops the earliest selected one, so at most two stay. */
export function nextSelection(selected: readonly string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter((s) => s !== id);
  return selected.length >= 2 ? [selected[1]!, id] : [...selected, id];
}

/** The runs a trend plots: completed ones, oldest first. */
export function plottedRuns(runs: readonly EvalRun[]): EvalRun[] {
  return [...completedRuns(runs)].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
}

/** Per metric the non-null values of the plotted runs, oldest first; null when fewer than two. */
export function metricSparklines(runs: readonly EvalRun[]): Record<TrendMetric, number[] | null> {
  const plotted = plottedRuns(runs);
  const result = {} as Record<TrendMetric, number[] | null>;
  for (const { key } of TREND_METRICS) {
    const values = plotted.map((r) => r[key]).filter((v): v is number => v !== null);
    result[key] = values.length >= 2 ? values : null;
  }
  return result;
}

/** How many findings the case expects the agent to produce on its file range. */
export function expectedCount(type: EvalExpectationType): number {
  return type === "must_find" ? 1 : 0;
}

/** A skill as the eval screens need it: its name, and the agent that hosts its runs (null when no agent uses it). */
export interface SkillEvalTarget {
  id: string;
  name: string;
  host: { id: string; name: string } | null;
}

export function skillOwner(skill: SkillEvalTarget): EvalOwner {
  return { kind: "skill", id: skill.id, hostAgentId: skill.host?.id ?? null };
}

/** The id of the hint that explains why a skill's run and try controls are disabled. */
export const EVAL_NO_HOST_HINT_ID = "eval-no-host-hint";
