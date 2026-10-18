import type { CiRun } from "@devdigest/shared";

const STATUS_KEYS: Record<string, "succeeded" | "noFindings" | "failed" | "running"> = {
  succeeded: "succeeded",
  no_findings: "noFindings",
  failed: "failed",
  running: "running",
};

/** Message key under `runs.status` for a stored status, or null for an unknown one. */
export function statusKey(status: CiRun["status"]) {
  return status ? (STATUS_KEYS[status] ?? null) : null;
}

export function statusColor(status: CiRun["status"]): string {
  if (status === "failed") return "var(--crit)";
  if (status === "succeeded" || status === "no_findings") return "var(--ok)";
  return "var(--text-muted)";
}

export const formatCost = (cost: number | null | undefined) =>
  cost == null ? "—" : `$${cost.toFixed(4)}`;

export const formatRanAt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString() : null;
