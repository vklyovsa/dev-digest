"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { EvalRun } from "@devdigest/shared";
import { Button, Icon, ProgressBar, SectionLabel, Skeleton, Sparkline } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatRunTime, toPercent } from "@/components/eval-runs";
import { useEvalDashboard, useStartEvalRunsForAgents, type AgentRunStart } from "@/lib/hooks/evals";
import { s } from "./styles";

type MetricKey = "recall" | "precision" | "citation_accuracy";

const METRICS: { key: MetricKey; label: "recall" | "precision" | "citationAccuracy"; color: string }[] = [
  { key: "recall", label: "recall", color: "var(--accent)" },
  { key: "precision", label: "precision", color: "var(--ok)" },
  { key: "citation_accuracy", label: "citationAccuracy", color: "var(--warn)" },
];

const TABLE_COLUMNS = [
  "dashboard.agent",
  "dashboard.table.ranAt",
  "runs.history.version",
  "dashboard.table.recall",
  "dashboard.table.precision",
  "dashboard.table.citation",
  "dashboard.table.pass",
] as const;

/** /eval — the latest completed run of every agent, then the most recent runs across agents. */
export function EvalDashboard() {
  const t = useTranslations("eval");
  const { data, isLoading, isError, refetch } = useEvalDashboard();
  const startAll = useStartEvalRunsForAgents();
  const [confirming, setConfirming] = React.useState(false);
  const [started, setStarted] = React.useState<Record<string, AgentRunStart>>({});
  const closeConfirm = React.useCallback(() => setConfirming(false), []);

  const agents = data?.agents ?? [];
  const eligible = agents.filter((a) => a.case_count > 0 && !a.run_in_progress);
  const noCases = agents.filter((a) => a.case_count === 0);
  const inProgress = agents.filter((a) => a.case_count > 0 && a.run_in_progress);
  const runAllDisabled = eligible.length === 0 || startAll.isPending;

  const confirmRunAll = () => {
    setConfirming(false);
    startAll.mutate(
      eligible.map((a) => a.agent_id),
      { onSuccess: (results) => setStarted(Object.fromEntries(results.map((r) => [r.agentId, r]))) },
    );
  };

  const percent = (value: number | null) => {
    const p = toPercent(value);
    return p === null ? t("runs.noValue") : t("runs.percent", { value: p });
  };

  return (
    <AppShell crumb={[{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <h1 style={s.h1}>{t("dashboard.defaultTitle")}</h1>
          {data && (
            <div style={s.runAll}>
              <Button
                kind="secondary"
                size="sm"
                disabled={runAllDisabled}
                aria-describedby={runAllDisabled && !startAll.isPending ? "eval-run-all-hint" : undefined}
                onClick={() => setConfirming(true)}
              >
                {t("dashboard.runAll.action")}
              </Button>
              {eligible.length === 0 && (
                <span id="eval-run-all-hint" style={s.hint}>
                  {t("dashboard.runAll.disabledHint")}
                </span>
              )}
            </div>
          )}
        </div>
        <p style={s.subtitle}>{t("dashboard.subtitle")}</p>

        {isLoading && (
          <div role="status" aria-label={t("dashboard.loading")}>
            <Skeleton height={72} style={{ marginBottom: 10 }} />
            <Skeleton height={72} />
          </div>
        )}
        {isError && (
          <div role="alert" style={s.error}>
            {t("dashboard.loadError")}
            <Button kind="secondary" size="sm" icon="RefreshCw" onClick={() => refetch()}>
              {t("dashboard.retry")}
            </Button>
          </div>
        )}

        {data && (
          <>
            <SectionLabel icon="Cpu">{t("dashboard.agentsTitle")}</SectionLabel>
            <div style={s.list}>
              {data.agents.map((agent) => {
                const run = agent.latest_run;
                const recall = agent.trend.map((p) => p.recall).filter((v): v is number => v !== null);
                const outcome = started[agent.agent_id];
                const status = agent.run_in_progress
                  ? t("dashboard.runAll.running")
                  : outcome
                    ? outcome.ok
                      ? t("dashboard.runAll.started")
                      : outcome.message
                    : null;
                return (
                  <Link key={agent.agent_id} href={`/eval/${agent.agent_id}`} style={s.card}>
                    <span style={s.icon}>
                      <Icon.Cpu size={18} />
                    </span>
                    <span style={s.cardText}>
                      <span style={s.nameRow}>
                        <span style={s.name}>{agent.name}</span>
                        <span className="mono" style={s.model}>
                          {agent.model}
                        </span>
                      </span>
                      <span style={{ ...s.meta, display: "block" }}>
                        {run
                          ? t("dashboard.lastRun", {
                              version: run.agent_version,
                              time: formatRunTime(run.started_at),
                              passed: run.cases_passed,
                              total: run.cases_total,
                            })
                          : t("dashboard.noRunsYet")}
                      </span>
                      {status && (
                        <span style={{ ...s.meta, display: "block" }}>{status}</span>
                      )}
                    </span>
                    {recall.length >= 2 && (
                      <span aria-hidden="true" data-sparkline="recall" style={s.sparkline}>
                        <Sparkline data={recall} color="var(--accent)" w={64} h={20} />
                      </span>
                    )}
                    <span style={s.metrics}>
                      {METRICS.map(({ key, label, color }) => (
                        <span key={key} style={s.metric}>
                          <abbr title={t(`dashboard.metrics.${label}`)} style={s.metricLabel}>
                            {t(`dashboard.shortMetrics.${label}`)}
                          </abbr>
                          <span className="tnum" style={{ ...s.metricValue(color), display: "block" }}>
                            {percent(run ? run[key] : null)}
                          </span>
                        </span>
                      ))}
                    </span>
                    <Icon.ChevronRight size={16} style={s.chevron} />
                  </Link>
                );
              })}
            </div>

            <SectionLabel icon="History">{t("dashboard.recentTitle")}</SectionLabel>
            {data.recent_runs.length === 0 ? (
              <div style={s.empty}>{t("dashboard.recentEmpty")}</div>
            ) : (
              <div style={s.tableCard}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      {TABLE_COLUMNS.map((c) => (
                        <th key={c} style={s.th} scope="col">
                          {t(c)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_runs.map((run) => (
                      <RecentRow key={run.id} run={run} percent={percent} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
      {confirming && (
        <ConfirmDialog
          danger={false}
          title={t("dashboard.runAll.dialogTitle")}
          confirmLabel={t("dashboard.runAll.confirm")}
          cancelLabel={t("dashboard.runAll.cancel")}
          body={
            <>
              <p>
                {t("dashboard.runAll.summary", {
                  agents: eligible.length,
                  cases: eligible.reduce((n, a) => n + a.case_count, 0),
                })}
              </p>
              {noCases.length > 0 && (
                <p>{t("dashboard.runAll.skippedNoCases", { names: noCases.map((a) => a.name).join(", ") })}</p>
              )}
              {inProgress.length > 0 && (
                <p>{t("dashboard.runAll.skippedRunning", { names: inProgress.map((a) => a.name).join(", ") })}</p>
              )}
            </>
          }
          onConfirm={confirmRunAll}
          onCancel={closeConfirm}
        />
      )}
    </AppShell>
  );
}

function RecentRow({
  run,
  percent,
}: {
  run: EvalRun & { agent_name: string };
  percent: (value: number | null) => string;
}) {
  const t = useTranslations("eval");
  const router = useRouter();
  const href = `/eval/${run.agent_id}`;
  return (
    <tr style={s.row} onClick={() => router.push(href)}>
      <td style={s.td}>
        <Link href={href} style={s.rowLink} onClick={(e) => e.stopPropagation()}>
          {run.agent_name}
        </Link>
      </td>
      <td className="mono" style={s.td}>
        {formatRunTime(run.started_at)}
      </td>
      <td className="mono" style={{ ...s.td, ...s.version }}>
        {t("runs.history.versionValue", { version: run.agent_version })}
      </td>
      {METRICS.map(({ key, color }) => (
        <td key={key} style={s.td}>
          <div style={s.metricCell}>
            <div style={s.bar} aria-hidden="true">
              <ProgressBar value={toPercent(run[key]) ?? 0} color={color} height={4} />
            </div>
            <span className="tnum" style={s.pct}>
              {percent(run[key])}
            </span>
          </div>
        </td>
      ))}
      <td className="tnum" style={{ ...s.td, ...s.pass }}>
        {t("runs.casesRatio", { passed: run.cases_passed, total: run.cases_total })}
      </td>
    </tr>
  );
}
