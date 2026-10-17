"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PerfCostSegment } from "@devdigest/shared";
import { Badge, Card, Donut } from "@devdigest/ui";
import { formatCost } from "../../../../helpers";
import { TruncatedText } from "../../../TruncatedText";

const PALETTE = ["#ef4444", "#f59e0b", "#3b82f6", "#10b981", "#8b5cf6", "#ec4899", "#14b8a6", "#94a3b8"];

const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 };
const head: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 };
const title: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};
const note: React.CSSProperties = { fontSize: 12, color: "var(--text-muted)" };
const block: React.CSSProperties = { display: "flex", alignItems: "center", gap: 20, marginTop: 12, minWidth: 0 };
const legend: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8, flex: 1, minWidth: 0 };
const item: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "9px minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 10,
  fontSize: 13,
};

function Chart({ heading, segments }: { heading: string; segments: { label: string; value: number }[] }) {
  const colored = segments.map((seg, i) => ({ ...seg, color: PALETTE[i % PALETTE.length] as string }));
  return (
    <Card style={{ minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>{heading}</div>
      <div style={block}>
        <div style={{ flexShrink: 0 }}>
          <Donut segments={colored} hideLegend />
        </div>
        <ul style={{ ...legend, listStyle: "none", margin: 0, padding: 0 }}>
          {colored.map((seg, i) => (
            <li key={i} style={item}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: seg.color }} />
              <TruncatedText text={seg.label} style={{ color: "var(--text-secondary)" }} />
              <span className="mono tnum" style={{ fontWeight: 600 }}>
                {formatCost(seg.value)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export function CostBreakdown({
  byAgent,
  byModel,
  totalCostUsd,
}: {
  byAgent: readonly (PerfCostSegment & { agent_id: string | null })[];
  byModel: readonly PerfCostSegment[];
  totalCostUsd: number | null;
}) {
  const t = useTranslations("agentPerformance");
  return (
    <section>
      <div style={head}>
        <h2 style={{ ...title, margin: 0 }}>{t("cost.title")}</h2>
        <Badge>{t("estimate.mark")}</Badge>
        <span style={note}>{t("estimate.note")}</span>
      </div>
      {totalCostUsd === null ? (
        <p style={note}>{t("cost.none")}</p>
      ) : (
        <div style={grid}>
          <Chart
            heading={t("cost.byAgent")}
            segments={byAgent.map((x) => ({ label: x.label ?? t("table.deletedAgent"), value: x.value }))}
          />
          <Chart
            heading={t("cost.byModel")}
            segments={byModel.map((x) => ({ label: x.label ?? t("cost.unknownModel"), value: x.value }))}
          />
        </div>
      )}
    </section>
  );
}
