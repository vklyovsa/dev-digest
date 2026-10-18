/* ConfigureRun — ported from screen_multiagent.jsx (RunConfig). Pick a PR and
   the agents, see the estimate, start ONE multi-agent run. */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, EmptyState, Skeleton, SelectInput } from "@devdigest/ui";
import type { MultiAgentEstimate } from "@devdigest/shared";
import { useAgents } from "@/lib/hooks/agents";
import { usePulls } from "@/lib/hooks/core";
import { useMultiAgentEstimates, useStartMultiAgentRun } from "@/lib/hooks/multi-agent";
import { formatUsd } from "@/components/run-cost/helpers";
import { formatDuration, runButtonKey } from "../../helpers";
import { estimateTotal } from "./helpers";
import { s } from "./styles";

export function ConfigureRun({
  repoId,
  preselect,
}: {
  repoId: string;
  preselect?: { pr?: string | null; agents?: string[] };
}) {
  const t = useTranslations("runs");
  const router = useRouter();
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: pulls } = usePulls(repoId);
  const { data: est } = useMultiAgentEstimates();
  const start = useStartMultiAgentRun();

  const [prId, setPrId] = React.useState<string>(preselect?.pr ?? "");
  const [picked, setPicked] = React.useState<Set<string> | null>(null);

  const all = agents ?? [];
  const checked = React.useMemo(() => {
    if (picked) return picked;
    const ids = new Set(all.map((a) => a.id));
    if (preselect?.agents) return new Set(preselect.agents.filter((id) => ids.has(id)));
    return new Set(all.filter((a) => a.enabled).map((a) => a.id));
  }, [picked, all, preselect?.agents]);

  const estimates = React.useMemo(() => {
    const m = new Map<string, MultiAgentEstimate>();
    for (const e of est?.estimates ?? []) m.set(e.agent_id, e);
    return m;
  }, [est]);

  const toggle = (id: string, on: boolean) => {
    const next = new Set(checked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };

  const count = checked.size;
  const total = estimateTotal(checked, estimates);
  const prOptions = [
    { value: "", label: t("page.selectPr") },
    ...(pulls ?? []).flatMap((p) =>
      p.id ? [{ value: p.id, label: t("page.prItem", { number: p.number, title: p.title }) }] : [],
    ),
  ];

  const run = async () => {
    const res = await start.mutateAsync({ prId, agentIds: [...checked] });
    router.push(`/repos/${repoId}/multi-agent/${res.id}`);
  };

  if (agentsLoading) {
    return (
      <div style={s.root}>
        <Skeleton height={28} width={320} />
        <Skeleton height={200} />
      </div>
    );
  }

  if (all.length === 0) {
    return (
      <EmptyState
        icon="Cpu"
        title={t("page.noAgents.title")}
        body={
          <>
            {t("page.noAgents.body")}
            <br />
            <Link href="/agents" style={s.link}>
              {t("page.noAgents.cta")}
            </Link>
          </>
        }
      />
    );
  }

  return (
    <div style={s.root}>
      <h1 style={s.title}>{t("multiAgent.configureTitle")}</h1>
      <p style={s.subtitle}>{t("multiAgent.configureSubtitle")}</p>

      <div style={s.stepRow}>
        <span style={s.stepLabel}>{t("multiAgent.pullRequest")}</span>
      </div>
      <div style={s.prSelect}>
        <SelectInput value={prId} onChange={setPrId} options={prOptions} mono={false} />
      </div>

      <div style={s.stepRow}>
        <span style={s.stepLabel}>{t("multiAgent.agentsToRun")}</span>
      </div>
      {prId ? (
        <div style={s.agentList}>
          {all.map((a) => {
            const e = estimates.get(a.id);
            const hasEstimate = e != null && e.duration_ms != null;
            return (
              <div key={a.id} style={s.agentCard}>
                <div style={s.agentMain}>
                  <Checkbox checked={checked.has(a.id)} onChange={(v) => toggle(a.id, v)} label={a.name} />
                  {a.description && <span style={s.agentDesc}>{a.description}</span>}
                </div>
                <span className="mono" style={s.estimate}>
                  {hasEstimate
                    ? `${formatDuration(e.duration_ms)} · ${formatUsd(e.cost_usd)}`
                    : t("multiAgent.noEstimate")}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={s.placeholder}>
          <div style={s.placeholderTitle}>{t("multiAgent.pickPrFirst")}</div>
          <p style={s.placeholderBody}>{t("multiAgent.pickPrBody")}</p>
        </div>
      )}

      <div style={s.runBar}>
        <Button
          kind="primary"
          icon="Users"
          disabled={!prId || count === 0 || start.isPending}
          onClick={run}
        >
          {t(`multiAgent.runButton.${runButtonKey(count)}`, { count })}
        </Button>
        {prId && count > 0 && (
          <span className="mono" style={s.total}>
            {t("multiAgent.total", {
              duration: formatDuration(total.durationMs),
              cost: formatUsd(total.costUsd),
            })}
          </span>
        )}
      </div>
    </div>
  );
}
