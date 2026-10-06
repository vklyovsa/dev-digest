import type {
  BlastCallerFileFacts,
  BlastDegradedReason,
  BlastRadiusResponse,
  BlastTotals,
  DownstreamImpact,
  MergedPullWithFiles,
  PrHistoryItem,
} from '@devdigest/shared';
import type { BlastCallerRow, BlastResult } from '../repo-intel/types.js';
import { TEST_PATH_PATTERNS } from './constants.js';
import type { BlastMapContext } from './types.js';

export function isTestPath(path: string): boolean {
  return TEST_PATH_PATTERNS.some((re) => re.test(path));
}

function compare<T extends string | number>(a: T, b: T): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

export function buildSummary(totals: BlastTotals): string {
  const { symbols, callers, endpoints, crons } = totals;
  if (symbols === 0) return 'No indexed symbols are declared in the changed files.';
  if (callers === 0) return `${count(symbols, 'changed symbol')} with no downstream callers found.`;
  return `${count(symbols, 'changed symbol')} ${symbols === 1 ? 'reaches' : 'reach'} ${count(callers, 'caller')}, ${count(endpoints, 'endpoint')} and ${count(crons, 'cron/job')}.`;
}

/**
 * Translates the facade's flat caller list into the wire contract: callers
 * grouped under the changed symbol they reach, endpoints and crons attributed
 * from the files those callers live in.
 */
export function toBlastRadiusResponse(
  result: BlastResult,
  ctx: BlastMapContext,
): BlastRadiusResponse {
  const changedSymbols = result.changedSymbols.map((s) => ({
    name: s.name,
    file: s.file,
    kind: s.kind,
  }));

  const declaredIn = new Map<string, Set<string>>();
  for (const s of result.changedSymbols) {
    const files = declaredIn.get(s.name);
    if (files) files.add(s.file);
    else declaredIn.set(s.name, new Set([s.file]));
  }

  const grouped = new Map<string, BlastCallerRow[]>();
  for (const row of result.callers) {
    if (declaredIn.get(row.viaSymbol)?.has(row.file)) continue;
    const rows = grouped.get(row.viaSymbol);
    if (rows) rows.push(row);
    else grouped.set(row.viaSymbol, [row]);
  }

  const facts = result.factsByFile ?? {};
  const groups: { impact: DownstreamImpact; bestRank: number }[] = [];
  const factFiles = new Map<string, { endpoints: Set<string>; crons: Set<string> }>();

  for (const [symbol, rows] of grouped) {
    rows.sort((a, b) => b.rank - a.rank || compare(a.file, b.file) || a.line - b.line);

    const endpoints = new Set<string>();
    const crons = new Set<string>();
    for (const row of rows) {
      if (isTestPath(row.file)) continue;
      const f = facts[row.file];
      if (!f) continue;
      for (const e of f.endpoints) endpoints.add(e);
      for (const c of f.crons) crons.add(c);
      if (f.endpoints.length > 0 || f.crons.length > 0) {
        const entry = factFiles.get(row.file) ?? { endpoints: new Set(), crons: new Set() };
        for (const e of f.endpoints) entry.endpoints.add(e);
        for (const c of f.crons) entry.crons.add(c);
        factFiles.set(row.file, entry);
      }
    }

    groups.push({
      bestRank: rows[0]?.rank ?? 0,
      impact: {
        symbol,
        callers: rows.map((r) => ({ name: r.symbol, file: r.file, line: r.line })),
        endpoints_affected: [...endpoints],
        crons_affected: [...crons],
      },
    });
  }

  groups.sort(
    (a, b) =>
      b.bestRank - a.bestRank ||
      b.impact.callers.length - a.impact.callers.length ||
      compare(a.impact.symbol, b.impact.symbol),
  );
  const downstream = groups.map((g) => g.impact);

  const callerKeys = new Set<string>();
  const allEndpoints = new Set<string>();
  const allCrons = new Set<string>();
  for (const d of downstream) {
    for (const c of d.callers) callerKeys.add(`${c.file}#${c.name}`);
    for (const e of d.endpoints_affected) allEndpoints.add(e);
    for (const c of d.crons_affected) allCrons.add(c);
  }

  const totals: BlastTotals = {
    symbols: changedSymbols.length,
    callers: callerKeys.size,
    endpoints: allEndpoints.size,
    crons: allCrons.size,
  };

  const callerFileFacts: BlastCallerFileFacts[] = [...factFiles]
    .map(([file, f]) => ({ file, endpoints: [...f.endpoints], crons: [...f.crons] }))
    .sort((a, b) => compare(a.file, b.file));

  const reason: BlastDegradedReason | null =
    result.degraded === true
      ? (result.reason ?? null)
      : ctx.indexStatus === 'partial'
        ? 'index_partial'
        : null;

  return {
    changed_symbols: changedSymbols,
    downstream,
    summary: buildSummary(totals),
    totals,
    degraded: result.degraded === true || ctx.indexStatus === 'partial',
    reason,
    max_callers_per_symbol: ctx.maxCallersPerSymbol,
    indexed_sha: ctx.indexedSha || null,
    changed_files_count: ctx.changedFilesCount,
    caller_file_facts: callerFileFacts,
  };
}

export function buildPrHistory(
  merged: MergedPullWithFiles[],
  current: { number: number; changedFiles: string[] },
  maxItems: number,
): PrHistoryItem[] {
  const changed = new Set(current.changedFiles);
  const total = current.changedFiles.length;
  const matches: { pr: MergedPullWithFiles; overlap: string[] }[] = [];
  // Only an already-merged PR appears in `merged`; an open one keeps every overlapping PR.
  const self = merged.find((pr) => pr.number === current.number);

  for (const pr of merged) {
    if (pr.number === current.number) continue;
    if (self && pr.mergedAt >= self.mergedAt) continue;
    const overlap = [...new Set(pr.files.filter((f) => changed.has(f)))].sort();
    if (overlap.length > 0) matches.push({ pr, overlap });
  }

  matches.sort(
    (a, b) => compare(b.pr.mergedAt, a.pr.mergedAt) || compare(b.pr.number, a.pr.number),
  );

  return matches.slice(0, maxItems).map(({ pr, overlap }) => ({
    pr_number: pr.number,
    title: pr.title,
    merged_at: pr.mergedAt,
    author: pr.author,
    files_overlap: overlap,
    notes:
      `Touched ${overlap.length} of this PR's ${total} changed ${total === 1 ? 'file' : 'files'}.` +
      (pr.filesTruncated ? ` Only the first ${pr.files.length} files of that PR were compared.` : ''),
  }));
}
