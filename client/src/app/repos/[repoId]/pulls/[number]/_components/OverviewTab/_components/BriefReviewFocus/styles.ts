import type { CSSProperties } from "react";

export const s = {
  empty: {
    margin: 0,
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  list: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  item: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: "2px 14px",
    fontSize: 13,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  target: {
    fontSize: 12.5,
    color: "var(--accent-text)",
    textDecoration: "none",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  reason: {
    color: "var(--text-secondary)",
    minWidth: 0,
  } satisfies CSSProperties,
} as const;
