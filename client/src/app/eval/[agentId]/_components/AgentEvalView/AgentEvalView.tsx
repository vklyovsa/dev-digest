"use client";

import React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button, Dropdown, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { MetricTiles, MetricTrend, RunControl, RunHistory, completedRuns, metricSparklines } from "@/components/eval-runs";
import { useAgent, useAgents } from "@/lib/hooks/agents";
import { useEvalCases, useEvalRun, useEvalRuns } from "@/lib/hooks/evals";
import { newlyFailingMustNotFlag, precisionDip } from "./helpers";
import { s } from "./styles";

/**
 * /eval/:agentId — one agent's eval view. Its blocks are siblings in reading
 * order: the banner, the tiles, the run history.
 */
export function AgentEvalView({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const agent = useAgent(agentId);
  const agents = useAgents();
  const runs = useEvalRuns(agentId);
  const cases = useEvalCases(agentId);

  const completed = completedRuns(runs.data ?? []);
  const latest = completed[0] ?? null;
  const previous = completed[1] ?? null;

  const name = agent.data?.name;
  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/eval" },
    ...(name ? [{ label: name }] : []),
  ];

  const others = (agents.data ?? []).filter((a) => a.id !== agentId);

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <Link href="/eval" style={s.back}>
          <Icon.ChevronLeft size={14} />
          {t("agentView.allAgents")}
        </Link>

        {agent.isLoading && <Skeleton height={64} />}
        {agent.isError && (
          <div role="alert" style={s.error}>
            {t("agentView.loadError")}
            <Button kind="secondary" size="sm" icon="RefreshCw" onClick={() => agent.refetch()}>
              {t("dashboard.retry")}
            </Button>
          </div>
        )}

        {agent.data && (
          <>
            <div style={s.header}>
              <div style={s.headerText}>
                <div style={s.titleRow}>
                  <h1 style={s.h1}>{agent.data.name}</h1>
                  <span className="mono" style={s.model}>
                    {agent.data.model}
                  </span>
                </div>
                <p style={s.summary}>
                  {t("agentView.summary", { runs: runs.data?.length ?? 0, cases: cases.data?.length ?? 0 })}
                </p>
              </div>
              <div style={s.actions}>
                {others.length > 0 && (
                  <Dropdown
                    align="right"
                    trigger={
                      <Button
                        kind="secondary"
                        size="sm"
                        icon="Cpu"
                        iconRight="ChevronDown"
                        aria-label={`${t("agentView.switchAgent")}: ${agent.data.name}`}
                      >
                        {agent.data.name}
                      </Button>
                    }
                    items={others.map((a) => ({
                      label: a.name,
                      icon: "Cpu" as const,
                      onClick: () => router.push(`/eval/${a.id}`),
                    }))}
                  />
                )}
                <RunControl agentId={agentId} caseCount={cases.data?.length ?? 0} variant="one" />
              </div>
            </div>

            <PrecisionBanner latest={latest} previous={previous} />
            <div style={s.block}>
              <MetricTiles latest={latest} previous={previous} sparklines={metricSparklines(runs.data ?? [])} />
            </div>
            <MetricTrend
              runs={runs.data}
              loading={runs.isLoading}
              failed={!!runs.error}
              onRetry={() => void runs.refetch()}
            />
            <RunHistory agentId={agentId} />
          </>
        )}
      </div>
    </AppShell>
  );
}

function PrecisionBanner({
  latest,
  previous,
}: {
  latest: Parameters<typeof precisionDip>[0];
  previous: Parameters<typeof precisionDip>[1];
}) {
  const t = useTranslations("eval");
  const locale = useLocale();
  const dip = precisionDip(latest, previous);
  const latestDetail = useEvalRun(dip ? latest?.id : null);
  const previousDetail = useEvalRun(dip ? previous?.id : null);
  if (!dip) return null;

  const names = newlyFailingMustNotFlag(latestDetail.data, previousDetail.data);
  return (
    <div style={s.banner}>
      <Icon.AlertTriangle size={16} style={s.bannerIcon} />
      <div>
        <div style={s.bannerTitle}>{t("agentView.banner", { points: dip.points, version: dip.version })}</div>
        {names.length > 0 && (
          <div style={s.bannerCases}>
            {t("agentView.bannerCases", { names: new Intl.ListFormat(locale, { type: "conjunction" }).format(names) })}
          </div>
        )}
      </div>
    </div>
  );
}
