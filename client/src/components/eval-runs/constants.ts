export const TREND_METRICS = [
  { key: "recall", labelKey: "dashboard.legend.recall", color: "var(--accent)" },
  { key: "precision", labelKey: "dashboard.legend.precision", color: "var(--ok)" },
  { key: "citation_accuracy", labelKey: "dashboard.legend.citation", color: "var(--warn)" },
] as const;

export type TrendMetric = (typeof TREND_METRICS)[number]["key"];
