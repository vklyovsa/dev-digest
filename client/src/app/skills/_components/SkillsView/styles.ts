import type { CSSProperties } from "react";

/** Co-located styles for the /skills two-pane layout. */
export const s = {
  page: { display: "flex", height: "calc(100vh - 52px)", minHeight: 0 } satisfies CSSProperties,
  placeholder: { flex: 1, display: "grid", placeItems: "center" } satisfies CSSProperties,
} as const;
