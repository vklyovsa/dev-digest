"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { AgentPerfRow } from "@devdigest/shared";
import { Badge } from "@devdigest/ui";
import { formatRunTime } from "@/components/eval-runs";
import { costBasis, formatCost, sortByAcceptRate, type SortDir } from "../../../../helpers";
import { TruncatedText } from "../../../TruncatedText";
import { s } from "./styles";

export function AgentTable({
  rows,
  sortDir,
  onToggleSort,
  onView,
}: {
  rows: readonly AgentPerfRow[];
  sortDir: SortDir;
  onToggleSort: () => void;
  onView: (agentId: string) => void;
}) {
  const t = useTranslations("agentPerformance");
  const none = t("none");
  const sorted = sortByAcceptRate(rows, sortDir);

  return (
    <div style={s.card}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={{ ...s.th, width: "24%" }}>{t("table.agent")}</th>
            <th style={s.th}>{t("table.runs")}</th>
            <th style={{ ...s.th, width: "15%" }}>{t("table.avgCost")}</th>
            <th style={s.th}>{t("table.avgDuration")}</th>
            <th style={{ ...s.th, width: "20%" }} aria-sort={sortDir === "desc" ? "descending" : "ascending"}>
              <button type="button" style={s.sortBtn} onClick={onToggleSort}>
                {t("table.acceptRate")} {sortDir === "desc" ? "↓" : "↑"}
              </button>
            </th>
            <th style={s.th}>{t("table.lastRun")}</th>
            <th style={s.th}>{t("table.view")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const basis = costBasis(r.cost_split);
            const trend = r.accept_trend === "up" || r.accept_trend === "down" ? r.accept_trend : null;
            const name = r.agent_id === null ? t("table.deletedAgent") : (r.agent_name ?? t("table.deletedAgent"));
            return (
              <tr key={r.agent_id ?? "deleted"}>
                <td style={s.td}>
                  <TruncatedText text={name} style={s.name} />
                </td>
                {r.runs === 0 ? (
                  <td style={{ ...s.td, ...s.noRuns }} colSpan={5}>
                    {t("table.noRuns")}
                  </td>
                ) : (
                  <>
                    <td className="tnum" style={s.td}>
                      {t("format.count", { value: r.runs })}
                    </td>
                    <td className="tnum" style={s.td}>
                      {r.avg_cost_usd === null ? (
                        none
                      ) : (
                        <>
                          {formatCost(r.avg_cost_usd)}
                          {basis !== null && <span style={s.basis}>{t(`basis.${basis}`)}</span>}
                        </>
                      )}
                    </td>
                    <td className="tnum" style={s.td}>
                      {r.avg_latency_ms === null
                        ? none
                        : t("format.seconds", { value: Math.round(r.avg_latency_ms / 100) / 10 })}
                    </td>
                    <td className="tnum" style={s.td}>
                      <div style={s.rate}>
                        <span>{r.accept_rate === null ? none : t("format.rate", { value: r.accept_rate })}</span>
                        {trend !== null && r.previous_accept_rate !== null && (
                          <span style={s.muted}>
                            <span aria-hidden="true">{trend === "up" ? "↑" : "↓"} </span>
                            {t(trend === "up" ? "table.trendUp" : "table.trendDown", {
                              rate: t("format.rate", { value: r.previous_accept_rate }),
                            })}
                          </span>
                        )}
                        <span style={s.muted}>{t("table.decisions", { count: r.decisions })}</span>
                        {r.small_sample && <Badge>{t("table.smallSample")}</Badge>}
                      </div>
                    </td>
                    <td style={s.td}>{r.last_run_at === null ? none : formatRunTime(r.last_run_at)}</td>
                  </>
                )}
                <td style={s.td}>
                  {r.agent_id !== null && (
                    <button
                      type="button"
                      style={s.view}
                      aria-label={t("table.viewAgent", { name })}
                      onClick={() => onView(r.agent_id as string)}
                    >
                      {t("table.view")}
                    </button>
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
