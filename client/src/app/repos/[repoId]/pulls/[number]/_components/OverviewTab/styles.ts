import type { CSSProperties } from "react";

export const s = {
  briefRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 24,
    alignItems: "flex-start",
  } satisfies CSSProperties,
  intentCell: {
    flex: "2 1 340px",
    minWidth: 0,
  } satisfies CSSProperties,
  blastCell: {
    flex: "3 1 460px",
    minWidth: 0,
  } satisfies CSSProperties,
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;
