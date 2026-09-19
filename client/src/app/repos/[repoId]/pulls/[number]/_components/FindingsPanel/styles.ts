import type { CSSProperties } from "react";

/** Co-located styles for FindingsPanel (extracted from inline styles). */
export const s = {
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  divider: {
    width: 1,
    height: 18,
    background: "var(--border)",
    margin: "0 2px",
  } satisfies CSSProperties,
  pillRow: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  /** A severity pill: quiet until selected, then outlined in its own colour. */
  pill: (color: string, bg: string, active: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.03em",
    cursor: "pointer",
    color: active ? color : "var(--text-secondary)",
    background: active ? bg : "transparent",
    border: `1px solid ${active ? color : "var(--border)"}`,
  }),
  toggleGroup: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
} as const;
