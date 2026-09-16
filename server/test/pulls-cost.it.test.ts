/**
 * COST column on the PR list — GET /repos/:id/pulls.
 *
 * The column reports the cost of each PR's LATEST SETTLED run, so the two cases
 * worth pinning are the ones a naive "newest row wins" query gets wrong: a run
 * that never priced (null, not zero) and a later FAILED run, which has no usage
 * to account for and must not erase the last run that did cost money.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { PrMeta } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;

d('PR list cost column (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /** A repo with one PR, plus the runs to attribute to it. */
  async function setup(
    runs: { status: string; costUsd: number | null; ranAt: string }[],
  ): Promise<{ repoId: string; prNumber: number }> {
    const db = pg.handle.db;
    const name = `costed-${seq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 100 + seq,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'open',
      })
      .returning();
    for (const run of runs) {
      await db.insert(t.agentRuns).values({
        workspaceId,
        prId: pr!.id,
        status: run.status,
        costUsd: run.costUsd,
        ranAt: new Date(run.ranAt),
        source: 'local',
      });
    }
    return { repoId: repo!.id, prNumber: pr!.number };
  }

  /** The list endpoint, with GitHub sync stubbed out to an empty result. */
  async function listPulls(repoId: string): Promise<PrMeta[]> {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient({ pulls: [] }) },
    });
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    expect(res.statusCode).toBe(200);
    await app.close();
    return res.json() as PrMeta[];
  }

  it('a PR that was never reviewed reports no cost', async () => {
    const { repoId } = await setup([]);
    const [pr] = await listPulls(repoId);
    expect(pr!.cost_usd).toBeNull();
  });

  it('reports the cost of the latest settled run', async () => {
    const { repoId } = await setup([
      { status: 'done', costUsd: 0.004, ranAt: '2026-06-01T10:00:00Z' },
      { status: 'done', costUsd: 0.012, ranAt: '2026-06-01T12:00:00Z' },
    ]);
    const [pr] = await listPulls(repoId);
    expect(pr!.cost_usd).toBeCloseTo(0.012, 6);
  });

  it('a later FAILED run does not erase the last run that cost money', async () => {
    const { repoId } = await setup([
      { status: 'done', costUsd: 0.012, ranAt: '2026-06-01T10:00:00Z' },
      { status: 'failed', costUsd: null, ranAt: '2026-06-01T12:00:00Z' },
    ]);
    const [pr] = await listPulls(repoId);
    expect(pr!.cost_usd).toBeCloseTo(0.012, 6);
  });

  it('a settled run on an unpriced model reports null, not zero', async () => {
    const { repoId } = await setup([
      { status: 'done', costUsd: null, ranAt: '2026-06-01T10:00:00Z' },
    ]);
    const [pr] = await listPulls(repoId);
    expect(pr!.cost_usd).toBeNull();
  });
});
