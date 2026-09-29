import { describe, it, expect } from 'vitest';
import { newestPerAgent, type ReviewIdentity } from '../src/domain/reviews/current-opinion.js';

const r = (
  id: string,
  agentId: string | null,
  createdAt: string,
  extra: Partial<ReviewIdentity> = {},
): ReviewIdentity => ({ id, agentId, kind: 'review', createdAt: new Date(createdAt), ...extra });

const ids = (rows: ReviewIdentity[]) => newestPerAgent(rows, (x) => x).map((x) => x.id);

describe('newestPerAgent', () => {
  it('keeps the newest run per agent and every agent, newest first', () => {
    expect(
      ids([
        r('a-old', 'A', '2026-06-01T10:00:00Z'),
        r('b', 'B', '2026-06-01T09:00:00Z'),
        r('a-new', 'A', '2026-06-01T12:00:00Z'),
      ]),
    ).toEqual(['a-new', 'b']);
  });

  it('ignores summary runs', () => {
    expect(ids([r('s', 'A', '2026-06-01T12:00:00Z', { kind: 'summary' }), r('a', 'A', '2026-06-01T10:00:00Z')])).toEqual(['a']);
  });

  it('keys a run with no agent on itself, so each stands alone', () => {
    expect(ids([r('n1', null, '2026-06-01T10:00:00Z'), r('n2', null, '2026-06-01T11:00:00Z')])).toEqual(['n2', 'n1']);
  });

  it('scopes agents per PR when prId is present', () => {
    expect(
      ids([r('p1', 'A', '2026-06-01T10:00:00Z', { prId: 'pr1' }), r('p2', 'A', '2026-06-01T09:00:00Z', { prId: 'pr2' })]),
    ).toEqual(['p1', 'p2']);
  });

  it('breaks a createdAt tie by id, descending, and does not mutate its input', () => {
    const input = [r('a-1', 'A', '2026-06-01T10:00:00Z'), r('b-2', 'A', '2026-06-01T10:00:00Z')];
    expect(ids(input)).toEqual(['b-2']);
    expect(input.map((x) => x.id)).toEqual(['a-1', 'b-2']);
  });

  it('carries whatever the caller wraps around the identity', () => {
    const rows = [{ review: r('a', 'A', '2026-06-01T10:00:00Z'), findings: [1] }];
    expect(newestPerAgent(rows, (x) => x.review)[0]!.findings).toEqual([1]);
  });
});
