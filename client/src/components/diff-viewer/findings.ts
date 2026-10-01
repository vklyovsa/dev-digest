import type { CSSProperties, ReactNode } from "react";
import type { FindingRecord } from "@devdigest/shared";
import { lineKey } from "./comments";

export interface DiffFindingsApi {
  findings: FindingRecord[];
  flaggedPaths: ReadonlySet<string>;
  showCards: boolean;
  renderFinding: (f: FindingRecord) => ReactNode;
  labels: {
    line: (severity: string) => string;
    outside: (count: number) => string;
    flagged: string;
  };
}
export function findingKey(f: Pick<FindingRecord, "start_line">): string | null {
  return lineKey("RIGHT", f.start_line);
}
export function partitionFindings(
  findings: FindingRecord[],
  renderedKeys: Set<string>,
): { matched: Map<string, FindingRecord[]>; outside: FindingRecord[] } {
  const matched = new Map<string, FindingRecord[]>();
  const outside: FindingRecord[] = [];
  for (const f of findings) {
    const key = findingKey(f);
    if (key && renderedKeys.has(key)) {
      const list = matched.get(key) ?? [];
      list.push(f);
      matched.set(key, list);
    } else {
      outside.push(f);
    }
  }
  return { matched, outside };
}

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };
export function topSeverity(findings: readonly Pick<FindingRecord, "severity">[]): string | undefined {
  let best: string | undefined;
  for (const { severity } of findings) {
    const rank = SEVERITY_RANK[severity] ?? Number.MAX_SAFE_INTEGER;
    const bestRank = best === undefined ? Infinity : (SEVERITY_RANK[best] ?? Number.MAX_SAFE_INTEGER);
    if (rank < bestRank) best = severity;
  }
  return best;
}

export const fs = {
  pathWrap: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--crit)",
    flexShrink: 0,
  } satisfies CSSProperties,
  lineLabel: {
    marginLeft: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    paddingRight: 12,
    fontSize: 12,
    fontWeight: 600,
    flexShrink: 0,
  } satisfies CSSProperties,
} as const;
