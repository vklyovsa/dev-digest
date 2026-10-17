import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" } satisfies CSSProperties,
  group: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  label: { fontSize: 12, fontWeight: 600, color: "var(--text-muted)" } satisfies CSSProperties,
  custom: { display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  error: { fontSize: 12, color: "var(--crit)", margin: 0 } satisfies CSSProperties,
} as const;
