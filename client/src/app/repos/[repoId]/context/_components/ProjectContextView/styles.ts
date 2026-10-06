import type { CSSProperties } from "react";

export const s = {
  page: {
    display: "flex",
    flexDirection: "column",
    height: "calc(100vh - 52px)",
    minHeight: 0,
  } satisfies CSSProperties,
  body: { flex: 1, display: "flex", minHeight: 0 } satisfies CSSProperties,
  alert: {
    margin: "12px 16px 0",
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    color: "var(--text-primary)",
    fontSize: 13,
  } satisfies CSSProperties,
} as const;
