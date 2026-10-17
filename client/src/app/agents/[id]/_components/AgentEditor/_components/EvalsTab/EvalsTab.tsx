"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { Agent, EvalCase } from "@devdigest/shared";
import { MetricTiles, MetricTrend, RunControl, RunHistory, completedRuns } from "@/components/eval-runs";
import { useEvalCases, useEvalRuns } from "@/lib/hooks/evals";
import { CaseEditorDialog } from "@/components/eval-case-editor";
import { CaseList } from "@/components/eval-case-list";
import { s } from "./styles";

/** The agent's eval cases, the metrics of its newest completed run and its run history. */
export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");
  const cases = useEvalCases(agent.id);
  const runs = useEvalRuns(agent.id);
  const [editor, setEditor] = React.useState<{ evalCase: EvalCase | null } | null>(null);

  const caseList = cases.data;
  const completed = completedRuns(runs.data ?? []);
  const hasCases = (caseList?.length ?? 0) > 0;
  const latest = hasCases ? (completed[0] ?? null) : null;
  const previous = hasCases ? (completed[1] ?? null) : null;

  return (
    <div style={s.stack}>
      <section>
        <SectionLabel
          icon="Gauge"
          right={
            <Link href={`/eval/${agent.id}`} style={s.link}>
              {t("evalsTab.viewDashboard")}
              <Icon.ArrowRight size={13} />
            </Link>
          }
        >
          {t("evalsTab.metricsTitle")}
        </SectionLabel>
        <p style={s.subtitle}>{t("evalsTab.metricsSubtitle")}</p>
        {runs.isLoading ? (
          <div role="status">
            <Skeleton height={96} />
            <span style={s.muted}>{t("dashboard.loading")}</span>
          </div>
        ) : runs.error ? (
          <div style={s.failure}>
            <span role="alert" style={s.failureText}>
              <span>{t("evalsTab.runsLoadError")}</span>
              <span>{runs.error.message}</span>
            </span>
            <Button size="sm" onClick={() => runs.refetch()}>
              {t("evalsTab.retry")}
            </Button>
          </div>
        ) : (
          <MetricTiles latest={latest} previous={previous} />
        )}
      </section>

      <p style={s.note}>{t("evalsTab.scoringNote")}</p>
      <MetricTrend
        runs={runs.data}
        loading={runs.isLoading}
        failed={!!runs.error}
        onRetry={() => void runs.refetch()}
      />
      {hasCases && !runs.isLoading && !runs.error && completed.length === 0 && (
        <p style={s.note}>{t("evalsTab.neverRunSet")}</p>
      )}

      {cases.isLoading ? (
        <section>
          <h2 style={s.heading}>{t("evalsTab.casesHeading")}</h2>
          <div role="status" style={s.muted}>
            {t("evalsTab.loadingCases")}
          </div>
        </section>
      ) : cases.error ? (
        <section>
          <h2 style={s.heading}>{t("evalsTab.casesHeading")}</h2>
          <div style={s.failure}>
            <span role="alert">{t("evalsTab.loadError")}</span>
            <Button size="sm" onClick={() => cases.refetch()}>
              {t("evalsTab.retry")}
            </Button>
          </div>
        </section>
      ) : (
        <CaseList
          cases={caseList ?? []}
          agentId={agent.id}
          listStamp={cases.dataUpdatedAt}
          control={<RunControl agentId={agent.id} caseCount={caseList?.length ?? 0} variant="all" />}
          actions={
            <Button kind="primary" icon="Plus" onClick={() => setEditor({ evalCase: null })}>
              {t("caseEditor.newCase")}
            </Button>
          }
          onEdit={(evalCase) => setEditor({ evalCase })}
        />
      )}

      <RunHistory agentId={agent.id} />

      {editor && (
        <CaseEditorDialog
          key={editor.evalCase?.id ?? "new"}
          agent={{ id: agent.id, name: agent.name }}
          evalCase={editor.evalCase}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
