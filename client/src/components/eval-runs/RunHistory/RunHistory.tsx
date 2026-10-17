"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { EvalRun } from "@devdigest/shared";
import { Button, ProgressBar, SectionLabel, Skeleton } from "@devdigest/ui";
import { useEvalRuns } from "@/lib/hooks/evals";
import { formatUsd } from "@/components/run-cost";
import { TREND_METRICS } from "../constants";
import { completedRuns, formatRunTime, nextSelection, skillOwner, toPercent, type SkillEvalTarget } from "../helpers";
import { CompareRunsDialog } from "./_components/CompareRunsDialog";
import { s } from "./styles";

const COLUMNS = [
  "runs.history.startedAt",
  "runs.history.version",
  "runs.metrics.recall",
  "runs.metrics.precision",
  "runs.metrics.citationAccuracy",
  "runs.history.cases",
  "runs.history.cost",
] as const;

const SKILL_COLUMNS = [COLUMNS[0], COLUMNS[1], "skillEvals.history.host", ...COLUMNS.slice(2)] as const;

/** The run history of an agent or a skill with a selection of two completed runs and the compare view over them. */
export function RunHistory(
  props: { agentId: string } | { skill: SkillEvalTarget; hostNames: ReadonlyMap<string, string> },
) {
  const t = useTranslations("eval");
  const skill = "skill" in props ? props.skill : null;
  const hostNames = "skill" in props ? props.hostNames : null;
  const agentId = "skill" in props ? "" : props.agentId;
  const { data, isLoading, error } = useEvalRuns(skill ? skillOwner(skill) : agentId);
  const [picked, setPicked] = React.useState<string[]>([]);
  const [comparing, setComparing] = React.useState<[string, string] | null>(null);

  const runs = data ?? [];
  const completed = completedRuns(runs);
  const columns = hostNames ? SKILL_COLUMNS : COLUMNS;
  const selected = picked.filter((id) => completed.some((r) => r.id === id));
  const canCompare = selected.length === 2;

  const percent = (value: number | null) => {
    const p = toPercent(value);
    return p === null ? t("runs.noValue") : t("runs.percent", { value: p });
  };

  return (
    <section>
      {comparing &&
        (skill && hostNames ? (
          <CompareRunsDialog
            skillId={skill.id}
            hostNames={hostNames}
            baseId={comparing[0]}
            headId={comparing[1]}
            onClose={() => setComparing(null)}
          />
        ) : (
          <CompareRunsDialog
            agentId={agentId}
            baseId={comparing[0]}
            headId={comparing[1]}
            onClose={() => setComparing(null)}
          />
        ))}
      <SectionLabel
        icon="History"
        right={
          <div style={s.controls}>
            {selected.length > 0 && (
              <span style={s.selected}>{t("runs.history.selected", { count: selected.length })}</span>
            )}
            {completed.length < 2 && (
              <span id="eval-compare-hint" style={s.hint}>
                {t("runs.history.compareHint")}
              </span>
            )}
            <Button
              kind="primary"
              size="sm"
              icon="GitBranch"
              disabled={!canCompare}
              aria-describedby={completed.length < 2 ? "eval-compare-hint" : undefined}
              onClick={() => canCompare && setComparing([selected[0]!, selected[1]!])}
            >
              {t("runs.history.compare")}
            </Button>
          </div>
        }
      >
        {t("runs.history.title")}
      </SectionLabel>

      {isLoading && <Skeleton height={120} />}
      {error && (
        <div role="alert" style={s.error}>
          {error.message}
        </div>
      )}
      {!isLoading && !error && runs.length === 0 && <div style={s.empty}>{t("runs.history.empty")}</div>}
      {runs.length > 0 && (
        <div style={s.card}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th} />
                {columns.map((c) => (
                  <th key={c} style={s.th} scope="col">
                    {t(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  hostNames={hostNames}
                  checked={selected.includes(run.id)}
                  percent={percent}
                  onToggle={() => setPicked(nextSelection(selected, run.id))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RunRow({
  run,
  hostNames,
  checked,
  percent,
  onToggle,
}: {
  run: EvalRun;
  hostNames: ReadonlyMap<string, string> | null;
  checked: boolean;
  percent: (value: number | null) => string;
  onToggle: () => void;
}) {
  const t = useTranslations("eval");
  const time = formatRunTime(run.started_at);
  return (
    <tr style={checked ? s.rowSelected : undefined}>
      <td style={s.td}>
        {run.status === "done" && (
          <input
            type="checkbox"
            style={s.checkbox}
            checked={checked}
            aria-label={t("runs.history.selectRun", { time })}
            onChange={onToggle}
          />
        )}
      </td>
      <td className="mono" style={s.td}>
        {time}
      </td>
      <td className="mono" style={{ ...s.td, ...s.version }}>
        {t("runs.history.versionValue", { version: hostNames ? (run.skill_version ?? 0) : run.agent_version })}
      </td>
      {hostNames && (
        <td style={{ ...s.td, ...s.hostCell }}>
          {t("skillEvals.history.hostValue", {
            name: hostNames.get(run.agent_id) ?? t("runs.noValue"),
            version: run.agent_version,
          })}
        </td>
      )}
      {TREND_METRICS.map(({ key, color }) => (
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
      <td className="tnum" style={s.td}>
        {run.status === "running" ? (
          <span style={s.muted}>{t("runs.runningLabel")}</span>
        ) : run.status === "failed" ? (
          <span style={s.failed} title={run.error ?? undefined}>
            {t("runs.status.failed", { error: run.error ?? t("runs.noValue") })}
          </span>
        ) : (
          <span style={s.passed}>
            {t("runs.casesRatio", { passed: run.cases_passed, total: run.cases_total })}
          </span>
        )}
      </td>
      <td className="mono" style={s.td}>
        {formatUsd(run.cost_usd)}
      </td>
    </tr>
  );
}
