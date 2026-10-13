import type { CSSProperties } from "react";

export const s = {
  anchor: { display: "contents" } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)", alignSelf: "center" } satisfies CSSProperties,
  created: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: "var(--ok)",
  } satisfies CSSProperties,
  link: { color: "var(--accent)", textDecoration: "underline" } satisfies CSSProperties,
  error: { fontSize: 12, color: "var(--crit)", alignSelf: "center" } satisfies CSSProperties,
} as const;
