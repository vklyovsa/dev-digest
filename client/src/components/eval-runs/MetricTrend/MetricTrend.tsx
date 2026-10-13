"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { EvalRun } from "@devdigest/shared";
import { formatUsd } from "@/components/run-cost";
import { TREND_METRICS } from "../constants";
import { formatRunTime, plottedRuns, toPercent } from "../helpers";
import { axisBounds, lineSegments, stepActive, xFraction, yFraction } from "./helpers";
import { s } from "./styles";

export interface MetricTrendProps {
  runs: EvalRun[] | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}

const TREND_DEFAULT_WIDTH = 620;
const TREND_HEIGHT = 200;
const PAD = { l: 36, r: 14, t: 14, b: 24 };
const PLOT_H = TREND_HEIGHT - PAD.t - PAD.b;

export function MetricTrend({ runs, loading, failed, onRetry }: MetricTrendProps) {
  const t = useTranslations("eval");
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(TREND_DEFAULT_WIDTH);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const plotted = plottedRuns(runs ?? []);
  const count = plotted.length;
  const hasPlot = !failed && !loading && count > 0;

  useEffect(() => {
    const el = plotRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && next > 0) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasPlot]);

  const series = TREND_METRICS.map((m) => {
    const values = plotted.map((r) => r[m.key]);
    return { ...m, values, segments: lineSegments(values) };
  });
  const bounds = axisBounds(series.flatMap((m) => m.values.filter((v): v is number => v !== null)));

  const plotW = Math.max(width - PAD.l - PAD.r, 1);
  const xAt = (i: number) => PAD.l + xFraction(i, count) * plotW;
  const yAt = (v: number) => PAD.t + (1 - yFraction(v, bounds)) * PLOT_H;

  const active = activeIndex !== null && activeIndex < count ? activeIndex : null;
  const activeRun = active === null ? null : (plotted[active] ?? null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setActiveIndex(stepActive(active, e.key, count));
    } else if (e.key === "Escape") {
      setActiveIndex(null);
    }
  };

  const tooltipSide: React.CSSProperties =
    active === null
      ? {}
      : xFraction(active, count) <= 0.5
        ? { left: `${(xAt(active) / width) * 100}%` }
        : { right: `${((width - xAt(active)) / width) * 100}%` };

  const pathFor = (segment: number[], values: (number | null)[]) =>
    segment.map((i, n) => `${n === 0 ? "M" : "L"}${xAt(i)} ${yAt(values[i]!)}`).join(" ");

  return (
    <section style={s.card}>
      <div style={s.header}>
        <h3 style={s.heading}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
            <polyline points="16 7 22 7 22 13" />
          </svg>
          {t("dashboard.metricTrend")}
        </h3>
        <div style={s.legend}>
          {TREND_METRICS.map((m) => (
            <span key={m.key} style={s.legendItem}>
              <span style={{ ...s.swatch, background: m.color }} aria-hidden="true" />
              {t(m.labelKey)}
            </span>
          ))}
        </div>
      </div>

      {failed ? (
        <div style={s.error}>
          <span>{t("trend.loadError")}</span>
          <button type="button" onClick={onRetry}>
            {t("evalsTab.retry")}
          </button>
        </div>
      ) : loading ? (
        <div style={s.notice}>{t("dashboard.loading")}</div>
      ) : count === 0 ? (
        <div style={s.notice}>{t("trend.empty")}</div>
      ) : null}

      {hasPlot && (
        <>
          <div
            ref={plotRef}
            role="group"
            tabIndex={0}
            aria-label={t("trend.plotLabel", { title: t("dashboard.metricTrend"), count })}
            style={s.plot}
            onKeyDown={onKeyDown}
            onBlur={() => setActiveIndex(null)}
            onMouseLeave={() => setActiveIndex(null)}
          >
            <svg width={width} height={TREND_HEIGHT} style={s.svg} aria-hidden="true">
              {bounds.ticks.map((tick) => (
                <g key={tick}>
                  <line x1={PAD.l} x2={PAD.l + plotW} y1={yAt(tick)} y2={yAt(tick)} stroke="var(--border)" strokeOpacity={0.6} />
                  <text x={PAD.l - 8} y={yAt(tick)} textAnchor="end" dominantBaseline="middle" style={s.tick}>
                    {tick.toFixed(1)}
                  </text>
                </g>
              ))}
              {plotted.map((run, i) => (
                <text key={run.id} x={xAt(i)} y={TREND_HEIGHT - 6} textAnchor="middle" style={s.versionLabel}>
                  {t("runs.history.versionValue", { version: run.agent_version })}
                </text>
              ))}
              {active !== null && (
                <line x1={xAt(active)} x2={xAt(active)} y1={PAD.t} y2={PAD.t + PLOT_H} stroke="var(--border-strong, var(--text-muted))" strokeOpacity={0.6} strokeDasharray="3 3" />
              )}
              {series.map((m) =>
                m.segments.map((segment) => (
                  <path
                    key={`${m.key}-${plotted[segment[0]!]!.id}`}
                    data-series={m.key}
                    d={pathFor(segment, m.values)}
                    fill="none"
                    stroke={m.color}
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )),
              )}
              {series.map((m) =>
                m.values.map((v, i) =>
                  v === null ? null : (
                    <circle
                      key={`${m.key}-${plotted[i]!.id}`}
                      data-series={m.key}
                      data-run-index={i}
                      cx={xAt(i)}
                      cy={yAt(v)}
                      r={3}
                      fill={m.color}
                    />
                  ),
                ),
              )}
              {plotted.map((run, i) => {
                const left = i === 0 ? PAD.l : (xAt(i - 1) + xAt(i)) / 2;
                const right = i === count - 1 ? PAD.l + plotW : (xAt(i) + xAt(i + 1)) / 2;
                return (
                  <rect
                    key={run.id}
                    data-run-band={i}
                    x={left}
                    y={PAD.t}
                    width={Math.max(right - left, 0)}
                    height={PLOT_H}
                    fill="transparent"
                    onMouseEnter={() => setActiveIndex(i)}
                  />
                );
              })}
            </svg>
            <div role="status" aria-live="polite" style={{ ...s.tooltip, ...tooltipSide, opacity: activeRun ? 1 : 0 }}>
              {activeRun && (
                <>
                  <div style={s.tooltipVersion}>{t("runs.history.versionValue", { version: activeRun.agent_version })}</div>
                  <div style={s.tooltipMuted}>{formatRunTime(activeRun.started_at)}</div>
                  {TREND_METRICS.map((m) => {
                    const pct = toPercent(activeRun[m.key]);
                    return (
                      <div key={m.key} style={s.tooltipRow}>
                        <span style={{ ...s.tooltipDot, background: m.color }} aria-hidden="true" />
                        {t("trend.metricValue", {
                          name: t(m.labelKey),
                          value: pct === null ? t("runs.noValue") : t("runs.percent", { value: pct }),
                        })}
                      </div>
                    );
                  })}
                  <div>{t("trend.cases", { passed: activeRun.cases_passed, total: activeRun.cases_total })}</div>
                  <div>{t("trend.metricValue", { name: t("dashboard.table.cost"), value: formatUsd(activeRun.cost_usd) })}</div>
                </>
              )}
            </div>
          </div>
          <div style={s.caption}>{t("trend.caption", { count })}</div>
        </>
      )}
    </section>
  );
}
