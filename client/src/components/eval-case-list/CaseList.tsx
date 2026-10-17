"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, type IconName } from "@devdigest/ui";
import type { EvalCase } from "@devdigest/shared";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { TryResult } from "@/components/eval-case-editor";
import { useDeleteEvalCase, useTryEvalCase } from "@/lib/hooks/evals";
import { EVAL_NO_HOST_HINT_ID, expectedCount, skillOwner, type SkillEvalTarget } from "@/components/eval-runs";
import type { EvalOwner } from "@/lib/hooks/evals";
import { passingCounts } from "./helpers";
import { s } from "./styles";

/**
 * The agent's eval cases, oldest first. The header carries the heading, the
 * count and the passing badge; `control` is the run control and `actions` the
 * slot after it.
 */
type CaseListProps = {
  cases: EvalCase[];
  listStamp?: number;
  control?: React.ReactNode;
  actions?: React.ReactNode;
  onEdit?: (c: EvalCase) => void;
} & ({ agentId: string; skill?: undefined } | { skill: SkillEvalTarget; agentId?: undefined });

export function CaseList({ cases, agentId, skill, listStamp, control, actions, onEdit }: CaseListProps) {
  const t = useTranslations("eval");
  const owner: string | EvalOwner = skill ? skillOwner(skill) : agentId;
  const noHost = skill ? skill.host === null : false;
  const del = useDeleteEvalCase(owner);
  const [deleting, setDeleting] = React.useState<EvalCase | null>(null);
  const { passed, run } = passingCounts(cases);

  const close = () => {
    del.reset();
    setDeleting(null);
  };

  return (
    <section>
      <div style={s.header}>
        <h2 style={s.heading}>{t("evalsTab.casesHeading")}</h2>
        {cases.length > 0 && (
          <>
            <Badge color="var(--ok)" bg="var(--ok-bg)">
              {t("evalsTab.passing", { passed, run })}
            </Badge>
            <span style={s.count}>{t("evalsTab.count", { count: cases.length })}</span>
          </>
        )}
        <div style={s.actions}>
          {control}
          {actions}
        </div>
      </div>

      {cases.length === 0 ? (
        <div style={s.empty}>{t("evalsTab.emptyCases")}</div>
      ) : (
        <ul style={s.list}>
          {cases.map((c) => (
            <CaseRow
              key={`${c.id}:${listStamp}`}
              item={c}
              owner={owner}
              noHost={noHost}
              onEdit={onEdit ? () => onEdit(c) : undefined} onDelete={() => setDeleting(c)}
            />
          ))}
        </ul>
      )}

      {deleting && (
        <ConfirmDialog
          title={t("evalsTab.deleteTitle")}
          body={t("evalsTab.deleteBody", { name: deleting.name })}
          confirmLabel={t("evalsTab.delete")}
          busy={del.isPending}
          error={del.error}
          onConfirm={() => del.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
          onCancel={close}
        />
      )}
    </section>
  );
}

function CaseRow({
  item,
  owner,
  noHost,
  onEdit,
  onDelete,
}: {
  item: EvalCase;
  owner: string | EvalOwner;
  noHost: boolean;
  onEdit?: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("eval");
  const tryCase = useTryEvalCase(owner);
  const runTrial = () =>
    tryCase.mutate({
      expectation_type: item.expectation_type,
      input_diff: item.input_diff,
      input_meta: {
        pr_number: item.input_meta.pr_number,
        pr_title: item.input_meta.pr_title,
        pr_author: item.input_meta.pr_author,
        pr_body: item.input_meta.pr_body,
      },
      expected_output: {
        file: item.expected_output.file,
        start_line: item.expected_output.start_line,
        end_line: item.expected_output.end_line,
      },
    });
  const { file, start_line, end_line, severity, category } = item.expected_output;
  return (
    <li style={s.row}>
      <div style={s.main}>
        <div className="mono" style={s.name}>
          {item.name}
        </div>
        <div style={s.result}>
          <CaseResult item={item} />
        </div>
        <TryResult
          compact
          label={t("evalsTab.trial")}
          result={tryCase.data ?? null}
          error={tryCase.error}
          expectationType={item.expectation_type}
        />
      </div>
      <div style={s.meta}>
        <span>
          {item.expectation_type === "must_find"
            ? t("evalsTab.expectation.mustFind")
            : t("evalsTab.expectation.mustNotFlag")}
        </span>
        <span className="mono" style={s.file}>
          {file}:{start_line}–{end_line}
        </span>
        {(severity || category) && (
          <span style={s.tag}>
            {severity && <span style={s.severity}>{severity}</span>}
            {severity && category && " · "}
            {category}
          </span>
        )}
      </div>
      <div style={s.rowActions}>
        <button
          type="button"
          style={s.runButton}
          aria-label={t("evalsTab.runCase", { name: item.name })}
          title={t("evalsTab.runCaseTitle")}
          disabled={noHost || tryCase.isPending}
          aria-describedby={noHost ? EVAL_NO_HOST_HINT_ID : undefined}
          onClick={runTrial}
        >
          {tryCase.isPending ? t("evalsTab.running") : <Icon.Play size={16} />}
        </button>
        {onEdit && (
          <button type="button" style={s.iconButton} aria-label={t("evalsTab.editCase", { name: item.name })} onClick={onEdit}>
            <Icon.Edit size={16} />
          </button>
        )}
        <button type="button" style={s.iconButton} aria-label={t("evalsTab.deleteCase", { name: item.name })} onClick={onDelete}>
          <Icon.Trash size={16} />
        </button>
      </div>
    </li>
  );
}

function CaseResult({ item }: { item: EvalCase }) {
  const t = useTranslations("eval");
  const last = item.last_result;
  const mark = (icon: IconName, color: string, text: string) => {
    const I = Icon[icon];
    return (
      <span style={s.status(color)}>
        <I size={15} />
        {text}
      </span>
    );
  };

  if (!last) return mark("Dot", "var(--text-muted)", t("evalsTab.neverRun"));
  if (last.status === "error") {
    return mark("AlertTriangle", "var(--warn)", t("evalsTab.errored", { reason: last.error ?? t("runs.noValue") }));
  }
  const got = t("evalsTab.expectedGot", { expected: expectedCount(item.expectation_type), got: last.matched });
  return (
    <>
      {last.status === "pass"
        ? mark("CheckCircle", "var(--ok)", t("evalsTab.passed"))
        : mark("XCircle", "var(--crit)", t("evalsTab.failed"))}
      <span>{got}</span>
    </>
  );
}
