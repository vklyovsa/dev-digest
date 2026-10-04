import { describe, expect, it } from 'vitest';
import { BlastRadius, BlastRadiusResponse, PrHistory } from '@devdigest/shared';
import type { MergedPullWithFiles } from '@devdigest/shared';
import {
  buildPrHistory,
  buildSummary,
  isTestPath,
  toBlastRadiusResponse,
} from '../src/modules/blast/helpers.js';
import type { BlastMapContext } from '../src/modules/blast/types.js';
import type { BlastCallerRow, BlastResult } from '../src/modules/repo-intel/types.js';

const ctx: BlastMapContext = {
  indexStatus: 'full',
  indexedSha: 'idx123',
  changedFilesCount: 2,
  maxCallersPerSymbol: 20,
};

function row(over: Partial<BlastCallerRow> & Pick<BlastCallerRow, 'file' | 'viaSymbol'>): BlastCallerRow {
  return { symbol: 'handler', line: 10, rank: 0.5, ...over };
}

function result(over: Partial<BlastResult> = {}): BlastResult {
  return {
    changedSymbols: [
      { file: 'src/lib.ts', name: 'alpha', kind: 'function' },
      { file: 'src/lib.ts', name: 'beta', kind: 'function' },
      { file: 'src/lib.ts', name: 'gamma', kind: 'function' },
    ],
    callers: [],
    impactedEndpoints: [],
    degraded: false,
    ...over,
  };
}

describe('toBlastRadiusResponse — grouping', () => {
  it('groups a flat caller list by viaSymbol, callers by rank, groups by best rank then count then name', () => {
    const out = toBlastRadiusResponse(
      result({
        callers: [
          row({ file: 'src/low.ts', viaSymbol: 'alpha', rank: 0.1, symbol: 'low' }),
          row({ file: 'src/top.ts', viaSymbol: 'alpha', rank: 0.9, symbol: 'top' }),
          row({ file: 'src/b1.ts', viaSymbol: 'beta', rank: 0.9, symbol: 'b1' }),
          row({ file: 'src/b2.ts', viaSymbol: 'beta', rank: 0.2, symbol: 'b2' }),
          row({ file: 'src/b3.ts', viaSymbol: 'beta', rank: 0.2, symbol: 'b3' }),
          row({ file: 'src/g1.ts', viaSymbol: 'gamma', rank: 0.95, symbol: 'g1' }),
        ],
      }),
      ctx,
    );

    expect(out.downstream.map((d) => d.symbol)).toEqual(['gamma', 'beta', 'alpha']);
    expect(out.downstream[2]!.callers.map((c) => c.name)).toEqual(['top', 'low']);
    expect(out.downstream[1]!.callers.map((c) => c.name)).toEqual(['b1', 'b2', 'b3']);
    expect(out.downstream[2]!.callers[0]).toEqual({ name: 'top', file: 'src/top.ts', line: 10 });
  });

  it('breaks ties by caller count, then symbol name; callers tie-break by file then line', () => {
    const out = toBlastRadiusResponse(
      result({
        changedSymbols: [
          { file: 'src/lib.ts', name: 'zeta', kind: 'function' },
          { file: 'src/lib.ts', name: 'alpha', kind: 'function' },
          { file: 'src/lib.ts', name: 'mid', kind: 'function' },
        ],
        callers: [
          row({ file: 'src/z.ts', viaSymbol: 'zeta', rank: 0.5 }),
          row({ file: 'src/a.ts', viaSymbol: 'alpha', rank: 0.5 }),
          row({ file: 'src/m2.ts', viaSymbol: 'mid', rank: 0.5, line: 9 }),
          row({ file: 'src/m1.ts', viaSymbol: 'mid', rank: 0.5, line: 30 }),
          row({ file: 'src/m1.ts', viaSymbol: 'mid', rank: 0.5, line: 4, symbol: 'other' }),
        ],
      }),
      ctx,
    );

    expect(out.downstream.map((d) => d.symbol)).toEqual(['mid', 'alpha', 'zeta']);
    expect(out.downstream[0]!.callers.map((c) => `${c.file}:${c.line}`)).toEqual([
      'src/m1.ts:4',
      'src/m1.ts:30',
      'src/m2.ts:9',
    ]);
  });

  it('keeps a symbol without callers out of downstream but counts it in totals', () => {
    const out = toBlastRadiusResponse(
      result({ callers: [row({ file: 'src/a.ts', viaSymbol: 'alpha' })] }),
      ctx,
    );

    expect(out.changed_symbols).toHaveLength(3);
    expect(out.downstream.map((d) => d.symbol)).toEqual(['alpha']);
    expect(out.totals.symbols).toBe(3);
  });

  it('drops a caller located in the file that declares the same-named changed symbol', () => {
    const out = toBlastRadiusResponse(
      result({
        callers: [
          row({ file: 'src/lib.ts', viaSymbol: 'alpha', symbol: 'self' }),
          row({ file: 'src/other.ts', viaSymbol: 'alpha', symbol: 'real' }),
          row({ file: 'src/lib.ts', viaSymbol: 'beta', symbol: 'self' }),
        ],
      }),
      ctx,
    );

    expect(out.downstream).toHaveLength(1);
    expect(out.downstream[0]!.callers.map((c) => c.name)).toEqual(['real']);
    expect(out.totals.callers).toBe(1);
  });

  it('counts a function reaching two changed symbols as one caller', () => {
    const out = toBlastRadiusResponse(
      result({
        callers: [
          row({ file: 'src/a.ts', viaSymbol: 'alpha', symbol: 'run' }),
          row({ file: 'src/a.ts', viaSymbol: 'beta', symbol: 'run' }),
          row({ file: 'src/b.ts', viaSymbol: 'beta', symbol: 'run' }),
        ],
      }),
      ctx,
    );

    expect(out.totals.callers).toBe(2);
  });
});

