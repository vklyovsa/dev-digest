import { describe, it, expect } from 'vitest';
import { toMergedPulls } from '../src/adapters/github/merged-pulls.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';

function node(over: Record<string, unknown> = {}) {
  return {
    number: 401,
    title: 'Tighten the rate limiter',
    mergedAt: '2026-03-18T10:00:00Z',
    author: { login: 'deepak.r' },
    files: { totalCount: 2, nodes: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] },
    ...over,
  };
}

function response(nodes: unknown[] | null) {
  return { repository: { pullRequests: { nodes } } };
}

describe('toMergedPulls', () => {
  it('maps a full node', () => {
    expect(toMergedPulls(response([node()]))).toEqual([
      {
        number: 401,
        title: 'Tighten the rate limiter',
        author: 'deepak.r',
        mergedAt: '2026-03-18T10:00:00Z',
        files: ['src/a.ts', 'src/b.ts'],
        filesTruncated: false,
      },
    ]);
  });

  it('drops null nodes and PRs that are not merged', () => {
    const out = toMergedPulls(
      response([null, node({ number: 1, mergedAt: null }), node({ number: 2 })]),
    );
    expect(out.map((p) => p.number)).toEqual([2]);
  });

  it('names a deleted author "unknown"', () => {
    const [pr] = toMergedPulls(response([node({ author: null })]));
    expect(pr!.author).toBe('unknown');
  });

  it('flags a PR with more files than were fetched', () => {
    const [pr] = toMergedPulls(
      response([node({ files: { totalCount: 450, nodes: [{ path: 'src/a.ts' }, null] } })]),
    );
    expect(pr!.files).toEqual(['src/a.ts']);
    expect(pr!.filesTruncated).toBe(true);
  });

  it('treats a PR without a files connection as having no files', () => {
    const [pr] = toMergedPulls(response([node({ files: null })]));
    expect(pr!.files).toEqual([]);
    expect(pr!.filesTruncated).toBe(false);
  });

  it('returns an empty list when the connection has no nodes', () => {
    expect(toMergedPulls(response(null))).toEqual([]);
  });

  it('throws when the repository is not accessible', () => {
    expect(() => toMergedPulls({ repository: null })).toThrow('GitHub repository is not accessible');
  });

  it('throws on a response of the wrong shape', () => {
    expect(() => toMergedPulls({ repository: { pullRequests: { nodes: [{ number: 'x' }] } } })).toThrow();
    expect(() => toMergedPulls({})).toThrow();
    expect(() => toMergedPulls(null)).toThrow();
  });
});

describe('MockGitHubClient.listMergedPullsWithFiles', () => {
  const pulls = [1, 2, 3].map((n) => ({
    number: n,
    title: `PR ${n}`,
    author: 'a',
    mergedAt: '2026-03-18T10:00:00Z',
    files: [],
    filesTruncated: false,
  }));

  it('serves the configured PRs, capped at the limit', async () => {
    const gh = new MockGitHubClient({ mergedPulls: pulls });
    const out = await gh.listMergedPullsWithFiles({ owner: 'o', name: 'n' }, 2);
    expect(out.map((p) => p.number)).toEqual([1, 2]);
  });

  it('is empty by default', async () => {
    const gh = new MockGitHubClient();
    expect(await gh.listMergedPullsWithFiles({ owner: 'o', name: 'n' }, 5)).toEqual([]);
  });
});
