"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { AgentPerf } from "@devdigest/shared";
import { Card, Sparkline } from "@devdigest/ui";
import { formatCost, seriesUnit, signedCost, spanDays, splitLines } from "../../../../helpers";
import { TruncatedText } from "../../../TruncatedText";

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 16,
};
const label: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.03em",
  color: "var(--text-muted)",
};
const value: React.CSSProperties = { fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 12 };
const sub: React.CSSProperties = { fontSize: 12, color: "var(--text-muted)", marginTop: 6 };
const runsRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "space-between",
  gap: 12,
};
const cell: React.CSSProperties = { minWidth: 0 };

export function KpiCards({
  summary,
  series,
  period,
  periodLabel,
}: {
  summary: AgentPerf["summary"];
  series: AgentPerf["runs_series"];
  period: AgentPerf["period"];
  periodLabel: string;
}) {
  const t = useTranslations("agentPerformance");
  const labelArgs = { period: periodLabel };
  const none = t("none");
  const peak = Math.max(0, ...series.map((b) => b.runs));
  const delta = summary.cost_delta_usd === null ? null : signedCost(summary.cost_delta_usd);
  const rate = (v: number | null) => (v === null ? none : t("format.rate", { value: v }));

  return (
    <div style={grid}>
      <Card style={cell}>
        <div style={label}>{t("kpi.totalRuns", labelArgs)}</div>
        <div style={runsRow}>
          <div className="tnum" style={value}>
            {t("format.count", { value: summary.runs })}
          </div>
          {series.length > 1 && (
            <div role="img" aria-label={t("kpi.series", { unit: seriesUnit(series), peak })}>
              <Sparkline data={series.map((b) => b.runs)} w={96} h={32} />
            </div>
          )}
        </div>
      </Card>
      <Card style={cell}>
        <div style={label}>{t("kpi.totalCost", labelArgs)}</div>
        <div className="tnum" style={value}>
          {summary.total_cost_usd === null ? none : formatCost(summary.total_cost_usd)}
        </div>
        <div style={sub}>
          {delta === null
            ? t("kpi.noPrevious")
            : t("kpi.delta", { sign: delta.sign, amount: delta.amount, days: spanDays(period) })}
        </div>
        {splitLines(summary.cost_split).map((line) => (
          <div key={line.kind} style={sub}>
            {t(`kpi.split.${line.kind}`, { amount: formatCost(line.usd) })}
          </div>
        ))}
        <div style={sub}>{t("kpi.billedNote")}</div>
        {summary.unpriced_runs > 0 && (
          <div style={sub}>{t("kpi.unpriced", { count: summary.unpriced_runs })}</div>
        )}
      </Card>
      <Card style={cell}>
        <div style={label}>{t("kpi.avgAcceptRate", labelArgs)}</div>
        <div className="tnum" style={value}>
          {rate(summary.avg_accept_rate)}
        </div>
        <div style={sub}>
          {t("kpi.decisionsAndRuns", { decisions: summary.decisions, runs: summary.runs })}
        </div>
      </Card>
      <Card style={cell}>
        <div style={label}>{t("kpi.mostActive", labelArgs)}</div>
        {summary.most_active_agent === null ? (
          <div style={value}>{none}</div>
        ) : (
          <>
            <TruncatedText text={summary.most_active_agent} style={{ ...value, fontSize: 20 }} />
            <div style={sub}>
              {t("kpi.mostActiveSub", {
                runs: summary.most_active_runs,
                rate: rate(summary.most_active_accept_rate),
              })}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