describe('toBlastRadiusResponse — endpoints and crons', () => {
  const callers = [
    row({ file: 'src/routes.ts', viaSymbol: 'alpha', rank: 0.9, symbol: 'register' }),
    row({ file: 'src/jobs.ts', viaSymbol: 'alpha', rank: 0.8, symbol: 'schedule' }),
    row({ file: 'src/routes.ts', viaSymbol: 'alpha', rank: 0.7, symbol: 'again', line: 40 }),
    row({ file: 'test/routes.it.test.ts', viaSymbol: 'alpha', rank: 0.6, symbol: 'suite' }),
    row({ file: 'src/beta-caller.ts', viaSymbol: 'beta', rank: 0.4 }),
  ];
  const factsByFile = {
    'src/routes.ts': { endpoints: ['GET /x', 'POST /x'], crons: [] },
    'src/jobs.ts': { endpoints: [], crons: ['0 * * * *'] },
    'test/routes.it.test.ts': { endpoints: ['GET /pulls/${id}'], crons: ['job:test'] },
  };

  it('attributes endpoints and crons from the group caller files, de-duplicated and kept apart', () => {
    const out = toBlastRadiusResponse(result({ callers, factsByFile }), ctx);
    const alpha = out.downstream.find((d) => d.symbol === 'alpha')!;

    expect(alpha.endpoints_affected).toEqual(['GET /x', 'POST /x']);
    expect(alpha.crons_affected).toEqual(['0 * * * *']);
    expect(out.downstream.find((d) => d.symbol === 'beta')!.endpoints_affected).toEqual([]);
    expect(out.totals).toMatchObject({ endpoints: 2, crons: 1 });
  });

  it('keeps a test file as a caller but attributes none of its facts', () => {
    const out = toBlastRadiusResponse(result({ callers, factsByFile }), ctx);
    const alpha = out.downstream.find((d) => d.symbol === 'alpha')!;

    expect(alpha.callers.map((c) => c.file)).toContain('test/routes.it.test.ts');
    expect(alpha.endpoints_affected).not.toContain('GET /pulls/${id}');
    expect(alpha.crons_affected).not.toContain('job:test');
    expect(out.caller_file_facts.map((f) => f.file)).toEqual(['src/jobs.ts', 'src/routes.ts']);
  });

  it('lists each fact-bearing non-test caller file once, sorted by file', () => {
    const out = toBlastRadiusResponse(result({ callers, factsByFile }), ctx);

    expect(out.caller_file_facts).toEqual([
      { file: 'src/jobs.ts', endpoints: [], crons: ['0 * * * *'] },
      { file: 'src/routes.ts', endpoints: ['GET /x', 'POST /x'], crons: [] },
    ]);
  });

  it('attributes nothing without factsByFile, even when the flat endpoint list is not empty', () => {
    const out = toBlastRadiusResponse(
      result({ callers, impactedEndpoints: ['GET /flat'] }),
      ctx,
    );

    expect(out.downstream.every((d) => d.endpoints_affected.length === 0)).toBe(true);
    expect(out.downstream.every((d) => d.crons_affected.length === 0)).toBe(true);
    expect(out.caller_file_facts).toEqual([]);
    expect(out.totals.endpoints).toBe(0);
  });
});

