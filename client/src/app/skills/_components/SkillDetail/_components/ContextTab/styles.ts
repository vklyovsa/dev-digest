import type { CSSProperties } from "react";

/** Co-located styles for the skill's Context tab. */
export const s = {
  header: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-muted)", margin: "8px 0 18px" } satisfies CSSProperties,
  tokens: {
    marginTop: 16,
    paddingTop: 14,
    borderTop: "1px solid var(--border)",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  serializesAs: {
    margin: "22px 0 8px",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.08em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  serialized: {
    margin: 0,
    padding: "14px 16px",
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
} as const;
