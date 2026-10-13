"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, Modal, Skeleton } from "@devdigest/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useAgent, usePromoteAgentVersion } from "@/lib/hooks/agents";
import { useEvalCompare, useSkillEvalCompare } from "@/lib/hooks/evals";
import { collapseUnchanged, diffLines } from "@/lib/text-diff";
import { formatUsd } from "@/components/run-cost";
import { TREND_METRICS } from "../../../constants";
import { DeltaMark } from "../../../DeltaMark";
import { costDelta, deltaPoints, directionOf, toPercent } from "../../../helpers";
import { CURRENT_NOTE_ID, FOCUSABLE_SELECTOR } from "./constants";
import { compareView, type CompareConfigRow } from "./helpers";
import { s } from "./styles";

/**
 * The two runs side by side: a card per metric, older → newer with the difference, what
 * changed in the configuration, and the system prompt diff. `base` is the older
 * run — the server orders the pair by start time.
 */
export function CompareRunsDialog({
  agentId,
  skillId,
  hostNames,
  baseId,
  headId,
  onClose,
}: (
  | { agentId: string; skillId?: undefined; hostNames?: undefined }
  | { skillId: string; hostNames: ReadonlyMap<string, string>; agentId?: undefined }
) & {
  baseId: string;
  headId: string;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const isSkill = skillId !== undefined;
  const agentCompare = useEvalCompare(agentId ?? null, baseId, headId);
  const skillCompare = useSkillEvalCompare(skillId ?? null, baseId, headId);
  const { isLoading, error } = isSkill ? skillCompare : agentCompare;
  const { data: agent } = useAgent(agentId ?? null);
  const promote = usePromoteAgentVersion(agentId ?? "");
  const [confirming, setConfirming] = React.useState(false);
  const [outcome, setOutcome] = React.useState<{ kind: "done" | "unchanged"; version: number } | null>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  // Focus goes back to the control that opened the dialog. Captured during the
  // first render, before autoFocus moves it onto Close.
  const [opener] = React.useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );
  React.useEffect(() => () => opener?.focus?.(), [opener]);

  React.useEffect(() => {
    if (confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = bodyRef.current?.closest('[role="dialog"]');
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirming]);

  const none = t("runs.noValue");
  const data = isSkill ? skillCompare.data : agentCompare.data;
  const view = React.useMemo(() => {
    if (isSkill) {
      return skillCompare.data
        ? compareView({ kind: "skill", data: skillCompare.data, hostNames: hostNames!, none })
        : null;
    }
    return agentCompare.data ? compareView({ kind: "agent", data: agentCompare.data, none }) : null;
  }, [isSkill, skillCompare.data, agentCompare.data, hostNames, none]);

  const diff = React.useMemo(
    () => (view ? collapseUnchanged(diffLines(view.baseText, view.headText)) : []),
    [view],
  );

  const cost = data ? costDelta(data.head.cost_usd, data.base.cost_usd) : null;

  const headVersion = isSkill ? undefined : agentCompare.data?.head.agent_version;
  const isCurrent = agent !== undefined && headVersion === agent.version;

  const confirmPromote = () => {
    if (!agent || headVersion === undefined) return;
    const from = agent.version;
    promote.mutate(headVersion, {
      onSuccess: (updated) => setOutcome({ kind: updated.version === from ? "unchanged" : "done", version: updated.version }),
      onSettled: () => setConfirming(false),
    });
  };

  const percent = (value: number | null) => {
    const p = toPercent(value);
    return p === null ? t("runs.noValue") : t("runs.percent", { value: p });
  };

  return (
    <Modal
      width={900}
      title={
        view
          ? t(isSkill ? "skillEvals.compare.title" : "runs.compare.title", {
              base: view.baseVersion,
              head: view.headVersion,
            })
          : t("runs.history.compare")
      }
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {!isSkill && data && agent && headVersion !== undefined && (
            <div style={s.promote}>
              {outcome ? (
                <span role="status">
                  {t(outcome.kind === "done" ? "runs.compare.promote.done" : "runs.compare.promote.unchanged", {
                    version: outcome.version,
                  })}
                </span>
              ) : (
                <>
                  {promote.error && (
                    <span role="alert" style={s.promoteError}>
                      {promote.error.message}
                    </span>
                  )}
                  {isCurrent && (
                    <span id={CURRENT_NOTE_ID} style={s.promoteNote}>
                      {t("runs.compare.promote.current", { version: headVersion })}
                    </span>
                  )}
                  <Button
                    kind="secondary"
                    onClick={() => {
                      promote.reset();
                      setConfirming(true);
                    }}
                    disabled={isCurrent}
                    aria-describedby={isCurrent ? CURRENT_NOTE_ID : undefined}
                  >
                    {t("runs.compare.promote.action", { version: headVersion })}
                  </Button>
                </>
              )}
            </div>
          )}
          <Button kind="ghost" onClick={onClose} autoFocus>
            {t("runs.compare.close")}
          </Button>
          {!isSkill && confirming && agent && headVersion !== undefined && (
            <ConfirmDialog
              danger={false}
              busy={promote.isPending}
              title={t("runs.compare.promote.dialogTitle", { version: headVersion })}
              body={t("runs.compare.promote.dialogBody", { from: agent.version, version: headVersion })}
              confirmLabel={t("runs.compare.promote.confirm")}
              onConfirm={confirmPromote}
              onCancel={() => setConfirming(false)}
            />
          )}
        </div>
      }
    >
      <div ref={bodyRef} style={s.body}>
        {isLoading && <Skeleton height={160} />}
        {error && (
          <div role="alert" style={s.error}>
            <span>{t("runs.compare.loadError")}</span>
            <span>{error.message}</span>
          </div>
        )}
        {data && view && (
          <>
            <ul style={s.cards}>
              {TREND_METRICS.map(({ key, labelKey, color }) => {
                const delta = deltaPoints(data.head[key], data.base[key]);
                return (
                  <MetricCard
                    key={key}
                    label={t(labelKey)}
                    older={percent(data.base[key])}
                    newer={percent(data.head[key])}
                    color={color}
                  >
                    {delta !== null && (
                      <DeltaMark direction={directionOf(delta)}>
                        {t("runs.delta", { points: Math.abs(delta) })}
                      </DeltaMark>
                    )}
                  </MetricCard>
                );
              })}
              <MetricCard
                label={t("runs.compare.cost")}
                older={formatUsd(data.base.cost_usd)}
                newer={formatUsd(data.head.cost_usd)}
                color="var(--text-primary)"
              >
                {cost !== null && (
                  <DeltaMark direction={directionOf(cost)} tone="neutral">
                    {formatUsd(Math.abs(cost))}
                  </DeltaMark>
                )}
              </MetricCard>
            </ul>

            <ConfigChanges rows={view.configRows} />

            {(data.cases_only_in_base.length > 0 ||
              data.cases_only_in_head.length > 0 ||
              data.cases_edited.length > 0) && (
              <div style={s.notice}>
                {(data.cases_only_in_base.length > 0 || data.cases_only_in_head.length > 0) && (
                  <span>{t("runs.compare.differentCases")}</span>
                )}
                {data.cases_only_in_base.length > 0 && (
                  <span>
                    {isSkill
                      ? t("skillEvals.compare.onlyInOlder", { names: data.cases_only_in_base.join(", ") })
                      : t("runs.compare.onlyIn", {
                          version: view.baseVersion,
                          names: data.cases_only_in_base.join(", "),
                        })}
                  </span>
                )}
                {data.cases_only_in_head.length > 0 && (
                  <span>
                    {isSkill
                      ? t("skillEvals.compare.onlyInNewer", { names: data.cases_only_in_head.join(", ") })
                      : t("runs.compare.onlyIn", {
                          version: view.headVersion,
                          names: data.cases_only_in_head.join(", "),
                        })}
                  </span>
                )}
                {data.cases_edited.length > 0 && (
                  <span>
                    {t("runs.compare.edited", {
                      count: data.cases_edited.length,
                      names: data.cases_edited.join(", "),
                    })}
                  </span>
                )}
              </div>
            )}

            <section>
              <h3 style={s.heading}>
                <Icon.FileText size={14} aria-hidden="true" />
                {t(isSkill ? "skillEvals.compare.bodyHeading" : "runs.compare.promptHeading")}
              </h3>
              {view.sameText ? (
                <p style={s.unchanged}>
                  {t(isSkill ? "skillEvals.compare.bodyUnchanged" : "runs.compare.promptUnchanged")}
                </p>
              ) : (
                <pre style={s.diff}>
                  {diff.map((line, i) => (
                    <div key={i} style={s.diffLine(line.op)}>
                      <span aria-hidden="true" style={s.diffSign(line.op)}>
                        {line.op === "add" ? "+" : line.op === "remove" ? "−" : " "}
                      </span>
                      {line.op !== "same" && (
                        <span style={s.hidden}>
                          {line.op === "add" ? t("runs.compare.added") : t("runs.compare.removed")}
                        </span>
                      )}
                      {line.text}
                    </div>
                  ))}
                </pre>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}

function MetricCard({
  label,
  older,
  newer,
  color,
  children,
}: {
  label: string;
  older: string;
  newer: string;
  color: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("eval");
  return (
    <li style={s.card}>
      <div style={s.cardLabel}>{label}</div>
      <div style={s.cardValues}>
        <span style={s.hidden}>{t("runs.compare.older")}</span>
        <span className="tnum" style={s.older}>
          {older}
        </span>
        <Icon.ArrowRight size={13} aria-hidden="true" style={s.arrow} />
        <span style={s.hidden}>{t("runs.compare.newer")}</span>
        <span className="tnum" style={s.newer(color)}>
          {newer}
        </span>
        <span style={s.hidden}>{t("runs.compare.difference")}</span>
        {children || <span style={s.older}>{t("runs.noValue")}</span>}
      </div>
    </li>
  );
}

const CONFIG_LABEL_KEYS: Record<CompareConfigRow["id"], string> = {
  provider: "runs.compare.provider",
  model: "runs.compare.model",
  skills: "runs.compare.skills",
  hostAgent: "skillEvals.compare.hostAgent",
  hostVersion: "skillEvals.compare.hostVersion",
};

/** What differs in the configuration of the two runs, listed above the text diff. */
function ConfigChanges({ rows }: { rows: CompareConfigRow[] }) {
  const t = useTranslations("eval");
  if (rows.length === 0) return null;
  return (
    <section>
      <h3 style={s.heading}>{t("runs.compare.configHeading")}</h3>
      <ul style={s.list}>
        {rows.map((r) => (
          <li key={r.id}>
            <strong>{t(CONFIG_LABEL_KEYS[r.id])}</strong> {r.from} → {r.to}
          </li>
        ))}
      </ul>
    </section>
  );
}
