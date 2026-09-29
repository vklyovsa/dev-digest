import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;

d('GET /pulls/:id/smart-diff (Testcontainers pg)', () => {
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

  async function insertPr(
    wsId: string,
    files: { path: string; additions: number; deletions: number }[],
  ): Promise<string> {
    const db = pg.handle.db;
    const name = `smart-${seq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: wsId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: wsId,
        repoId: repo!.id,
        number: 300 + seq,
        title: 'Smart diff',
        author: 'marisa.koch',
        branch: 'feat/sd',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: files.length,
        status: 'open',
      })
      .returning();
    await db.insert(t.prFiles).values(files.map((f) => ({ prId: pr!.id, ...f })));
    return pr!.id;
  }

  async function insertReview(
    prId: string,
    agentId: string,
    createdAt: string,
    findings: { file: string; line: number; dismissed?: boolean }[],
  ) {
    const db = pg.handle.db;
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        agentId,
        kind: 'review',
        verdict: 'comment',
        summary: 'seeded',
        score: 50,
        createdAt: new Date(createdAt),
      })
      .returning();
    for (const f of findings) {
      await db.insert(t.findings).values({
        reviewId: review!.id,
        file: f.file,
        startLine: f.line,
        endLine: f.line,
        severity: 'WARNING',
        category: 'bug',
        title: 'x',
        rationale: 'because',
        confidence: 0.9,
        dismissedAt: f.dismissed ? new Date('2026-06-02T10:00:00Z') : null,
      });
    }
  }

  async function get(url: string) {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient({ pulls: [] }) },
    });
    const res = await app.inject({ method: 'GET', url });
    await app.close();
    return res;
  }

  it('groups a PR that has no review yet, in role order, with empty finding_lines', async () => {
    const prId = await insertPr(workspaceId, [
      { path: 'pnpm-lock.yaml', additions: 40, deletions: 10 },
      { path: 'src/api.test.ts', additions: 5, deletions: 0 },
      { path: 'src/index.ts', additions: 2, deletions: 1 },
      { path: 'docs/notes.md', additions: 3, deletions: 0 },
      { path: 'src/api.ts', additions: 20, deletions: 4 },
    ]);
    const res = await get(`/pulls/${prId}/smart-diff`);
    expect(res.statusCode).toBe(200);
    const body = SmartDiff.parse(res.json());
    expect(body.groups.map((g) => g.role)).toEqual(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
    expect(body.groups.flatMap((g) => g.files).every((f) => f.finding_lines.length === 0)).toBe(true);
    expect(body.split_suggestion.total_lines).toBe(85);
  });

  it('reads finding_lines from the newest review per agent, dismissed findings included', async () => {
    const prId = await insertPr(workspaceId, [
      { path: 'src/a.ts', additions: 5, deletions: 0 },
      { path: 'src/b.ts', additions: 5, deletions: 0 },
    ]);
    const agentA = randomUUID();
    const agentB = randomUUID();
    await insertReview(prId, agentA, '2026-06-01T10:00:00Z', [{ file: 'src/a.ts', line: 5 }]);
    await insertReview(prId, agentA, '2026-06-01T12:00:00Z', [
      { file: 'src/a.ts', line: 20 },
      { file: 'src/a.ts', line: 9, dismissed: true },
    ]);
    await insertReview(prId, agentB, '2026-06-01T09:00:00Z', [{ file: 'src/b.ts', line: 3 }]);

    const res = await get(`/pulls/${prId}/smart-diff`);
    expect(res.statusCode).toBe(200);
    const files = SmartDiff.parse(res.json()).groups.flatMap((g) => g.files);
    expect(files.find((f) => f.path === 'src/a.ts')!.finding_lines).toEqual([9, 20]);
    expect(files.find((f) => f.path === 'src/b.ts')!.finding_lines).toEqual([3]);
  });

  it('answers 404 for a PR in another workspace and 422 for a non-uuid id', async () => {
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'other' }).returning();
    const foreign = await insertPr(other!.id, [{ path: 'src/a.ts', additions: 1, deletions: 0 }]);
    expect((await get(`/pulls/${foreign}/smart-diff`)).statusCode).toBe(404);
    expect((await get(`/pulls/${randomUUID()}/smart-diff`)).statusCode).toBe(404);
    expect((await get('/pulls/not-a-uuid/smart-diff')).statusCode).toBe(422);
  });
});
