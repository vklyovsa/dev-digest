import type { CSSProperties } from "react";

/** Co-located styles for CiRunsTable. */
export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
    overflowX: "auto",
  } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 } satisfies CSSProperties,
  th: {
    textAlign: "left",
    padding: "11px 14px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    borderBottom: "1px solid var(--border)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  td: {
    padding: "11px 14px",
    borderBottom: "1px solid var(--border)",
    verticalAlign: "top",
    minWidth: 0,
  } satisfies CSSProperties,
  wrap: { overflowWrap: "anywhere", maxWidth: 220 } satisfies CSSProperties,
  nowrap: { whiteSpace: "nowrap" } satisfies CSSProperties,
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
  link: { color: "var(--accent)", textDecoration: "none" } satisfies CSSProperties,
} as const;
