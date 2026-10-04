import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { BlastHistoryResponse, BlastRadius, BlastRadiusResponse } from '@devdigest/shared';
import type { FastifyInstance } from 'fastify';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';
import type { BlastResult, IndexState, RepoIntel } from '../src/modules/repo-intel/types.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;

const facadeResult: BlastResult = {
  changedSymbols: [{ file: 'src/lib.ts', name: 'alpha', kind: 'function' }],
  callers: [{ file: 'src/routes.ts', symbol: 'register', viaSymbol: 'alpha', line: 12, rank: 0.8 }],
  impactedEndpoints: ['GET /x'],
  factsByFile: { 'src/routes.ts': { endpoints: ['GET /x'], crons: [] } },
  degraded: false,
};

const indexState: IndexState = {
  repoId: 'ignored',
  status: 'full',
  filesIndexed: 3,
  filesSkipped: 0,
  durationMs: 1,
  lastIndexedSha: 'idx123',
  indexerVersion: 2,
  updatedAt: new Date(0),
};

d('GET /pulls/:id/blast (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let workspaceId: string;
  const getBlastRadius = vi.fn(async (_repoId: string, _files: string[]) => facadeResult);
  const repoIntel = {
    getBlastRadius,
    getIndexState: async () => indexState,
  } as unknown as RepoIntel;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        repoIntel,
        github: new MockGitHubClient({
          mergedPulls: [
            {
              number: 401,
              title: 'Tighten the lib',
              author: 'deepak.r',
              mergedAt: '2026-03-18T10:00:00Z',
              files: ['src/lib.ts', 'src/unrelated.ts'],
              filesTruncated: false,
            },
            {
              number: 402,
              title: 'Unrelated',
              author: 'marisa.koch',
              mergedAt: '2026-03-19T10:00:00Z',
              files: ['docs/notes.md'],
              filesTruncated: false,
            },
          ],
        }),
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  async function insertPr(wsId: string, paths: string[]): Promise<string> {
    const db = pg.handle.db;
    const name = `blast-${seq++}`;
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
        title: 'Blast',
        author: 'marisa.koch',
        branch: 'feat/blast',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: paths.length,
        status: 'open',
      })
      .returning();
    if (paths.length > 0) {
      await db.insert(t.prFiles).values(paths.map((path) => ({ prId: pr!.id, path, additions: 1, deletions: 0 })));
    }
    return pr!.id;
  }

  it('serves the map for the stored files and validates against both contracts', async () => {
    const prId = await insertPr(workspaceId, ['src/lib.ts', 'src/other.ts']);
    getBlastRadius.mockClear();

    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/blast` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(() => BlastRadius.parse(body)).not.toThrow();
    const parsed = BlastRadiusResponse.parse(body);
    expect(parsed.changed_files_count).toBe(2);
    expect(parsed.max_callers_per_symbol).toBe(MAX_CALLERS_PER_SYMBOL);
    expect(parsed.indexed_sha).toBe('idx123');
    expect(parsed.downstream[0]).toMatchObject({
      symbol: 'alpha',
      endpoints_affected: ['GET /x'],
      callers: [{ name: 'register', file: 'src/routes.ts', line: 12 }],
    });

    expect(getBlastRadius).toHaveBeenCalledTimes(1);
    const [, files] = getBlastRadius.mock.calls[0]!;
    expect([...files].sort()).toEqual(['src/lib.ts', 'src/other.ts']);
  });

  it('answers 404 for an unknown PR and for a PR of another workspace, 422 for a non-uuid id', async () => {
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'other' }).returning();
    const foreign = await insertPr(other!.id, ['src/lib.ts']);

    const unknown = await app.inject({ method: 'GET', url: `/pulls/${randomUUID()}/blast` });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toMatchObject({
      code: 'not_found',
      message: 'Pull request not found',
    });
    expect((await app.inject({ method: 'GET', url: `/pulls/${foreign}/blast` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/blast' })).statusCode).toBe(422);
  });

  it('lists the merged PRs that touched the same files', async () => {
    const prId = await insertPr(workspaceId, ['src/lib.ts', 'src/other.ts']);

    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/blast/history` });

    expect(res.statusCode).toBe(200);
    const body = BlastHistoryResponse.parse(res.json());
    expect(body.available).toBe(true);
    expect(body.unavailable_reason).toBeNull();
    expect(body.history).toHaveLength(1);
    expect(body.history[0]).toMatchObject({ pr_number: 401, files_overlap: ['src/lib.ts'] });
  });

  it('says why the history is unavailable instead of failing', async () => {
    const prId = await insertPr(workspaceId, []);

    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/blast/history` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ history: [], available: false, unavailable_reason: 'no_changed_files' });
    expect(
      (await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/blast/history' })).statusCode,
    ).toBe(422);
  });
});
