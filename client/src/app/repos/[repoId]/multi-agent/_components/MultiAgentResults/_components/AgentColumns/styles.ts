import type { CSSProperties } from "react";

export const s = {
  grid: (n: number): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
    gap: 12,
  }),
  column: {
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minWidth: 0,
  },
  header: { padding: 12, borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 9 },
  headerMain: { minWidth: 0, flex: 1 },
  name: { fontSize: 12.5, fontWeight: 600, overflowWrap: "anywhere" },
  sub: { fontSize: 10.5, color: "var(--text-muted)" },
  status: { fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" },
  errorText: { fontSize: 12, color: "var(--crit)", overflowWrap: "anywhere" },
  list: { padding: 12, display: "flex", flexDirection: "column", gap: 7, flex: 1 },
  finding: { padding: "8px 10px", borderRadius: 6, background: "var(--bg-surface)", border: "1px solid var(--border)" },
  findingTitle: { fontSize: 12, fontWeight: 600, lineHeight: 1.3, overflowWrap: "anywhere" },
  findingFile: { fontSize: 10.5, color: "var(--text-muted)", marginTop: 4, overflowWrap: "anywhere" },
  empty: { fontSize: 12, color: "var(--text-muted)" },
  footer: {
    padding: "9px 12px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-surface)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  count: { fontSize: 11, color: "var(--text-muted)" },
} satisfies Record<string, CSSProperties | ((n: number) => CSSProperties)>;
