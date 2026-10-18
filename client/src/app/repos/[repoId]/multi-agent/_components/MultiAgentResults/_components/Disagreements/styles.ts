import type { CSSProperties } from "react";

export const s = {
  root: { marginTop: 22 },
  list: { display: "flex", flexDirection: "column", gap: 10 },
  group: { border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--bg-elevated)" },
  groupHead: { display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" },
  file: { fontSize: 12, overflowWrap: "anywhere" },
  title: { fontSize: 13, fontWeight: 600, marginLeft: 6, overflowWrap: "anywhere" },
  takes: (n: number): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
    gap: 1,
    background: "var(--border)",
  }),
  take: { padding: "10px 14px", background: "var(--bg-elevated)", minWidth: 0 },
  takeAgent: { fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4, overflowWrap: "anywhere" },
  didNotFlag: { fontSize: 11, fontWeight: 600, color: "var(--text-muted)" },
  note: { fontSize: 12.5, color: "var(--text-muted)" },
} satisfies Record<string, CSSProperties | ((n: number) => CSSProperties)>;
