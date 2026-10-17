"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { AgentPerf } from "@devdigest/shared";
import { Badge, Card } from "@devdigest/ui";
import { formatCost } from "../../../../helpers";
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
const cell: React.CSSProperties = { minWidth: 0 };

export function KpiCards({
  summary,
  periodLabel,
}: {
  summary: AgentPerf["summary"];
  periodLabel: string;
}) {
  const t = useTranslations("agentPerformance");
  const period = { period: periodLabel };
  const none = t("none");
  const rate = (v: number | null) => (v === null ? none : t("format.rate", { value: v }));

  return (
    <div style={grid}>
      <Card style={cell}>
        <div style={label}>{t("kpi.totalRuns", period)}</div>
        <div className="tnum" style={value}>
          {t("format.count", { value: summary.runs })}
        </div>
      </Card>
      <Card style={cell}>
        <div style={label}>{t("kpi.totalCost", period)}</div>
        <div className="tnum" style={value}>
          {summary.total_cost_usd === null ? none : formatCost(summary.total_cost_usd)}
        </div>
        <div style={{ marginTop: 8 }}>
          <Badge>{t("estimate.mark")}</Badge>
        </div>
        <div style={sub}>{t("estimate.note")}</div>
        {summary.unpriced_runs > 0 && (
          <div style={sub}>{t("kpi.unpriced", { count: summary.unpriced_runs })}</div>
        )}
      </Card>
      <Card style={cell}>
        <div style={label}>{t("kpi.avgAcceptRate", period)}</div>
        <div className="tnum" style={value}>
          {rate(summary.avg_accept_rate)}
        </div>
        <div style={sub}>
          {t("kpi.decisionsAndRuns", { decisions: summary.decisions, runs: summary.runs })}
        </div>
      </Card>
      <Card style={cell}>
        <div style={label}>{t("kpi.mostActive", period)}</div>
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
