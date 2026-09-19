/**
 * FINDINGS and SCORE columns on the PR list — GET /repos/:id/pulls.
 *
 * Both are derived from the SAME set: every OPEN (non-dismissed) finding in the
 * NEWEST review of each agent. That middle ground is what the two obvious
 * queries get wrong, so both failure modes are pinned here: "all reviews"
 * double-counts a re-run (findings are never deduplicated between runs), and
 * "the single newest review" drops every agent but the one that finished last.
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { PREVIEW_LIMIT } from '../src/modules/pulls/findings-summary.js';
import type { PrMeta } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;

type FindingSpec = {
  severity: string;
  confidence?: number;
  title?: string;
  dismissed?: boolean;
};
/** `agent` is a label; each distinct label becomes its own agent id. */
type ReviewSpec = {
  createdAt: string;
  agent?: string;
  score?: number;
  findings: FindingSpec[];
};

d('PR list findings + score columns (Testcontainers pg)', () => {
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

  /** A repo with one PR and the reviews (each with its findings) to attach. */
  async function setup(reviews: ReviewSpec[]): Promise<{ repoId: string }> {
    const db = pg.handle.db;
    const name = `reviewed-${seq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 200 + seq,
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

    const agentIds = new Map<string, string>();
    for (const spec of reviews) {
      const label = spec.agent ?? 'solo';
      if (!agentIds.has(label)) agentIds.set(label, randomUUID());
      const [review] = await db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId: pr!.id,
          agentId: agentIds.get(label)!,
          kind: 'review',
          verdict: 'comment',
          summary: 'seeded',
          // A review row's own score is deliberately implausible here: the
          // column must not pick it up.
          score: spec.score ?? 7,
          createdAt: new Date(spec.createdAt),
        })
        .returning();
      let n = 0;
      for (const f of spec.findings) {
        n += 1;
        await db.insert(t.findings).values({
          reviewId: review!.id,
          file: `src/file-${n}.ts`,
          startLine: n,
          endLine: n,
          severity: f.severity,
          category: 'bug',
          title: f.title ?? `${f.severity} finding ${n}`,
          rationale: 'because',
          confidence: f.confidence ?? 0.9,
          dismissedAt: f.dismissed ? new Date('2026-06-02T10:00:00Z') : null,
        });
      }
    }
    return { repoId: repo!.id };
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

  it('a PR that was never reviewed reports no findings and no score', async () => {
    const { repoId } = await setup([]);
    const [pr] = await listPulls(repoId);
    expect(pr!.findings ?? null).toBeNull();
    expect(pr!.score ?? null).toBeNull();
  });

  it('every agent contributes — a batch is not reduced to whoever finished last', async () => {
    const { repoId } = await setup([
      {
        agent: 'security',
        createdAt: '2026-06-01T12:00:00Z',
        findings: [{ severity: 'CRITICAL', title: 'secret' }],
      },
      {
        agent: 'performance',
        createdAt: '2026-06-01T12:00:05Z',
        findings: [{ severity: 'WARNING', title: 'n+1' }],
      },
    ]);
    const [pr] = await listPulls(repoId);
    expect(pr!.findings!.total).toBe(2);
    expect(pr!.findings!.counts).toEqual([
      { severity: 'CRITICAL', count: 1 },
      { severity: 'WARNING', count: 1 },
    ]);
    expect(pr!.score).toBe(53); // 100 − 35 − 12, both agents counted
  });

  it("sums each agent's LATEST run: 3 (one pass) + 4 (last of three) = 7", async () => {
    // The acceptance example: Test Quality ran once and found 3; General ran
    // three times and its last pass found 4. The list must read 7 — not 3 + 2 +
    // 5 + 4, and not just the 4 of whoever ran last.
    const { repoId } = await setup([
      {
        agent: 'test-quality',
        createdAt: '2026-06-01T09:00:00Z',
        findings: [
          { severity: 'WARNING', title: 'tq-warn' },
          { severity: 'SUGGESTION', title: 'tq-sugg-1' },
          { severity: 'SUGGESTION', title: 'tq-sugg-2' },
        ],
      },
      {
        agent: 'general',
        createdAt: '2026-06-01T10:00:00Z',
        findings: [{ severity: 'CRITICAL', title: 'g1-crit' }, { severity: 'WARNING', title: 'g1-warn' }],
      },
      {
        agent: 'general',
        createdAt: '2026-06-01T11:00:00Z',
        findings: [
          { severity: 'CRITICAL', title: 'g2-crit' },
          { severity: 'WARNING', title: 'g2-warn' },
          { severity: 'SUGGESTION', title: 'g2-sugg-1' },
          { severity: 'SUGGESTION', title: 'g2-sugg-2' },
          { severity: 'SUGGESTION', title: 'g2-sugg-3' },
        ],
      },
      {
        agent: 'general',
        createdAt: '2026-06-01T12:00:00Z',
        findings: [
          { severity: 'CRITICAL', title: 'g3-crit' },
          { severity: 'SUGGESTION', title: 'g3-sugg-1' },
          { severity: 'SUGGESTION', title: 'g3-sugg-2' },
          { severity: 'SUGGESTION', title: 'g3-sugg-3' },
        ],
      },
    ]);
    const [pr] = await listPulls(repoId);
    expect(pr!.findings!.total).toBe(7);
    expect(pr!.findings!.counts).toEqual([
      { severity: 'CRITICAL', count: 1 }, // only General's last pass
      { severity: 'WARNING', count: 1 }, // only Test Quality's
      { severity: 'SUGGESTION', count: 5 }, // 2 + 3
    ]);
    expect(pr!.score).toBe(38); // 100 − 35 − 12 − 3×5
  });

  it("a re-run supersedes that agent's earlier pass instead of doubling it", async () => {
    const { repoId } = await setup([
      {
        agent: 'security',
        createdAt: '2026-06-01T10:00:00Z',
        findings: [{ severity: 'CRITICAL', title: 'secret' }],
      },
      {
        agent: 'security',
        createdAt: '2026-06-01T12:00:00Z',
        findings: [{ severity: 'CRITICAL', title: 'secret (still there)' }],
      },
    ]);
    const [pr] = await listPulls(repoId);
    expect(pr!.findings!.total).toBe(1);
    expect(pr!.findings!.previews.map((p) => p.title)).toEqual(['secret (still there)']);
    expect(pr!.score).toBe(65); // one critical, not two
  });

  it('an agent that found nothing on its latest pass drops out of the counts', async () => {
    const { repoId } = await setup([
      {
        agent: 'security',
        createdAt: '2026-06-01T10:00:00Z',
        findings: [{ severity: 'CRITICAL', title: 'secret' }],
      },
      { agent: 'security', createdAt: '2026-06-01T12:00:00Z', findings: [] },
      {
        agent: 'performance',
        createdAt: '2026-06-01T11:00:00Z',
        findings: [{ severity: 'WARNING', title: 'n+1' }],
      },
    ]);
    const [pr] = await listPulls(repoId);
    expect(pr!.findings!.counts).toEqual([{ severity: 'WARNING', count: 1 }]);
    expect(pr!.score).toBe(88); // the fixed critical stops costing points
  });

  it('groups worst-first and omits a severity that is absent', async () => {
    const { repoId } = await setup([
      {
        createdAt: '2026-06-01T12:00:00Z',
        findings: [{ severity: 'WARNING' }, { severity: 'CRITICAL' }, { severity: 'WARNING' }],
      },
    ]);
    const [pr] = await listPulls(repoId);
    expect(pr!.findings!.counts).toEqual([
      { severity: 'CRITICAL', count: 1 },
      { severity: 'WARNING', count: 2 },
    ]);
  });

  it('a dismissed finding stops counting and stops costing score', async () => {
    const { repoId } = await setup([
      {
        createdAt: '2026-06-01T12:00:00Z',
        findings: [
          { severity: 'CRITICAL', dismissed: true, title: 'false positive' },
          { severity: 'WARNING', title: 'real' },
        ],
      },
    ]);
    const [pr] = await listPulls(repoId);
    expect(pr!.findings!.total).toBe(1);
    expect(pr!.findings!.counts).toEqual([{ severity: 'WARNING', count: 1 }]);
    expect(pr!.findings!.previews.map((p) => p.title)).toEqual(['real']);
    expect(pr!.score).toBe(88); // 100 − 12, the critical is gone
  });

  it('SCORE is derived from the open findings, not from a review row', async () => {
    const { repoId } = await setup([
      {
        agent: 'security',
        createdAt: '2026-06-01T10:00:00Z',
        score: 7,
        findings: [{ severity: 'CRITICAL' }],
      },
      {
        agent: 'style',
        createdAt: '2026-06-01T12:00:00Z',
        score: 99,
        findings: [{ severity: 'SUGGESTION' }],
      },
    ]);
    const [pr] = await listPulls(repoId);
    // 100 − 35 − 3; neither 7 (one review row) nor 99 (the newest one).
    expect(pr!.score).toBe(62);
  });

  it('a reviewed PR with nothing open reads 100 and an empty summary', async () => {
    const { repoId } = await setup([{ createdAt: '2026-06-01T12:00:00Z', findings: [] }]);
    const [pr] = await listPulls(repoId);
    expect(pr!.score).toBe(100);
    expect(pr!.findings).toEqual({ total: 0, counts: [], previews: [] });
  });

  it('caps the previews and orders them by severity, then confidence', async () => {
    const { repoId } = await setup([
      {
        createdAt: '2026-06-01T12:00:00Z',
        findings: [
          { severity: 'SUGGESTION', confidence: 0.5, title: 'sugg' },
          { severity: 'WARNING', confidence: 0.6, title: 'warn-low' },
          { severity: 'WARNING', confidence: 0.95, title: 'warn-high' },
          { severity: 'CRITICAL', confidence: 0.7, title: 'crit' },
          { severity: 'SUGGESTION', confidence: 0.4, title: 'sugg-2' },
          { severity: 'SUGGESTION', confidence: 0.3, title: 'sugg-3' },
          { severity: 'SUGGESTION', confidence: 0.2, title: 'sugg-4' },
        ],
      },
    ]);
    const [pr] = await listPulls(repoId);
    expect(pr!.findings!.total).toBe(7);
    expect(pr!.findings!.previews).toHaveLength(PREVIEW_LIMIT);
    expect(pr!.findings!.previews.map((p) => p.title)).toEqual([
      'crit',
      'warn-high',
      'warn-low',
      'sugg',
      'sugg-2',
    ]);
  });

  it('a preview carries what the popover renders and nothing more', async () => {
    const { repoId } = await setup([
      {
        createdAt: '2026-06-01T12:00:00Z',
        findings: [{ severity: 'CRITICAL', confidence: 0.98, title: 'Hardcoded key' }],
      },
    ]);
    const [pr] = await listPulls(repoId);
    const [preview] = pr!.findings!.previews;
    expect(Object.keys(preview!).sort()).toEqual(
      [
        'category',
        'confidence',
        'end_line',
        'file',
        'id',
        'rationale',
        'severity',
        'start_line',
        'title',
      ].sort(),
    );
    expect(preview!.title).toBe('Hardcoded key');
    expect(preview!.confidence).toBeCloseTo(0.98, 6);
  });
});
