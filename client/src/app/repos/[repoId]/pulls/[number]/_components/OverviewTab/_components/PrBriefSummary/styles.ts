import type { CSSProperties } from "react";

export const s = {
  summary: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  details: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginTop: 12,
  } satisfies CSSProperties,
  controls: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
  } satisfies CSSProperties,
  meta: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  emptyCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 10,
  } satisfies CSSProperties,
  emptyText: {
    fontSize: 14,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  emptyHint: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginBottom: 4,
  } satisfies CSSProperties,

  skeletonStack: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    width: "100%",
  } satisfies CSSProperties,

  notice: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "9px 11px",
    borderRadius: 7,
    background: "var(--info-bg)",
    color: "var(--text-secondary)",
    fontSize: 12.5,
    lineHeight: 1.45,
  } satisfies CSSProperties,
  staleNotice: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "9px 11px",
    borderRadius: 7,
    background: "var(--warn-bg)",
    color: "var(--text-secondary)",
    fontSize: 12.5,
    lineHeight: 1.45,
  } satisfies CSSProperties,

  documents: {
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  documentsLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    marginBottom: 6,
  } satisfies CSSProperties,
  documentList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 3,
  } satisfies CSSProperties,

  error: {
    marginBottom: 12,
    padding: "9px 11px",
    borderRadius: 7,
    background: "var(--crit-bg)",
    color: "var(--crit)",
    fontSize: 12.5,
    lineHeight: 1.45,
  } satisfies CSSProperties,
  loadError: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    padding: "9px 11px",
    borderRadius: 7,
    background: "var(--crit-bg)",
    color: "var(--crit)",
    fontSize: 12.5,
    lineHeight: 1.45,
  } satisfies CSSProperties,
} as const;