describe('toBlastRadiusResponse — degraded and metadata', () => {
  it('passes the facade degraded flag and reason through unchanged', () => {
    const out = toBlastRadiusResponse(result({ degraded: true, reason: 'no_data' }), ctx);
    expect(out).toMatchObject({ degraded: true, reason: 'no_data' });
  });

  it('answers a null reason when the facade is degraded without one', () => {
    const out = toBlastRadiusResponse(result({ degraded: true }), ctx);
    expect(out).toMatchObject({ degraded: true, reason: null });
  });

  it('keeps the facade reason over the index status when both apply', () => {
    const out = toBlastRadiusResponse(
      result({ degraded: true, reason: 'flag_off' }),
      { ...ctx, indexStatus: 'partial' },
    );
    expect(out).toMatchObject({ degraded: true, reason: 'flag_off' });
  });

  it('adds index_partial when the index is partial and the facade says nothing', () => {
    const out = toBlastRadiusResponse(result(), { ...ctx, indexStatus: 'partial' });
    expect(out).toMatchObject({ degraded: true, reason: 'index_partial' });
  });

  it('is not degraded for a full index the facade served', () => {
    const out = toBlastRadiusResponse(result(), ctx);
    expect(out).toMatchObject({ degraded: false, reason: null });
  });

  it('carries the cap, the indexed sha and the file count; an empty sha becomes null', () => {
    const out = toBlastRadiusResponse(result(), ctx);
    expect(out).toMatchObject({
      max_callers_per_symbol: 20,
      indexed_sha: 'idx123',
      changed_files_count: 2,
    });
    expect(toBlastRadiusResponse(result(), { ...ctx, indexedSha: '' }).indexed_sha).toBeNull();
  });

  it('produces a body that parses as BlastRadius and as BlastRadiusResponse', () => {
    const out = toBlastRadiusResponse(
      result({
        callers: [row({ file: 'src/routes.ts', viaSymbol: 'alpha' })],
        factsByFile: { 'src/routes.ts': { endpoints: ['GET /x'], crons: [] } },
      }),
      ctx,
    );

    expect(() => BlastRadius.parse(out)).not.toThrow();
    expect(() => BlastRadiusResponse.parse(out)).not.toThrow();
    expect(
      BlastRadiusResponse.parse(toBlastRadiusResponse(result(), { ...ctx, changedFilesCount: 0 })),
    ).toMatchObject({ downstream: [], changed_files_count: 0 });
  });
});

describe('buildSummary', () => {
  it('has a sentence for no symbols', () => {
    expect(buildSummary({ symbols: 0, callers: 0, endpoints: 0, crons: 0 })).toBe(
      'No indexed symbols are declared in the changed files.',
    );
  });

  it('has a sentence for symbols without callers, singular and plural', () => {
    expect(buildSummary({ symbols: 1, callers: 0, endpoints: 0, crons: 0 })).toBe(
      '1 changed symbol with no downstream callers found.',
    );
    expect(buildSummary({ symbols: 3, callers: 0, endpoints: 0, crons: 0 })).toBe(
      '3 changed symbols with no downstream callers found.',
    );
  });

  it('has a sentence for reached callers, singular and plural', () => {
    expect(buildSummary({ symbols: 1, callers: 1, endpoints: 1, crons: 1 })).toBe(
      '1 changed symbol reaches 1 caller, 1 endpoint and 1 cron/job.',
    );
    expect(buildSummary({ symbols: 2, callers: 4, endpoints: 0, crons: 3 })).toBe(
      '2 changed symbols reach 4 callers, 0 endpoints and 3 cron/jobs.',
    );
  });
});

