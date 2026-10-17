import type { CSSProperties } from "react";

/** Co-located styles for MetricTiles. */
export const s = {
  row: { display: "flex", gap: 14, flexWrap: "wrap" } satisfies CSSProperties,
  tile: {
    flex: "1 1 160px",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: 18,
    position: "relative",
  } satisfies CSSProperties,
  sparkline: { position: "absolute", top: 16, right: 18 } satisfies CSSProperties,
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.03em",
  } satisfies CSSProperties,
  valueRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    marginTop: 12,
    minHeight: 40,
  } satisfies CSSProperties,
  value: (color: string): CSSProperties => ({
    fontSize: 32,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color,
  }),
} as const;
