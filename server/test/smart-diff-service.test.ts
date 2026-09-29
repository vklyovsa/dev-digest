import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import { SmartDiffService } from '../src/modules/smart-diff/service.js';
import { NotFoundError } from '../src/platform/errors.js';
import type {
  SmartDiffFileRow,
  SmartDiffPullsReader,
  SmartDiffReviewEntry,
} from '../src/modules/smart-diff/types.js';

const WS = 'ws-1';
const PR = 'pr-1';

function entry(
  id: string,
  agentId: string | null,
  createdAt: string,
  lines: [string, number][],
  kind = 'review',
): SmartDiffReviewEntry {
  return {
    review: { id, agentId, kind, createdAt: new Date(createdAt) },
    findings: lines.map(([file, startLine]) => ({ file, startLine })),
  };
}

function service(files: SmartDiffFileRow[], reviews: SmartDiffReviewEntry[], known = true) {
  const pulls: SmartDiffPullsReader = {
    getById: async (workspaceId, id) => (known && workspaceId === WS && id === PR ? { id } : undefined),
    listFiles: async () => files,
  };
  return new SmartDiffService(pulls, { reviewsForPull: async () => reviews });
}

const file = (path: string, additions = 1, deletions = 0): SmartDiffFileRow => ({ path, additions, deletions });

const linesOf = (d: SmartDiff, path: string) =>
  d.groups.flatMap((g) => g.files).find((f) => f.path === path)?.finding_lines;

describe('SmartDiffService.forPull', () => {
  it('takes the newest review per agent and ignores an older run of the same agent', async () => {
    const d = await service(
      [file('src/a.ts'), file('src/b.ts')],
      [
        entry('r1', 'agent-a', '2026-06-01T10:00:00Z', [['src/a.ts', 5]]),
        entry('r2', 'agent-a', '2026-06-01T12:00:00Z', [['src/a.ts', 9]]),
        entry('r3', 'agent-b', '2026-06-01T09:00:00Z', [['src/b.ts', 3]]),
      ],
    ).forPull(WS, PR);
    expect(linesOf(d, 'src/a.ts')).toEqual([9]);
    expect(linesOf(d, 'src/b.ts')).toEqual([3]);
  });

  it('ignores a summary review', async () => {
    const d = await service(
      [file('src/a.ts')],
      [entry('r1', 'agent-a', '2026-06-01T10:00:00Z', [['src/a.ts', 5]], 'summary')],
    ).forPull(WS, PR);
    expect(linesOf(d, 'src/a.ts')).toEqual([]);
  });

  it('counts every review with no agent, each on its own', async () => {
    const d = await service(
      [file('src/a.ts')],
      [
        entry('r1', null, '2026-06-01T10:00:00Z', [['src/a.ts', 5]]),
        entry('r2', null, '2026-06-01T11:00:00Z', [['src/a.ts', 8]]),
      ],
    ).forPull(WS, PR);
    expect(linesOf(d, 'src/a.ts')).toEqual([5, 8]);
  });

  it('counts a dismissed finding: the reader port carries no dismissal state', async () => {
    const d = await service(
      [file('src/a.ts')],
      [entry('r1', 'agent-a', '2026-06-01T10:00:00Z', [['src/a.ts', 5]])],
    ).forPull(WS, PR);
    expect(linesOf(d, 'src/a.ts')).toEqual([5]);
  });

  it('deduplicates and sorts lines', async () => {
    const d = await service(
      [file('src/a.ts')],
      [
        entry('r1', 'agent-a', '2026-06-01T10:00:00Z', [
          ['src/a.ts', 30],
          ['src/a.ts', 4],
          ['src/a.ts', 30],
        ]),
        entry('r2', 'agent-b', '2026-06-01T10:00:00Z', [['src/a.ts', 12]]),
      ],
    ).forPull(WS, PR);
    expect(linesOf(d, 'src/a.ts')).toEqual([4, 12, 30]);
  });

  it('breaks a createdAt tie by review id, deterministically', async () => {
    const d = await service(
      [file('src/a.ts')],
      [
        entry('a-1', 'agent-a', '2026-06-01T10:00:00Z', [['src/a.ts', 1]]),
        entry('b-2', 'agent-a', '2026-06-01T10:00:00Z', [['src/a.ts', 2]]),
      ],
    ).forPull(WS, PR);
    expect(linesOf(d, 'src/a.ts')).toEqual([2]);
  });

  it('emits groups in role order and omits empty roles', async () => {
    const d = await service(
      [file('pnpm-lock.yaml'), file('README.md'), file('src/api.ts'), file('src/index.ts'), file('test/api.test.ts')],
      [],
    ).forPull(WS, PR);
    expect(d.groups.map((g) => g.role)).toEqual(['core', 'tests', 'wiring', 'docs', 'boilerplate']);

    const partial = await service([file('src/api.ts'), file('src/a.test.ts')], []).forPull(WS, PR);
    expect(partial.groups.map((g) => g.role)).toEqual(['core', 'tests']);
  });

  it('sums additions and deletions into total_lines and parses as SmartDiff', async () => {
    const d = await service([file('src/a.ts', 10, 2), file('README.md', 3, 5)], []).forPull(WS, PR);
    expect(d.split_suggestion).toEqual({ too_big: false, total_lines: 20, proposed_splits: [] });
    expect(() => SmartDiff.parse(d)).not.toThrow();
  });

  it('rejects an unknown or foreign pull request with NotFoundError', async () => {
    await expect(service([], [], false).forPull(WS, PR)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service([], []).forPull('other-ws', PR)).rejects.toBeInstanceOf(NotFoundError);
  });
});
