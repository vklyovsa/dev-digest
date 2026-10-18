/* MultiAgentResults — ported from screen_multiagent.jsx (ScreenMultiAgent,
   results phase). Per-agent columns or tabs, finding actions, the shared
   RunTraceDrawer and the "Where agents disagree" section. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@devdigest/ui";
import type { FindingActionKind, MultiAgentRun } from "@devdigest/shared";
import RunTraceDrawer from "@/components/run-trace-drawer";
import { formatUsd } from "@/components/run-cost/helpers";
import { useFindingAction } from "@/lib/hooks/reviews";
import { multiAgentRunKey } from "@/lib/hooks/multi-agent";
import { formatDuration } from "../../helpers";
import { startNewReviewHref, type ViewMode } from "./helpers";
import { s } from "./styles";
import { AgentColumns } from "./_components/AgentColumns";
import { AgentTabs } from "./_components/AgentTabs";
import { Disagreements } from "./_components/Disagreements";
import { ChildRunWatcher } from "./_components/ChildRunWatcher";

export function MultiAgentResults({ run, repoId }: { run: MultiAgentRun; repoId: string }) {
  const t = useTranslations("runs");
  const router = useRouter();
  const qc = useQueryClient();
  const action = useFindingAction();
  const [view, setView] = React.useState<ViewMode>("columns");
  const [drawer, setDrawer] = React.useState<{ runId: string; running: boolean } | null>(null);
  const [learned, setLearned] = React.useState<ReadonlySet<string>>(new Set());

  const refresh = () => qc.invalidateQueries({ queryKey: multiAgentRunKey(run.id) });
  const drawerColumn = drawer ? run.columns.find((c) => c.run_id === drawer.runId) : undefined;

  const onFindingAction = async (findingId: string, kind: FindingActionKind) => {
    await action.mutateAsync({ findingId, action: kind });
    if (kind === "learn") setLearned((prev) => new Set(prev).add(findingId));
    await refresh();
  };

  return (
    <>
      <div style={s.top}>
        <h1 style={s.heading}>{t("page.title")}</h1>
        <Button
          kind="secondary"
          size="sm"
          icon="Plus"
          onClick={() => router.push(startNewReviewHref(repoId, run.pr_id, run.columns))}
        >
          {t("multiAgent.startNewReview")}
        </Button>
        <div style={s.switcher} role="group" aria-label={t("multiAgent.viewSwitch")}>
          {(["columns", "tabs"] as const).map((k) => (
            <Button
              key={k}
              kind="secondary"
              size="sm"
              active={view === k}
              aria-pressed={view === k}
              onClick={() => setView(k)}
            >
              {t(`page.view.${k}`)}
            </Button>
          ))}
        </div>
      </div>

      <div style={s.meta}>
        {run.pr_number != null && (
          <span className="mono" style={s.prNumber}>
            #{run.pr_number}
          </span>
        )}
        {run.pr_title && <span style={s.prTitle}>{run.pr_title}</span>}
        <span style={s.metaRight}>
          {t("page.meta", {
            count: run.agent_count,
            duration: formatDuration(run.total_duration_ms),
            cost: formatUsd(run.total_cost_usd),
          })}
        </span>
      </div>

      {run.columns
        .filter((c) => c.status === "running")
        .map((c) => (
          <ChildRunWatcher key={c.run_id} runId={c.run_id} onSettled={refresh} />
        ))}

      {view === "columns" ? (
        <div style={s.body}>
          <AgentColumns
            columns={run.columns}
            onViewTrace={(c) => setDrawer({ runId: c.run_id, running: c.status === "running" })}
          />
        </div>
      ) : (
        <AgentTabs
          key={run.id}
          columns={run.columns}
          learned={learned}
          pending={action.isPending}
          onAction={onFindingAction}
          onViewTrace={(c) => setDrawer({ runId: c.run_id, running: c.status === "running" })}
        />
      )}

      <div style={s.body}>
        <Disagreements groups={run.groups} columns={run.columns} />
      </div>

      {drawer && (
        <RunTraceDrawer
          key={drawer.runId}
          runId={drawer.runId}
          agentName={drawerColumn ? (drawerColumn.agent_id ? drawerColumn.agent_name : t("multiAgent.deletedAgent")) : null}
          prNumber={run.pr_number}
          findings={drawerColumn?.findings}
          running={drawer.running}
          onClose={() => setDrawer(null)}
        />
      )}
    </>
  );
}
