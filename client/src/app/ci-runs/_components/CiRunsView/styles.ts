import type { CSSProperties } from "react";

/** Co-located styles for CiRunsView. */
export const s = {
  page: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: 18,
    padding: "24px 28px",
    alignContent: "start",
  } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", gap: 16 } satisfies CSSProperties,
  titles: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  title: { fontSize: 20, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" } satisfies CSSProperties,
  notice: {
    display: "grid",
    gap: 4,
    padding: "10px 14px",
    border: "1px solid var(--border-strong)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  noticeTitle: { fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  noticeItem: { overflowWrap: "anywhere" } satisfies CSSProperties,
  failure: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    fontSize: 13,
    color: "var(--crit)",
  } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
