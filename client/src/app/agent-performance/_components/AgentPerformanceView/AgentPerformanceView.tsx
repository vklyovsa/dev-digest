"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgentPerformance } from "@/lib/hooks/agents";
import {
  localToday,
  parsePeriod,
  periodRange,
  periodSearch,
  type Period,
  type SortDir,
} from "../../helpers";
import { AgentTable } from "./_components/AgentTable";
import { CostBreakdown } from "./_components/CostBreakdown";
import { KpiCards } from "./_components/KpiCards";
import { PeriodPicker } from "./_components/PeriodPicker";
import { s } from "./styles";

/** /agent-performance — KPI cards, per-agent table and cost breakdown for one period. */
export function AgentPerformanceView() {
  const t = useTranslations("agentPerformance");
  const tc = useTranslations("common");
  const router = useRouter();
  const search = useSearchParams();

  const [selection, setSelection] = React.useState(() => {
    const now = Date.now();
    return { period: parsePeriod(new URLSearchParams(search?.toString() ?? ""), localToday(now)), anchor: now };
  });
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");

  const range = React.useMemo(() => periodRange(selection.period, selection.anchor), [selection]);
  const q = useAgentPerformance(range);

  const onSelect = (period: Period) => {
    setSelection({ period, anchor: Date.now() });
    router.replace(`/agent-performance?${periodSearch(period)}`);
  };

  const period = selection.period;
  const periodLabel =
    period.kind === "custom"
      ? t("period.short.custom", { start: period.start, end: period.end })
      : t(`period.short.${period.kind}`);

  const periodSentence =
    period.kind === "custom" ? periodLabel : t(`period.choices.${period.kind}`);

  const data = q.data;
  let body: React.ReactNode;
  if (q.isPending) {
    body = (
      <div aria-busy="true" data-testid="performance-loading" style={s.skeletonStack}>
        <div style={s.kpiSkeleton}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={112} />
          ))}
        </div>
        <Skeleton height={220} />
        <Skeleton height={180} />
      </div>
    );
  } else if (q.isError || !data) {
    body = (
      <ErrorState
        title={t("states.loadError")}
        body={
          <Button kind="secondary" icon="RefreshCw" onClick={() => q.refetch()}>
            {tc("actions.retry")}
          </Button>
        }
      />
    );
  } else if (data.summary.runs === 0) {
    body = <EmptyState title={t("states.emptyTitle", { period: periodSentence })} body={t("states.emptyBody")} />;
  } else {
    body = (
      <>
        <KpiCards summary={data.summary} periodLabel={periodLabel} />
        <AgentTable
          rows={data.agents}
          sortDir={sortDir}
          onToggleSort={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
          onView={(id) => router.push(`/agents/${id}`)}
        />
        <CostBreakdown
          byAgent={data.cost_by_agent}
          byModel={data.cost_by_model}
          totalCostUsd={data.summary.total_cost_usd}
        />
      </>
    );
  }

  return (
    <AppShell crumb={[{ label: t("title") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <h1 style={s.h1}>{t("title")}</h1>
          <PeriodPicker period={period} today={localToday(Date.now())} onSelect={onSelect} />
        </div>
        {body}
      </div>
    </AppShell>
  );
}