describe('isTestPath', () => {
  it.each([
    'a.test.ts',
    'a.it.test.ts',
    'a.spec.tsx',
    'server/test/x.ts',
    'e2e/run.ts',
    'src/__tests__/a.ts',
  ])('%s is a test path', (path) => {
    expect(isTestPath(path)).toBe(true);
  });

  it.each(['src/contest.ts', 'src/latest/a.ts', 'src/service.ts'])('%s is not', (path) => {
    expect(isTestPath(path)).toBe(false);
  });
});

describe('buildPrHistory', () => {
  const pr = (over: Partial<MergedPullWithFiles> & Pick<MergedPullWithFiles, 'number'>): MergedPullWithFiles => ({
    title: `PR ${over.number}`,
    author: 'dev',
    mergedAt: '2026-03-10T00:00:00Z',
    files: ['src/a.ts'],
    filesTruncated: false,
    ...over,
  });
  const current = { number: 500, changedFiles: ['src/a.ts', 'src/b.ts'] };

  it('excludes the current PR and PRs that share no file', () => {
    const out = buildPrHistory(
      [
        pr({ number: 500, mergedAt: '2026-03-20T00:00:00Z' }),
        pr({ number: 1, files: ['src/z.ts'] }),
        pr({ number: 2 }),
      ],
      current,
      10,
    );
    expect(out.map((i) => i.pr_number)).toEqual([2]);
  });

  it('keeps only PRs merged strictly before the current one when the current PR is itself merged', () => {
    const out = buildPrHistory(
      [
        pr({ number: 500, mergedAt: '2026-03-10T00:00:00Z' }),
        pr({ number: 3, mergedAt: '2026-03-20T00:00:00Z' }),
        pr({ number: 4, mergedAt: '2026-03-10T00:00:00Z' }),
        pr({ number: 2, mergedAt: '2026-03-01T00:00:00Z' }),
      ],
      current,
      10,
    );
    expect(out.map((i) => i.pr_number)).toEqual([2]);
  });

  it('keeps every overlapping PR when the current PR is not in the merged list', () => {
    const out = buildPrHistory(
      [
        pr({ number: 3, mergedAt: '2026-03-20T00:00:00Z' }),
        pr({ number: 2, mergedAt: '2026-03-01T00:00:00Z' }),
      ],
      current,
      10,
    );
    expect(out.map((i) => i.pr_number)).toEqual([3, 2]);
  });

  it('lists the newest merge first and breaks ties by number', () => {
    const out = buildPrHistory(
      [
        pr({ number: 10, mergedAt: '2026-03-01T00:00:00Z' }),
        pr({ number: 11, mergedAt: '2026-03-18T00:00:00Z' }),
        pr({ number: 12, mergedAt: '2026-03-18T00:00:00Z' }),
      ],
      current,
      10,
    );
    expect(out.map((i) => i.pr_number)).toEqual([12, 11, 10]);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 15 }, (_, i) => pr({ number: i + 1 }));
    expect(buildPrHistory(many, current, 10)).toHaveLength(10);
  });

  it('reports the shared files sorted and de-duplicated, with a deterministic note', () => {
    const [item] = buildPrHistory(
      [pr({ number: 7, files: ['src/b.ts', 'src/a.ts', 'src/a.ts', 'src/other.ts'] })],
      current,
      10,
    );
    expect(item).toEqual({
      pr_number: 7,
      title: 'PR 7',
      merged_at: '2026-03-10T00:00:00Z',
      author: 'dev',
      files_overlap: ['src/a.ts', 'src/b.ts'],
      notes: "Touched 2 of this PR's 2 changed files.",
    });
    expect(() => PrHistory.parse({ history: [item] })).not.toThrow();
  });

  it('uses the singular for a one-file PR and says when the other PR was cut short', () => {
    const [item] = buildPrHistory(
      [pr({ number: 8, files: ['src/a.ts', 'src/q.ts'], filesTruncated: true })],
      { number: 500, changedFiles: ['src/a.ts'] },
      10,
    );
    expect(item!.notes).toBe(
      "Touched 1 of this PR's 1 changed file. Only the first 2 files of that PR were compared.",
    );
  });
});
