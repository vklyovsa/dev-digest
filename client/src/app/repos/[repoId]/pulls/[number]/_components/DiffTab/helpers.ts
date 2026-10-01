import type { FindingRecord, PrFile, ReviewRecord, SmartDiff, SmartDiffRole } from "@devdigest/shared";

export interface JoinedGroup {
  role: SmartDiffRole;
  files: PrFile[];
  flaggedCount: number;
}

/** Mirrors the server's `newestPerAgent` (the shared package is type-only). */
export function currentFindings(reviews: ReviewRecord[] | undefined): FindingRecord[] {
  const newestFirst = (reviews ?? [])
    .filter((r) => r.kind === "review")
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const seen = new Set<string>();
  const out: FindingRecord[] = [];
  for (const r of newestFirst) {
    const key = r.agent_id ?? r.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(...r.findings);
  }
  return out;
}

export function hasReview(reviews: ReviewRecord[] | undefined): boolean {
  return (reviews ?? []).some((r) => r.kind === "review");
}

export function flaggedPaths(smartDiff: SmartDiff | undefined): Set<string> {
  const paths = new Set<string>();
  for (const g of smartDiff?.groups ?? []) {
    for (const f of g.files) if (f.finding_lines.length > 0) paths.add(f.path);
  }
  return paths;
}

/** A `pr.files` path missing from every group lands in core, so nothing is dropped. */
export function joinGroupFiles(groups: SmartDiff["groups"], prFiles: PrFile[]): JoinedGroup[] {
  const byPath = new Map(prFiles.map((f) => [f.path, f]));
  const placed = new Set<string>();
  const out: JoinedGroup[] = groups.map((g) => ({
    role: g.role,
    files: g.files.map((sf) => {
      placed.add(sf.path);
      return byPath.get(sf.path) ?? { path: sf.path, additions: sf.additions, deletions: sf.deletions, patch: null };
    }),
    flaggedCount: g.files.filter((f) => f.finding_lines.length > 0).length,
  }));

  const orphans = prFiles.filter((f) => !placed.has(f.path));
  if (orphans.length > 0) {
    let core = out.find((g) => g.role === "core");
    if (!core) {
      core = { role: "core", files: [], flaggedCount: 0 };
      out.unshift(core);
    }
    core.files.push(...orphans);
  }
  return out;
}

export function diffTotals(files: PrFile[]): { files: number; additions: number; deletions: number } {
  return {
    files: files.length,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
  };
}
