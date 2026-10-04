import { describe, expect, it, vi } from 'vitest';
import { BlastHistoryResponse, BlastRadiusResponse, PrHistory } from '@devdigest/shared';
import type { MergedPullWithFiles } from '@devdigest/shared';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import { NotFoundError } from '../src/platform/errors.js';
import { BlastService } from '../src/modules/blast/service.js';
import { HISTORY_SCAN_LIMIT } from '../src/modules/blast/constants.js';
import type { BlastDeps, BlastPullRecord } from '../src/modules/blast/types.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';
import type { BlastResult, IndexState, IndexStatus } from '../src/modules/repo-intel/types.js';

const PR: BlastPullRecord = { id: 'pr-1', repoId: 'repo-1', number: 482 };

function indexState(status: IndexStatus, sha = 'idx123'): IndexState {
  return {
    repoId: 'repo-1',
    status,
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 1,
    lastIndexedSha: sha,
    indexerVersion: 2,
    updatedAt: new Date(0),
  };
}

const facadeResult: BlastResult = {
  changedSymbols: [
    { file: 'src/lib.ts', name: 'alpha', kind: 'function' },
    { file: 'src/lib.ts', name: 'beta', kind: 'function' },
  ],
  callers: [
    { file: 'src/routes.ts', symbol: 'register', viaSymbol: 'alpha', line: 12, rank: 0.8 },
    { file: 'src/jobs.ts', symbol: 'tick', viaSymbol: 'alpha', line: 7, rank: 0.4 },
  ],
  impactedEndpoints: ['GET /x'],
  factsByFile: {
    'src/routes.ts': { endpoints: ['GET /x'], crons: [] },
    'src/jobs.ts': { endpoints: [], crons: ['0 * * * *'] },
  },
  degraded: false,
};

function setup(
  over: {
    pull?: BlastPullRecord | undefined;
    files?: string[];
    result?: BlastResult;
    state?: IndexState;
    repo?: { id: string; owner: string; name: string } | undefined;
    github?: BlastDeps['github'];
  } = {},
) {
  const log = { info: vi.fn(), warn: vi.fn() };
  const getBlastRadius = vi.fn(async () => over.result ?? facadeResult);
  const listFiles = vi.fn(async () =>
    (over.files ?? ['src/lib.ts', 'src/other.ts']).map((path) => ({ path })),
  );
  const github = vi.fn(over.github ?? (async () => new MockGitHubClient()));
  const service = new BlastService({
    pulls: {
      getById: async () => ('pull' in over ? over.pull : PR),
      listFiles,
    },
    repos: {
      getById: async () => ('repo' in over ? over.repo : { id: 'repo-1', owner: 'acme', name: 'api' }),
    },
    repoIntel: { getBlastRadius, getIndexState: async () => over.state ?? indexState('full') },
    github,
    log,
  });
  return { service, log, getBlastRadius, listFiles, github };
}

describe('BlastService.forPull', () => {
  it('asks the facade once with the stored paths and serves the cap and sha from the server side', async () => {
    const { service, getBlastRadius, log } = setup();

    const out = await service.forPull('ws-1', 'pr-1');

    expect(getBlastRadius).toHaveBeenCalledTimes(1);
    expect(getBlastRadius).toHaveBeenCalledWith('repo-1', ['src/lib.ts', 'src/other.ts']);
    expect(out.max_callers_per_symbol).toBe(MAX_CALLERS_PER_SYMBOL);
    expect(out.indexed_sha).toBe('idx123');
    expect(out.changed_files_count).toBe(2);
    expect(out.totals).toEqual({ symbols: 2, callers: 2, endpoints: 1, crons: 1 });
    expect(() => BlastRadiusResponse.parse(out)).not.toThrow();

    expect(log.info).toHaveBeenCalledTimes(1);
    const [fields, message] = log.info.mock.calls[0]!;
    expect(message).toBe('blast radius served');
    expect(fields).toMatchObject({
      prId: 'pr-1',
      repoId: 'repo-1',
      source: 'index',
      indexStatus: 'full',
      symbols: 2,
      callers: 2,
      endpoints: 1,
      crons: 1,
      degraded: false,
      reason: null,
    });
    expect(typeof fields.durationMs).toBe('number');
  });

  it('passes a degraded facade answer through and logs the fallback source', async () => {
    const { service, log } = setup({
      result: { ...facadeResult, degraded: true, reason: 'no_data' },
      state: indexState('degraded', ''),
    });

    const out = await service.forPull('ws-1', 'pr-1');

    expect(out).toMatchObject({ degraded: true, reason: 'no_data', indexed_sha: null });
    expect(log.info.mock.calls[0]![0]).toMatchObject({
      source: 'fallback',
      indexStatus: 'degraded',
      degraded: true,
      reason: 'no_data',
    });
  });

  it('marks a partial index as degraded when the facade served it as complete', async () => {
    const { service } = setup({ state: indexState('partial') });
    const out = await service.forPull('ws-1', 'pr-1');
    expect(out).toMatchObject({ degraded: true, reason: 'index_partial' });
  });

  it('asks the facade once, with an empty list, for a PR without stored files', async () => {
    const { service, getBlastRadius } = setup({
      files: [],
      result: { changedSymbols: [], callers: [], impactedEndpoints: [], degraded: true, reason: 'no_data' },
    });

    const out = await service.forPull('ws-1', 'pr-1');

    expect(getBlastRadius).toHaveBeenCalledTimes(1);
    expect(getBlastRadius).toHaveBeenCalledWith('repo-1', []);
    expect(out.changed_files_count).toBe(0);
    expect(out.downstream).toEqual([]);
  });

  it('answers not found for an unknown PR and never reads the index', async () => {
    const { service, getBlastRadius, listFiles } = setup({ pull: undefined });

    await expect(service.forPull('ws-1', 'missing')).rejects.toThrow(
      new NotFoundError('Pull request not found'),
    );
    expect(getBlastRadius).not.toHaveBeenCalled();
    expect(listFiles).not.toHaveBeenCalled();
  });
});

