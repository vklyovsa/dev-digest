import type { AgentPerfRow } from "@devdigest/shared";
import { formatUsd } from "@/components/run-cost/helpers";
import { DAY_MS, DEFAULT_PERIOD, END_PARAM, PERIOD_PARAM, START_PARAM } from "./constants";

export type Period =
  | { kind: "1d" }
  | { kind: "30d" }
  | { kind: "custom"; start: string; end: string };

export type CustomError = "inverted" | "future";

export type SortDir = "asc" | "desc";

type SortableRow = Pick<AgentPerfRow, "agent_name" | "accept_rate" | "small_sample">;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isRealDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

export function localToday(nowMs: number): string {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function validateCustom(start: string, end: string, today: string): CustomError | null {
  if (end < start) return "inverted";
  if (end > today) return "future";
  return null;
}

export function parsePeriod(search: URLSearchParams, today: string): Period {
  const kind = search.get(PERIOD_PARAM);
  if (kind === "1d") return { kind: "1d" };
  if (kind === "custom") {
    const start = search.get(START_PARAM);
    const end = search.get(END_PARAM);
    if (
      start &&
      end &&
      isRealDate(start) &&
      isRealDate(end) &&
      validateCustom(start, end, today) === null
    ) {
      return { kind: "custom", start, end };
    }
  }
  return { kind: DEFAULT_PERIOD };
}

function startOfLocalDay(date: string, plusDays = 0): Date {
  const m = DATE_RE.exec(date)!;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + plusDays);
}

export function periodRange(period: Period, nowMs: number): { from: string; to: string } {
  switch (period.kind) {
    case "1d":
      return { from: new Date(nowMs - DAY_MS).toISOString(), to: new Date(nowMs).toISOString() };
    case "30d":
      return {
        from: new Date(nowMs - 30 * DAY_MS).toISOString(),
        to: new Date(nowMs).toISOString(),
      };
    case "custom":
      return {
        from: startOfLocalDay(period.start).toISOString(),
        to: startOfLocalDay(period.end, 1).toISOString(),
      };
  }
}

export function periodSearch(period: Period): string {
  if (period.kind === "custom") {
    return `${PERIOD_PARAM}=custom&${START_PARAM}=${period.start}&${END_PARAM}=${period.end}`;
  }
  return `${PERIOD_PARAM}=${period.kind}`;
}

export function sortByAcceptRate<T extends SortableRow>(rows: readonly T[], dir: SortDir): T[] {
  const rated = (r: T) => !r.small_sample && r.accept_rate !== null;
  const sign = dir === "asc" ? 1 : -1;
  const head = rows
    .filter(rated)
    .sort((a, b) => sign * ((a.accept_rate as number) - (b.accept_rate as number)));
  const tail = rows.filter((r) => !rated(r)).sort((a, b) => {
    if (a.accept_rate === null && b.accept_rate !== null) return 1;
    if (a.accept_rate !== null && b.accept_rate === null) return -1;
    if (a.accept_rate !== null && b.accept_rate !== null && a.accept_rate !== b.accept_rate) {
      return b.accept_rate - a.accept_rate;
    }
    return (a.agent_name ?? "").localeCompare(b.agent_name ?? "");
  });
  return [...head, ...tail];
}

export function formatCost(usd: number | null | undefined): string {
  if (usd == null || Number.isNaN(usd)) return formatUsd(usd);
  const abs = Math.abs(usd);
  const d = abs < 0.01 && usd !== 0 ? 4 : abs < 1 && usd !== 0 ? 3 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(usd);
}
