"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Sparkline } from "@devdigest/ui";
import type { EvalRun } from "@devdigest/shared";
import type { TrendMetric } from "../constants";
import { DeltaMark } from "../DeltaMark";
import { deltaPoints, directionOf, toPercent } from "../helpers";
import { s } from "./styles";

type MetricKey = "recall" | "precision" | "citation_accuracy";

const METRICS: { key: MetricKey; label: "recall" | "precision" | "citationAccuracy"; color: string }[] = [
  { key: "recall", label: "recall", color: "var(--accent)" },
  { key: "precision", label: "precision", color: "var(--ok)" },
  { key: "citation_accuracy", label: "citationAccuracy", color: "var(--warn)" },
];

/**
 * Recall, precision, citation accuracy of the newest completed run with their
 * change against the previous one, and the cases passed. Parents decide where
 * it sits; it holds nothing else.
 */
export function MetricTiles({
  latest,
  previous,
  sparklines,
}: {
  latest: EvalRun | null;
  previous: EvalRun | null;
  sparklines?: Record<TrendMetric, number[] | null>;
}) {
  const t = useTranslations("eval");
  return (
    <div style={s.row}>
      {METRICS.map(({ key, label, color }) => {
        const value = latest?.[key] ?? null;
        const percent = toPercent(value);
        const delta = previous ? deltaPoints(value, previous[key]) : null;
        const values = sparklines?.[key] ?? null;
        return (
          <div key={key} style={s.tile}>
            <div style={s.label}>{t(`runs.metrics.${label}`)}</div>
            {values && (
              <span aria-hidden="true" data-sparkline={key} style={s.sparkline}>
                <Sparkline data={values} color={color} w={56} h={20} />
              </span>
            )}
            <div style={s.valueRow}>
              <span className="tnum" style={s.value(color)}>
                {percent === null ? t("runs.noValue") : t("runs.percent", { value: percent })}
              </span>
              {delta !== null && (
                <DeltaMark direction={directionOf(delta)}>
                  {t("runs.delta", { points: Math.abs(delta) })}
                </DeltaMark>
              )}
            </div>
          </div>
        );
      })}
      <div style={s.tile}>
        <div style={s.label}>{t("runs.metrics.casesPassed")}</div>
        <div style={s.valueRow}>
          <span className="tnum" style={s.value("var(--text-primary)")}>
            {latest
              ? t("runs.casesRatio", { passed: latest.cases_passed, total: latest.cases_total })
              : t("runs.noValue")}
          </span>
        </div>
      </div>
    </div>
  );
}