describe('BlastService.historyForPull', () => {
  const merged = (n: number, mergedAt: string, files: string[]): MergedPullWithFiles => ({
    number: n,
    title: `PR ${n}`,
    author: 'deepak.r',
    mergedAt,
    files,
    filesTruncated: false,
  });

  it('is unavailable without calling GitHub when the PR has no stored files', async () => {
    const { service, github } = setup({ files: [] });

    const out = await service.historyForPull('ws-1', 'pr-1');

    expect(out).toEqual({ history: [], available: false, unavailable_reason: 'no_changed_files' });
    expect(github).not.toHaveBeenCalled();
  });

  it('reports no_token when the GitHub client cannot be built, logging the message only', async () => {
    const { service, log } = setup({
      github: async () => {
        throw new Error('GITHUB_TOKEN is not configured');
      },
    });

    const out = await service.historyForPull('ws-1', 'pr-1');

    expect(out).toEqual({ history: [], available: false, unavailable_reason: 'no_token' });
    expect(log.warn).toHaveBeenCalledWith(
      { err: 'GITHUB_TOKEN is not configured' },
      'blast history: GitHub client unavailable',
    );
  });

  it('reports github_error when the request fails, logging the message only', async () => {
    const gh = new MockGitHubClient();
    vi.spyOn(gh, 'listMergedPullsWithFiles').mockRejectedValue(new Error('rate limited'));
    const { service, log } = setup({ github: async () => gh });

    const out = await service.historyForPull('ws-1', 'pr-1');

    expect(out).toEqual({ history: [], available: false, unavailable_reason: 'github_error' });
    expect(log.warn).toHaveBeenCalledWith({ err: 'rate limited' }, 'blast history: GitHub request failed');
  });

  it('lists merged PRs that share a file, newest first, for the right repository', async () => {
    const gh = new MockGitHubClient({
      mergedPulls: [
        merged(400, '2026-03-01T00:00:00Z', ['src/lib.ts']),
        merged(401, '2026-03-18T00:00:00Z', ['src/lib.ts', 'src/unrelated.ts']),
        merged(402, '2026-03-20T00:00:00Z', ['src/unrelated.ts']),
        merged(482, '2026-03-25T00:00:00Z', ['src/lib.ts']),
      ],
    });
    const spy = vi.spyOn(gh, 'listMergedPullsWithFiles');
    const { service } = setup({ github: async () => gh });

    const out = await service.historyForPull('ws-1', 'pr-1');

    expect(spy).toHaveBeenCalledWith({ owner: 'acme', name: 'api' }, HISTORY_SCAN_LIMIT);
    expect(out.available).toBe(true);
    expect(out.unavailable_reason).toBeNull();
    expect(out.history.map((h) => h.pr_number)).toEqual([401, 400]);
    expect(out.history[0]).toMatchObject({ files_overlap: ['src/lib.ts'], author: 'deepak.r' });
    expect(() => PrHistory.parse(out)).not.toThrow();
    expect(() => BlastHistoryResponse.parse(out)).not.toThrow();
  });

  it('answers not found for an unknown PR or a missing repository', async () => {
    await expect(setup({ pull: undefined }).service.historyForPull('ws-1', 'x')).rejects.toThrow(
      new NotFoundError('Pull request not found'),
    );
    const { service, github } = setup({ repo: undefined });
    await expect(service.historyForPull('ws-1', 'pr-1')).rejects.toThrow(
      new NotFoundError('Repo not found'),
    );
    expect(github).not.toHaveBeenCalled();
  });
});
