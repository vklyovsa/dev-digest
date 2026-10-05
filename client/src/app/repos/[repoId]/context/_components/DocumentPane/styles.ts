import type { CSSProperties } from "react";

export const s = {
  pane: { flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "14px 28px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  name: {
    flex: 1,
    minWidth: 0,
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  usedBy: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  body: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    padding: "28px 40px 48px",
    fontSize: 14,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  skeletons: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
} as const;
