"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { EvalCaseTryResult, EvalExpectationType } from "@devdigest/shared";
import { expectedCount } from "@/components/eval-runs";
import { formatUsd } from "@/components/run-cost";
import { s } from "./styles";

export interface TryResultProps {
  result: EvalCaseTryResult | null;
  error: Error | null;
  expectationType: EvalExpectationType;
  stale?: boolean;
  compact?: boolean;
  label?: string;
}

/** The outcome of one model call on a case: a verdict, the counts, and what the agent found. */
export function TryResult({ result, error, expectationType, stale, compact, label }: TryResultProps) {
  const t = useTranslations("eval");

  if (!result && !error) return null;

  let tone = { color: "var(--crit)", bg: "var(--crit-bg)" };
  if (result?.status === "pass") tone = { color: "var(--ok)", bg: "var(--ok-bg)" };
  else if (result?.status === "error") tone = { color: "var(--warn)", bg: "var(--warn-bg)" };

  return (
    <div role="status" aria-live="polite" aria-label={t("caseEditor.try.regionLabel")} style={s.box(tone.color, tone.bg)}>
      {label && <div style={s.label}>{label}</div>}
      {error && (
        <div role="alert" style={s.error}>
          {error.message}
        </div>
      )}
      {!error && result?.status === "error" && (
        <div role="alert" style={s.error}>
          {t("evalsTab.errored", { reason: result.error ?? t("runs.noValue") })}
        </div>
      )}
      {!error && result && result.status !== "error" && (
        <>
          <div style={s.head}>
            <span style={s.verdict(tone.color)}>
              {result.status === "pass" ? <Icon.CheckCircle size={15} /> : <Icon.XCircle size={15} />}
              {result.status === "pass" ? t("caseEditor.try.passed") : t("caseEditor.try.failed")}
            </span>
            <span>{t("evalsTab.expectedGot", { expected: expectedCount(expectationType), got: result.matched })}</span>
            <span>{t("caseEditor.try.duration", { seconds: result.duration_ms / 1000 })}</span>
            <span>{formatUsd(result.cost_usd)}</span>
          </div>
          {!compact &&
            (result.findings.length === 0 ? (
              <div>{t("caseEditor.try.noFindings")}</div>
            ) : (
              <>
                <div>{t("caseEditor.try.findings", { count: result.findings.length })}</div>
                <ul style={s.list}>
                  {result.findings.map((f, i) => (
                    <li key={`${f.file}:${f.start_line}:${i}`} style={s.item}>
                      <span style={s.mono}>
                        {f.file}:{f.start_line}–{f.end_line}
                      </span>
                      <span>{f.severity}</span>
                      <span>{f.title}</span>
                    </li>
                  ))}
                </ul>
              </>
            ))}
        </>
      )}
      {stale && <div style={s.stale}>{t("caseEditor.try.stale")}</div>}
    </div>
  );
}
