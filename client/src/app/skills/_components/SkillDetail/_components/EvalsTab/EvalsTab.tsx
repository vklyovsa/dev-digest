"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, SectionLabel, SelectInput, Skeleton } from "@devdigest/ui";
import type { EvalCase, Skill } from "@devdigest/shared";
import { EVAL_NO_HOST_HINT_ID, MetricTiles, RunControl, RunHistory, completedRuns } from "@/components/eval-runs";
import type { SkillEvalTarget } from "@/components/eval-runs";
import { CaseEditorDialog } from "@/components/eval-case-editor";
import { CaseList } from "@/components/eval-case-list";
import { useEvalCases, useEvalRuns } from "@/lib/hooks/evals";
import { useAgents } from "@/lib/hooks/agents";
import { useSkillAgents } from "@/lib/hooks/skills";
import { defaultHostId, orderHosts } from "./helpers";
import { s } from "./styles";

/** A skill's eval cases, the metrics of its newest completed run and its run history, run through a host agent. */
export function EvalsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("eval");
  const agents = useAgents();
  const linked = useSkillAgents(skill.id);
  const [picked, setPicked] = React.useState<string | null>(null);
  const [editor, setEditor] = React.useState<{ evalCase: EvalCase | null } | null>(null);

  const linkedIds = React.useMemo(() => (linked.data ?? []).map((a) => a.id), [linked.data]);
  const hosts = React.useMemo(() => orderHosts(agents.data ?? [], linkedIds), [agents.data, linkedIds]);
  const readOwner = { kind: "skill", id: skill.id, hostAgentId: null } as const;
  const cases = useEvalCases(readOwner);
  const runs = useEvalRuns(readOwner);

  const pickedHost = hosts.find((a) => a.id === picked);
  const host = pickedHost ?? hosts.find((a) => a.id === defaultHostId(runs.data, hosts, linkedIds)) ?? null;
  const target: SkillEvalTarget = {
    id: skill.id,
    name: skill.name,
    host: host ? { id: host.id, name: host.name } : null,
  };
  const hostNames = React.useMemo(() => new Map((agents.data ?? []).map((a) => [a.id, a.name])), [agents.data]);

  const caseList = cases.data;
  const completed = completedRuns(runs.data ?? []);
  const hasCases = (caseList?.length ?? 0) > 0;
  const latest = hasCases ? (completed[0] ?? null) : null;
  const previous = hasCases ? (completed[1] ?? null) : null;

  return (
    <div style={s.stack}>
      {hosts.length > 0 ? (
        <label style={s.hostRow}>
          <span style={s.hostLabel}>{t("skillEvals.hostLabel")}</span>
          <SelectInput
            mono={false}
            value={host?.id ?? ""}
            onChange={setPicked}
            options={hosts.map((a) => ({
              value: a.id,
              label: t("skillEvals.hostOption", { name: a.name, model: a.model }),
            }))}
          />
        </label>
      ) : (
        !agents.isLoading && (
          <span id={EVAL_NO_HOST_HINT_ID} style={s.notice}>
            {t("skillEvals.noHostHint")}
          </span>
        )
      )}

      {!skill.enabled && <p style={s.notice}>{t("skillEvals.disabledNotice")}</p>}

      <section>
        <SectionLabel icon="Gauge">{t("evalsTab.metricsTitle")}</SectionLabel>
        <p style={s.subtitle}>{t("skillEvals.metricsSubtitle")}</p>
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
      ) : (caseList ?? []).length === 0 ? (
        <EmptyState
          icon="FlaskConical"
          title={t("skillEvals.emptyTitle")}
          body={t("skillEvals.emptyBody")}
          cta={t("caseEditor.newCase")}
          onCta={() => setEditor({ evalCase: null })}
        />
      ) : (
        <CaseList
          cases={caseList ?? []}
          skill={target}
          listStamp={cases.dataUpdatedAt}
          control={<RunControl skill={target} caseCount={caseList?.length ?? 0} variant="all" />}
          actions={
            <Button kind="primary" icon="Plus" onClick={() => setEditor({ evalCase: null })}>
              {t("caseEditor.newCase")}
            </Button>
          }
          onEdit={(evalCase) => setEditor({ evalCase })}
        />
      )}

      <RunHistory skill={target} hostNames={hostNames} />

      {editor && (
        <CaseEditorDialog
          key={editor.evalCase?.id ?? "new"}
          skill={target}
          evalCase={editor.evalCase}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
