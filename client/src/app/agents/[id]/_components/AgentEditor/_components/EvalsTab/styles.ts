import type { CSSProperties } from "react";

/** Co-located styles for EvalsTab. */
export const s = {
  stack: { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 22 } satisfies CSSProperties,
  link: {
    fontSize: 13,
    color: "var(--text-secondary)",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-muted)", margin: "-6px 0 14px" } satisfies CSSProperties,
  note: { fontSize: 12.5, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  failure: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    fontSize: 13,
    color: "var(--crit)",
  } satisfies CSSProperties,
  failureText: { display: "grid", gap: 2 } satisfies CSSProperties,
  heading: { fontSize: 18, fontWeight: 700, margin: "0 0 14px" } satisfies CSSProperties,
} as const;
