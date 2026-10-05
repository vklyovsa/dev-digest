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
    alignItems: "flex-start",
    gap: 10,
  } satisfies CSSProperties,
  item: {
    maxWidth: "100%",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  head: {
    display: "flex",
    alignItems: "stretch",
  } satisfies CSSProperties,
  main: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 0,
    padding: "8px 12px",
  } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    fontSize: 13,
    fontWeight: 500,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  severity: (color: string): CSSProperties => ({
    display: "inline-flex",
    color,
    flexShrink: 0,
  }),
  kind: {
    fontSize: 11.5,
    fontWeight: 400,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  paths: {
    display: "flex",
    flexWrap: "wrap",
    gap: "2px 12px",
  } satisfies CSSProperties,
  path: {
    fontSize: 11.5,
    color: "var(--accent-text)",
    textDecoration: "none",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  toggle: {
    display: "inline-flex",
    alignItems: "center",
    padding: "0 10px",
    background: "none",
    border: "none",
    borderLeft: "1px solid var(--border)",
    borderRadius: "0 8px 8px 0",
    color: "var(--text-muted)",
    cursor: "pointer",
  } satisfies CSSProperties,
  chevron: (open: boolean): CSSProperties => ({
    transform: open ? "rotate(180deg)" : "none",
    transition: "transform .15s",
  }),
  explanation: {
    margin: 0,
    padding: "8px 12px 10px",
    borderTop: "1px solid var(--border)",
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
  } satisfies CSSProperties,
} as const;
