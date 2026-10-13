import type { CSSProperties } from "react";

/** Co-located styles for the skill EvalsTab. */
export const s = {
  stack: { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 22 } satisfies CSSProperties,
  hostRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 360px)",
    gap: 6,
    fontSize: 13,
  } satisfies CSSProperties,
  hostLabel: { fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  notice: {
    fontSize: 13,
    color: "var(--text-secondary)",
    margin: 0,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-muted)", margin: "-6px 0 14px" } satisfies CSSProperties,
  note: { fontSize: 12.5, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  failure: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    fontSize: 13,
    color: "var(--crit)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  failureText: { display: "grid", gap: 2, minWidth: 0 } satisfies CSSProperties,
  heading: { fontSize: 18, fontWeight: 700, margin: "0 0 14px" } satisfies CSSProperties,
} as const;
