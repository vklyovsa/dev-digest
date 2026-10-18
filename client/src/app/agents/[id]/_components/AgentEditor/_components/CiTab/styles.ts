import type { CSSProperties } from "react";

/** Co-located styles for CiTab. */
export const s = {
  stack: { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 22 } satisfies CSSProperties,
  heading: { fontSize: 18, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" } satisfies CSSProperties,
  sectionTitle: { fontSize: 14, fontWeight: 700, margin: "0 0 10px" } satisfies CSSProperties,
  list: { display: "grid", gap: 10, margin: 0, padding: 0, listStyle: "none" } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 14,
    padding: "12px 14px",
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
    fontSize: 13,
  } satisfies CSSProperties,
  repo: { fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" } satisfies CSSProperties,
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  group: { display: "grid", gap: 8, border: 0, margin: 0, padding: 0 } satisfies CSSProperties,
  option: { display: "flex", alignItems: "center", gap: 8, fontSize: 13 } satisfies CSSProperties,
  note: { fontSize: 12.5, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)", overflowWrap: "anywhere" } satisfies CSSProperties,
  failure: { display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
} as const;
