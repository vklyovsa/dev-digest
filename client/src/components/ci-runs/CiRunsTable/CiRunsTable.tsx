"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { CiRun } from "@devdigest/shared";
import { formatCost, statusColor, statusKey } from "./helpers";
import { s } from "./styles";

const COLUMNS = [
  "repository",
  "pr",
  "agent",
  "verdict",
  "findings",
  "cost",
  "duration",
  "status",
  "run",
] as const;

/** One row per CI run, as plain text. Rendered on the CI Runs page and on an agent's CI tab. */
export function CiRunsTable({ runs }: { runs: CiRun[] }) {
  const t = useTranslations("ci");
  return (
    <div style={s.card}>
      <table style={s.table}>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c} style={s.th}>
                {t(`runs.columns.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const key = statusKey(run.status);
            return (
              <tr key={run.id}>
                <td style={{ ...s.td, ...s.wrap }}>{run.repo}</td>
                <td style={{ ...s.td, ...s.nowrap }}>{run.pr_number != null ? `#${run.pr_number}` : "—"}</td>
                <td style={{ ...s.td, ...s.wrap }}>{run.agent ?? t("runs.agentMissing")}</td>
                <td style={{ ...s.td, ...s.nowrap }}>{run.verdict ? t(`runs.verdict.${run.verdict}`) : "—"}</td>
                <td style={{ ...s.td, ...s.nowrap }}>
                  {run.findings_count == null
                    ? "—"
                    : t("runs.findingsCounts", {
                        critical: run.critical ?? 0,
                        warning: run.warning ?? 0,
                        suggestion: run.suggestion ?? 0,
                      })}
                </td>
                <td style={{ ...s.td, ...s.nowrap }}>{formatCost(run.cost_usd)}</td>
                <td style={{ ...s.td, ...s.nowrap }}>
                  {run.duration_s == null ? "—" : t("runs.durationSeconds", { seconds: Math.round(run.duration_s) })}
                </td>
                <td style={{ ...s.td, ...s.nowrap, color: statusColor(run.status) }}>
                  {key ? t(`runs.status.${key}`) : (run.status ?? "—")}
                </td>
                <td style={{ ...s.td, ...s.nowrap }}>
                  {run.github_url ? (
                    <a href={run.github_url} target="_blank" rel="noopener noreferrer" style={s.link}>
                      {t("runs.view")}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
