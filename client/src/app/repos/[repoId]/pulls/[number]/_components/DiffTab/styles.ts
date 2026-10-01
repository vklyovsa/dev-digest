import type { CSSProperties } from "react";
import { PR_HEADER_HEIGHT_VAR } from "../../constants";

export const s = {
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  } satisfies CSSProperties,
  summary: { fontSize: 13, color: "var(--text-secondary)", flex: 1 } satisfies CSSProperties,
  add: { color: "var(--code-add-text)" } satisfies CSSProperties,
  del: { color: "var(--code-del-text)" } satisfies CSSProperties,
  hint: {
    fontSize: 13,
    color: "var(--text-muted)",
    padding: "8px 12px",
    marginBottom: 14,
    border: "1px dashed var(--border)",
    borderRadius: 7,
  } satisfies CSSProperties,
  notice: { fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10 } satisfies CSSProperties,
  groups: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  segmented: {
    display: "inline-flex",
    gap: 2,
    padding: 2,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  groupHeaderWrap: {
    position: "sticky",
    top: `var(${PR_HEADER_HEIGHT_VAR}, 0px)`,
    zIndex: 1,
    background: "var(--bg-primary)",
  } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "10px 4px",
    border: "none",
    background: "transparent",
    color: "var(--text-primary)",
    cursor: "pointer",
    textAlign: "left",
    fontSize: 13,
  } satisfies CSSProperties,
  swatch: { width: 10, height: 10, borderRadius: 2, flexShrink: 0 } satisfies CSSProperties,
  groupLabel: { fontWeight: 700 } satisfies CSSProperties,
  groupDescription: {
    color: "var(--text-muted)",
    fontSize: 12.5,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  groupFlagged: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    color: "var(--crit)",
    fontSize: 12,
    fontWeight: 600,
  } satisfies CSSProperties,
  flaggedDot: { width: 6, height: 6, borderRadius: "50%", background: "var(--crit)" } satisfies CSSProperties,
  groupCount: { color: "var(--text-muted)", fontSize: 12 } satisfies CSSProperties,
  groupBody: { paddingBottom: 10 } satisfies CSSProperties,
} as const;

export function groupChevron(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
    flexShrink: 0,
  };
}

export function segmentFor(active: boolean): CSSProperties {
  return active
    ? { fontWeight: 600, color: "var(--text-primary)", background: "var(--bg-hover)", boxShadow: "0 1px 2px rgba(0,0,0,.35)" }
    : { fontWeight: 500, color: "var(--text-muted)" };
}
