import type { CSSProperties } from "react";

export const s = {
  page: {
    padding: "24px 32px 44px",
    maxWidth: 1100,
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: 24,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 } satisfies CSSProperties,
  heading: { display: "grid", gap: 4, minWidth: 0 } satisfies CSSProperties,
  subtitle: { margin: 0, fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  kpiSkeleton: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 16,
  } satisfies CSSProperties,
  skeletonStack: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: 12,
  } satisfies CSSProperties,
} as const;
