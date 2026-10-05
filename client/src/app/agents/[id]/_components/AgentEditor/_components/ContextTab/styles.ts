import type { CSSProperties } from "react";

/** Co-located styles for the agent's Context tab. */
export const s = {
  header: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-muted)", margin: "8px 0 18px" } satisfies CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    marginTop: 16,
    paddingTop: 14,
    borderTop: "1px solid var(--border)",
    fontSize: 13,
  } satisfies CSSProperties,
  tokens: { fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  note: { color: "var(--text-muted)", textAlign: "right" } satisfies CSSProperties,
} as const;
