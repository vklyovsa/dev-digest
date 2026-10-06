import type { CSSProperties } from "react";

export const s = {
  summaryRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
  } satisfies CSSProperties,
  summary: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px 18px",
    flex: "1 1 auto",
    minWidth: 0,
    margin: 0,
    padding: 0,
    listStyle: "none",
  } satisfies CSSProperties,
  stat: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  statIcon: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  statValue: {
    color: "var(--text-primary)",
    fontWeight: 700,
  } satisfies CSSProperties,

  segmented: {
    display: "inline-flex",
    flexShrink: 0,
    gap: 2,
    padding: 2,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,

  symbolRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "7px 8px",
    border: "none",
    borderRadius: 6,
    background: "transparent",
    color: "var(--text-primary)",
    fontSize: 13.5,
    textAlign: "left",
    cursor: "pointer",
  } satisfies CSSProperties,
  symbolRowOpen: {
    background: "var(--bg-hover)",
  } satisfies CSSProperties,
  symbolIcon: {
    color: "var(--accent)",
    flexShrink: 0,
  } satisfies CSSProperties,
  symbolName: {
    flex: 1,
    minWidth: 0,
    fontWeight: 600,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  callerCount: {
    marginLeft: "auto",
    color: "var(--text-muted)",
    fontSize: 12,
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  groupBody: {
    paddingLeft: 18,
    paddingBottom: 8,
  } satisfies CSSProperties,
  callerList: {
    margin: "4px 0 0",
    padding: "0 0 0 10px",
    listStyle: "none",
    borderLeft: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,
  callerItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "3px 4px",
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  callerIcon: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  callerLink: {
    minWidth: 0,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  factRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  } satisfies CSSProperties,
  muted: {
    margin: 0,
    marginTop: 8,
    fontSize: 12.5,
    lineHeight: 1.45,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  note: {
    margin: 0,
    marginTop: 6,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  degraded: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
    padding: "9px 11px",
    borderRadius: 7,
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
  degradedText: {
    flex: "1 1 220px",
    fontSize: 12.5,
    lineHeight: 1.45,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  degradedNote: {
    flexBasis: "100%",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  error: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 8,
    padding: "9px 11px",
    borderRadius: 7,
    background: "var(--crit-bg)",
    color: "var(--crit)",
    fontSize: 12.5,
    lineHeight: 1.45,
  } satisfies CSSProperties,

  graph: {
    display: "block",
    width: "100%",
    height: "auto",
  } satisfies CSSProperties,
  graphText: {
    fontSize: 11.5,
  } satisfies CSSProperties,
  legend: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px 14px",
    marginTop: 8,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  legendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,

  historyBox: {
    marginTop: 16,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
    overflow: "hidden",
  } satisfies CSSProperties,
  historyHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "11px 12px",
    border: "none",
    background: "transparent",
    color: "var(--text-primary)",
    fontSize: 13,
    fontWeight: 600,
    textAlign: "left",
    cursor: "pointer",
  } satisfies CSSProperties,
  historyIcon: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  historyList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
  } satisfies CSSProperties,
  historyItem: {
    padding: "10px 12px",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  historyEmpty: {
    margin: 0,
    padding: "10px 12px",
    borderTop: "1px solid var(--border)",
    fontSize: 12.5,
    lineHeight: 1.45,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  historyTitle: {
    fontSize: 13,
    fontWeight: 600,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  historyMeta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  historyFiles: {
    display: "flex",
    flexWrap: "wrap",
    gap: "2px 10px",
    marginTop: 6,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;

export function segmentFor(active: boolean): CSSProperties {
  return active
    ? { fontWeight: 600, color: "var(--text-primary)", background: "var(--bg-hover)", boxShadow: "0 1px 2px rgba(0,0,0,.35)", textTransform: "capitalize" }
    : { fontWeight: 500, color: "var(--text-muted)", textTransform: "capitalize" };
}

export function chevron(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
    flexShrink: 0,
  };
}

export function historyChevron(open: boolean): CSSProperties {
  return {
    marginLeft: "auto",
    color: "var(--text-muted)",
    transform: open ? "rotate(180deg)" : "none",
    transition: "transform .12s",
    flexShrink: 0,
  };
}

export function legendDot(color: string): CSSProperties {
  return {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
  };
}
