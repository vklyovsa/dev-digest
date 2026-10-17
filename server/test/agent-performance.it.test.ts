/**
 * Agent Performance — GET /agents/performance and GET /agents/:id/stats.
 *
 * Runs are seeded straight into `agent_runs` / `reviews` / `findings`; nothing here
 * starts a review. Every case owns a window of its own (`win(n)`), far in the past, so
 * the rows of one case never leak into another and no seeded row touches them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { count, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { AgentPerf, AgentPerfRow, AgentStats } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DAY = 86_400_000;
const WIN_FROM = (n: number) => Date.UTC(2020, n, 1);
const win = (n: number) => ({
  from: new Date(WIN_FROM(n)),
  to: new Date(WIN_FROM(n) + 10 * DAY),
});
const at = (n: number, day: number) => new Date(WIN_FROM(n) + day * DAY);

let seq = 0;

d('Agent Performance (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let workspaceId: string;
  let openai: MockLLMProvider;
  let anthropic: MockLLMProvider;
  const prByWs = new Map<string, string>();

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    openai = new MockLLMProvider('openai');
    anthropic = new MockLLMProvider('anthropic');
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai, anthropic } },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  const mkAgent = async (name: string, opts: { enabled?: boolean; ws?: string } = {}) => {
    const [row] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: opts.ws ?? workspaceId,
        name: `${name}-${seq++}`,
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'x',
        enabled: opts.enabled ?? true,
      })
      .returning();
    return row!;
  };

  const prFor = async (ws: string) => {
    const cached = prByWs.get(ws);
    if (cached) return cached;
    const db = pg.handle.db;
    const name = `perf-${seq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 1,
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
    prByWs.set(ws, pr!.id);
    return pr!.id;
  };

  interface RunSpec {
    agentId: string | null;
    ranAt: Date;
    status?: string;
    costUsd?: number | null;
    model?: string | null;
    durationMs?: number | null;
    ws?: string;
  }
  const mkRun = async (r: RunSpec) => {
    const [row] = await pg.handle.db
      .insert(t.agentRuns)
      .values({
        workspaceId: r.ws ?? workspaceId,
        agentId: r.agentId,
        ranAt: r.ranAt,
        status: r.status ?? 'done',
        costUsd: r.costUsd ?? null,
        model: r.model === undefined ? 'gpt-4o-mini' : r.model,
        durationMs: r.durationMs ?? null,
        source: 'local',
      })
      .returning();
    return row!.id;
  };

  type FindingSpec = { kind?: string; accepted?: Date; dismissed?: Date };
  const mkFindings = async (
    runId: string,
    agentId: string | null,
    findings: FindingSpec[],
    ws = workspaceId,
  ) => {
    const db = pg.handle.db;
    const [review] = await db
      .insert(t.reviews)
      .values({ workspaceId: ws, prId: await prFor(ws), agentId, runId, kind: 'review' })
      .returning();
    for (const f of findings) {
      await db.insert(t.findings).values({
        reviewId: review!.id,
        file: 'a.ts',
        startLine: 1,
        endLine: 1,
        severity: 'WARNING',
        category: 'bug',
        title: 'x',
        rationale: 'y',
        confidence: 0.9,
        kind: f.kind ?? 'finding',
        acceptedAt: f.accepted ?? null,
        dismissedAt: f.dismissed ?? null,
      });
    }
  };

  const query = (n: number) => {
    const w = win(n);
    return `from=${encodeURIComponent(w.from.toISOString())}&to=${encodeURIComponent(w.to.toISOString())}`;
  };
  const perf = async (n: number): Promise<AgentPerf> => {
    const res = await app.inject({ method: 'GET', url: `/agents/performance?${query(n)}` });
    expect(res.statusCode).toBe(200);
    return res.json() as AgentPerf;
  };
  const stats = (agentId: string, n: number) =>
    app.inject({ method: 'GET', url: `/agents/${agentId}/stats?${query(n)}` });
  const rowOf = (p: AgentPerf, id: string): AgentPerfRow => {
    const row = p.agents.find((a) => a.agent_id === id);
    expect(row).toBeDefined();
    return row!;
  };
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  it('counts done, failed and cancelled runs in [from, to) and nothing else', async () => {
    const n = 0;
    const w = win(n);
    const a = await mkAgent('Counted');
    await mkRun({ agentId: a.id, ranAt: w.from });
    await mkRun({ agentId: a.id, ranAt: w.to });
    await mkRun({ agentId: a.id, ranAt: new Date(w.from.getTime() - 1) });
    await mkRun({ agentId: a.id, ranAt: at(n, 2), status: 'running' });
    await mkRun({ agentId: a.id, ranAt: at(n, 3), status: 'failed' });
    await mkRun({ agentId: a.id, ranAt: at(n, 4), status: 'cancelled' });
    await pg.handle.db.insert(t.evalRuns).values({
      workspaceId,
      agentId: a.id,
      agentVersion: 1,
      status: 'done',
      ranAt: at(n, 5),
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    const p = await perf(n);
    expect(rowOf(p, a.id).runs).toBe(3);
    expect(p.summary.runs).toBe(3);
  });

  it('totals, averages and counts the unpriced runs of an agent', async () => {
    const n = 1;
    const a = await mkAgent('Priced');
    await mkRun({ agentId: a.id, ranAt: at(n, 1), costUsd: 0.004 });
    await mkRun({ agentId: a.id, ranAt: at(n, 2), costUsd: 0.012 });
    await mkRun({ agentId: a.id, ranAt: at(n, 3), costUsd: null });

    const p = await perf(n);
    const row = rowOf(p, a.id);
    expect(row.runs).toBe(3);
    expect(row.total_cost_usd).toBeCloseTo(0.016, 9);
    expect(row.avg_cost_usd).toBeCloseTo(0.008, 9);
    expect(row.unpriced_runs).toBe(1);
    expect(p.summary.unpriced_runs).toBe(1);
  });

  it('averages the duration of done runs only', async () => {
    const n = 2;
    const a = await mkAgent('Latency');
    await mkRun({ agentId: a.id, ranAt: at(n, 1), status: 'done', durationMs: 1000 });
    await mkRun({ agentId: a.id, ranAt: at(n, 2), status: 'done', durationMs: 3000 });
    await mkRun({ agentId: a.id, ranAt: at(n, 3), status: 'failed', durationMs: 0 });

    expect(rowOf(await perf(n), a.id).avg_latency_ms).toBe(2000);
  });

  it('counts decisions of every kind whenever made, and none of an uncounted run', async () => {
    const n = 3;
    const w = win(n);
    const a = await mkAgent('Decider');
    const run = await mkRun({ agentId: a.id, ranAt: at(n, 1) });
    await mkFindings(run, a.id, [
      { accepted: at(n, 2) },
      { kind: 'note', accepted: at(n, 2) },
      { accepted: new Date(w.to.getTime() + DAY) },
      { dismissed: at(n, 2) },
      {},
    ]);
    const outside = await mkRun({ agentId: a.id, ranAt: new Date(w.to.getTime() + DAY) });
    await mkFindings(outside, a.id, [{ accepted: at(n, 2) }]);

    const row = rowOf(await perf(n), a.id);
    expect(row.accepted).toBe(3);
    expect(row.dismissed).toBe(1);
    expect(row.decisions).toBe(4);
    expect(row.accept_rate).toBeCloseTo(0.75, 9);
  });

  it('gathers the runs of a deleted agent into one row and keeps every sum equal', async () => {
    const n = 4;
    const x = await mkAgent('KeptX');
    const y = await mkAgent('KeptY');
    const z = await mkAgent('Doomed');
    await mkRun({ agentId: x.id, ranAt: at(n, 1), costUsd: 0.01, model: 'm1' });
    await mkRun({ agentId: x.id, ranAt: at(n, 2), costUsd: 0.01, model: 'm1' });
    await mkRun({ agentId: y.id, ranAt: at(n, 3), costUsd: 0.02, model: 'm2' });
    const zRun = await mkRun({ agentId: z.id, ranAt: at(n, 4), costUsd: 0.03, model: 'm2' });
    await mkFindings(zRun, z.id, [{ accepted: at(n, 5) }]);
    const del = await app.inject({ method: 'DELETE', url: `/agents/${z.id}` });
    expect(del.statusCode).toBeLessThan(300);

    const p = await perf(n);
    const orphan = p.agents.filter((r) => r.agent_id === null);
    expect(orphan).toHaveLength(1);
    expect(orphan[0]!.agent_name).toBeNull();
    expect(orphan[0]!.runs).toBe(1);
    expect(orphan[0]!.accepted).toBe(1);
    expect(p.cost_by_agent.filter((s) => s.agent_id === null)).toHaveLength(1);
    expect(p.summary.runs).toBe(4);
    expect(p.summary.most_active_agent_id).toBe(x.id);

    const total = p.summary.total_cost_usd as number;
    expect(total).toBeCloseTo(0.07, 9);
    expect(sum(p.agents.map((r) => r.total_cost_usd ?? 0))).toBeCloseTo(total, 9);
    expect(sum(p.cost_by_agent.map((s) => s.value))).toBeCloseTo(total, 9);
    expect(sum(p.cost_by_model.map((s) => s.value))).toBeCloseTo(total, 9);
  });

  it('groups cost by the model stored on each run', async () => {
    const n = 5;
    const a = await mkAgent('TwoModels');
    await mkRun({ agentId: a.id, ranAt: at(n, 1), costUsd: 0.01, model: 'model-a' });
    await mkRun({ agentId: a.id, ranAt: at(n, 2), costUsd: 0.03, model: 'model-b' });

    const p = await perf(n);
    expect(p.cost_by_model).toHaveLength(2);
    expect(p.cost_by_model.find((s) => s.label === 'model-a')!.value).toBeCloseTo(0.01, 9);
    expect(p.cost_by_model.find((s) => s.label === 'model-b')!.value).toBeCloseTo(0.03, 9);
  });

  it('puts the cost of a run without a model into one segment with a null label', async () => {
    const n = 6;
    const a = await mkAgent('NoModel');
    await mkRun({ agentId: a.id, ranAt: at(n, 1), costUsd: 0.02, model: null });
    await mkRun({ agentId: a.id, ranAt: at(n, 2), costUsd: 0.01, model: 'model-a' });

    const p = await perf(n);
    const unknown = p.cost_by_model.filter((s) => s.label === null);
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.value).toBeCloseTo(0.02, 9);
    expect(sum(p.cost_by_model.map((s) => s.value))).toBeCloseTo(p.summary.total_cost_usd as number, 9);
  });

  it('breaks a runs tie by the newer last run, and reports no most-active agent for an empty window', async () => {
    const n = 7;
    const older = await mkAgent('TieOlder');
    const newer = await mkAgent('TieNewer');
    await mkRun({ agentId: older.id, ranAt: at(n, 1) });
    await mkRun({ agentId: newer.id, ranAt: at(n, 2) });

    const p = await perf(n);
    expect(p.summary.most_active_agent_id).toBe(newer.id);
    expect(p.summary.most_active_agent).toBe(newer.name);

    const empty = await perf(8);
    expect(empty.summary.runs).toBe(0);
    expect(empty.summary.most_active_agent).toBeNull();
    expect(empty.summary.most_active_agent_id).toBeNull();
    expect(empty.summary.total_cost_usd).toBeNull();
    expect(empty.summary.avg_accept_rate).toBeNull();
  });

  it('takes last_run_at from counted runs only', async () => {
    const n = 9;
    const w = win(n);
    const a = await mkAgent('LastRun');
    await mkRun({ agentId: a.id, ranAt: at(n, 3) });
    await mkRun({ agentId: a.id, ranAt: new Date(w.to.getTime() + 5 * DAY) });

    const row = rowOf(await perf(n), a.id);
    expect(new Date(row.last_run_at as string).getTime()).toBe(at(n, 3).getTime());
  });

  it('lists a disabled agent without a run, with null figures', async () => {
    const n = 10;
    const a = await mkAgent('Sleeping', { enabled: false });
    await mkRun({ agentId: (await mkAgent('Busy')).id, ranAt: at(n, 1) });

    const row = rowOf(await perf(n), a.id);
    expect(row.runs).toBe(0);
    expect(row.accept_rate).toBeNull();
    expect(row.avg_cost_usd).toBeNull();
    expect(row.avg_latency_ms).toBeNull();
    expect(row.last_run_at).toBeNull();
  });

  it('ignores the rows of another workspace', async () => {
    const n = 11;
    const a = await mkAgent('Mine');
    const run = await mkRun({ agentId: a.id, ranAt: at(n, 1), costUsd: 0.01, model: 'mine' });
    await mkFindings(run, a.id, [{ accepted: at(n, 2) }]);
    const before = await perf(n);

    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: `other-${seq++}` }).returning();
    const foreign = await mkAgent('Foreign', { ws: other!.id });
    const fRun = await mkRun({
      agentId: foreign.id,
      ranAt: at(n, 1),
      costUsd: 0.5,
      model: 'foreign',
      ws: other!.id,
    });
    await mkFindings(fRun, foreign.id, [{ dismissed: at(n, 2) }], other!.id);
    await mkRun({ agentId: null, ranAt: at(n, 2), costUsd: 0.5, ws: other!.id });

    const after = await perf(n);
    expect(after).toEqual(before);
    expect(after.agents.some((r) => r.agent_id === foreign.id)).toBe(false);
  });

  it('serves per-agent stats equal to the agent row of the performance report', async () => {
    const n = 12;
    const a = await mkAgent('StatsA');
    const b = await mkAgent('StatsB');
    const ra = await mkRun({ agentId: a.id, ranAt: at(n, 1), costUsd: 0.004, durationMs: 1200 });
    await mkRun({ agentId: a.id, ranAt: at(n, 2), costUsd: null, durationMs: 800 });
    await mkRun({ agentId: b.id, ranAt: at(n, 3), status: 'failed', costUsd: 0.02 });
    await mkFindings(ra, a.id, [{ accepted: at(n, 2) }, { dismissed: at(n, 2) }, { accepted: at(n, 3) }]);

    const p = await perf(n);
    const withId = p.agents.filter((r) => r.agent_id !== null);
    expect(withId.length).toBeGreaterThan(2);
    for (const row of withId) {
      const res = await stats(row.agent_id as string, n);
      expect(res.statusCode).toBe(200);
      const s = res.json() as AgentStats;
      expect({
        runs: s.runs,
        total_cost_usd: s.total_cost_usd,
        avg_cost_usd: s.avg_cost_usd,
        avg_latency_ms: s.avg_latency_ms,
        accepted: s.accepted,
        dismissed: s.dismissed,
        accept_rate: s.accept_rate,
      }).toEqual({
        runs: row.runs,
        total_cost_usd: row.total_cost_usd,
        avg_cost_usd: row.avg_cost_usd,
        avg_latency_ms: row.avg_latency_ms,
        accepted: row.accepted,
        dismissed: row.dismissed,
        accept_rate: row.accept_rate,
      });
    }
  });

  it('answers 404 for an unknown agent and for an agent of another workspace', async () => {
    const unknown = await stats('00000000-0000-4000-8000-000000000000', 13);
    expect(unknown.statusCode).toBe(404);

    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: `other-${seq++}` }).returning();
    const foreign = await mkAgent('Foreign404', { ws: other!.id });
    const res = await stats(foreign.id, 13);
    expect(res.statusCode).toBe(404);
  });

  it('writes no row and calls no model provider', async () => {
    const n = 14;
    const a = await mkAgent('ReadOnly');
    await mkRun({ agentId: a.id, ranAt: at(n, 1), costUsd: 0.01 });

    const db = pg.handle.db;
    const snapshot = async () => ({
      runs: (await db.select({ c: count() }).from(t.agentRuns))[0]!.c,
      traces: (await db.select({ c: count() }).from(t.runTraces))[0]!.c,
      reviews: (await db.select({ c: count() }).from(t.reviews))[0]!.c,
      agents: (await db.select({ c: count() }).from(t.agents).where(eq(t.agents.workspaceId, workspaceId)))[0]!.c,
    });
    const before = await snapshot();
    await perf(n);
    expect((await stats(a.id, n)).statusCode).toBe(200);
    expect(await snapshot()).toEqual(before);
    expect(openai.calls).toHaveLength(0);
    expect(anthropic.calls).toHaveLength(0);
  });
});
