import type { CSSProperties } from "react";
import { DROPDOWN_WIDTH } from "./constants";

export const s = {
  root: { position: "relative", display: "inline-block" },
  panel: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    zIndex: 50,
    width: DROPDOWN_WIDTH,
    padding: 10,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
  },
  warning: { fontSize: 12, color: "var(--text-muted)", paddingBottom: 6, borderBottom: "1px solid var(--border)" },
  agentRow: { display: "flex", flexDirection: "column", gap: 2 },
  hint: { fontSize: 11, color: "var(--text-muted)", marginLeft: 26 },
  link: {
    border: "none",
    background: "transparent",
    padding: 0,
    textAlign: "left",
    fontSize: 12,
    color: "var(--text-muted)",
    cursor: "pointer",
    fontFamily: "inherit",
  },
} satisfies Record<string, CSSProperties>;
