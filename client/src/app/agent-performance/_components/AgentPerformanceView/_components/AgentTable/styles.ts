import type { CSSProperties } from "react";

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
    minWidth: 0,
  } satisfies CSSProperties,
  table: { width: "100%", tableLayout: "fixed", borderCollapse: "collapse", fontSize: 13 } satisfies CSSProperties,
  th: {
    textAlign: "left",
    padding: "11px 14px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    borderBottom: "1px solid var(--border)",
    verticalAlign: "bottom",
  } satisfies CSSProperties,
  td: {
    padding: "11px 14px",
    borderBottom: "1px solid var(--border)",
    minWidth: 0,
    overflow: "hidden",
  } satisfies CSSProperties,
  name: { fontWeight: 600 } satisfies CSSProperties,
  noRuns: { color: "var(--text-muted)" } satisfies CSSProperties,
  sortBtn: {
    all: "unset",
    cursor: "pointer",
    textTransform: "uppercase",
    letterSpacing: "inherit",
    fontWeight: "inherit",
    fontSize: "inherit",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  rate: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" } satisfies CSSProperties,
  basis: { display: "block", color: "var(--text-muted)", fontSize: 11.5 } satisfies CSSProperties,
  muted: { color: "var(--text-muted)", fontSize: 12 } satisfies CSSProperties,
  view: {
    all: "unset",
    cursor: "pointer",
    fontWeight: 600,
    color: "var(--accent)",
  } satisfies CSSProperties,
} as const;
