import type { CSSProperties } from "react";

/** Co-located styles for the skill VersionsTab. */
export const s = {
  header: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-muted)",
    margin: "4px 0 18px",
    maxWidth: 620,
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "12px 16px",
    marginBottom: 8,
  } satisfies CSSProperties,
  versionChip: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--accent)",
    background: "var(--accent-bg)",
    padding: "3px 8px",
    borderRadius: 5,
  } satisfies CSSProperties,
  rowText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  note: { fontSize: 14, fontWeight: 600 } satisfies CSSProperties,
  meta: { fontSize: 12, color: "var(--text-muted)", marginTop: 3 } satisfies CSSProperties,
} as const;
