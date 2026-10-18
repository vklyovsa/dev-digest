import type { CSSProperties } from "react";

export const s = {
  top: { padding: "18px 28px 4px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  heading: { fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" },
  switcher: { marginLeft: "auto", display: "flex", gap: 6 },
  meta: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 28px",
    borderBottom: "1px solid var(--border)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
    flexWrap: "wrap",
  },
  prNumber: { color: "var(--text-muted)" },
  prTitle: { fontWeight: 600, color: "var(--text-primary)", overflowWrap: "anywhere" },
  metaRight: { marginLeft: "auto" },
  body: { padding: "20px 28px 40px" },
} satisfies Record<string, CSSProperties>;
