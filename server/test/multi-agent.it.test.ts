import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { Review, StructuredRequest, StructuredResult, MultiAgentRun } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockLLMProvider,
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

/** Mock model that can be held (to observe `running`) and made to fail for chosen models. */
class ScriptedLLM extends MockLLMProvider {
  failModels = new Set<string>();
  gate: Promise<void> | null = null;
  started = 0;

  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.started += 1;
    if (this.gate) await this.gate;
    if (this.failModels.has(req.model)) throw new Error(`provider exploded for ${req.model}`);
    return super.completeStructured(req);
  }
}

let repoSeq = 0;
async function setupRepo(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `multi-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  return repo!;
}

let prSeq = 100;
async function setupPr(db: PgFixture['handle']['db'], workspaceId: string, repoId: string) {
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number: prSeq++,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return pr!;
}

d('multi-agent review (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let modelSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function appWith(llm = new ScriptedLLM('openai', { structured: REVIEW_FIXTURE })) {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        secrets: new MockSecretsProvider({}),
        github: new MockGitHubClient(),
        llm: { openai: llm },
      },
    });
    return { app, llm };
  }

  async function createAgent(app: Awaited<ReturnType<typeof buildApp>>, model = `model-${modelSeq++}`) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: `Agent ${model}`, provider: 'openai', model, system_prompt: 'review' },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; name: string; model: string };
  }

  const counts = async () => {
    const parents = await pg.handle.db.select().from(t.multiAgentRuns);
    const runs = await pg.handle.db.select().from(t.agentRuns);
    return { parents: parents.length, runs: runs.length };
  };

  async function startRun(app: Awaited<ReturnType<typeof buildApp>>, prId: string, agentIds: string[]) {
    return app.inject({ method: 'POST', url: `/pulls/${prId}/multi-agent-run`, payload: { agent_ids: agentIds } });
  }

  it('AC-13 + EC-1: one parent and one child per distinct agent id, each child carrying the parent id', async () => {
    const { app } = await appWith();
    const repo = await setupRepo(pg.handle.db, workspaceId);
    const pr = await setupPr(pg.handle.db, workspaceId, repo.id);
    const a1 = await createAgent(app);
    const a2 = await createAgent(app);
    const disabled = await createAgent(app);
    await app.inject({ method: 'PUT', url: `/agents/${disabled.id}`, payload: { enabled: false } });

    const res = await startRun(app, pr.id, [a1.id, a1.id, a2.id, disabled.id]);
    expect(res.statusCode).toBe(200);
    const run = res.json() as MultiAgentRun;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 3 });

    const parents = await pg.handle.db.select().from(t.multiAgentRuns).where(eq(t.multiAgentRuns.prId, pr.id));
    expect(parents).toHaveLength(1);
    expect(parents[0]!.id).toBe(run.id);

    const children = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id));
    expect(children).toHaveLength(3);
    expect(children.every((c) => c.multiAgentRunId === run.id)).toBe(true);
    expect(children.map((c) => c.agentId).sort()).toEqual([a1.id, a2.id, disabled.id].sort());
    await app.close();
  });

  it('AC-14 + AC-17: the response holds every column running while the model is held, and the children call the model at once', async () => {
    const llm = new ScriptedLLM('openai', { structured: REVIEW_FIXTURE });
    let release!: () => void;
    llm.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { app } = await appWith(llm);
    const repo = await setupRepo(pg.handle.db, workspaceId);
    const pr = await setupPr(pg.handle.db, workspaceId, repo.id);
    const agents = [await createAgent(app), await createAgent(app), await createAgent(app)];

    const res = await startRun(app, pr.id, agents.map((a) => a.id));
    expect(res.statusCode).toBe(200);
    const run = res.json() as MultiAgentRun;
    expect(run.columns).toHaveLength(3);
    expect(run.columns.every((c) => c.status === 'running')).toBe(true);
    expect(run.agent_count).toBe(3);

    const start = Date.now();
    while (llm.started < 3 && Date.now() - start < 5000) await new Promise((r) => setTimeout(r, 20));
    expect(llm.started).toBeGreaterThanOrEqual(3);

    release();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 3 });
    await app.close();
  });

  it('AC-15 + NFR-3: an empty, missing or non-uuid agent_ids answers 422 and stores nothing', async () => {
    const { app } = await appWith();
    const repo = await setupRepo(pg.handle.db, workspaceId);
    const pr = await setupPr(pg.handle.db, workspaceId, repo.id);
    const before = await counts();

    const empty = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/multi-agent-run`, payload: { agent_ids: [] } });
    const missing = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/multi-agent-run`, payload: {} });
    const notUuid = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/multi-agent-run`, payload: { agent_ids: ['nope'] } });
    const badParam = await startRun(app, 'not-a-uuid', [randomUUID()]);

    expect([empty.statusCode, missing.statusCode, notUuid.statusCode, badParam.statusCode]).toEqual([422, 422, 422, 422]);
    expect(await counts()).toEqual(before);
    await app.close();
  });

  it('AC-16 + NFR-3: an unknown PR, an unknown agent among valid ones, or another workspace agent answers 404 and stores nothing', async () => {
    const { app } = await appWith();
    const repo = await setupRepo(pg.handle.db, workspaceId);
    const pr = await setupPr(pg.handle.db, workspaceId, repo.id);
    const mine = await createAgent(app);

    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: `other-${randomUUID()}` }).returning();
    const [foreignAgent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId: otherWs!.id, name: 'Foreign', provider: 'openai', model: 'x', systemPrompt: 'x' })
      .returning();
    const foreignRepo = await setupRepo(pg.handle.db, otherWs!.id);
    const foreignPr = await setupPr(pg.handle.db, otherWs!.id, foreignRepo.id);
    const before = await counts();

    const unknownAgent = await startRun(app, pr.id, [mine.id, randomUUID()]);
    const foreignAgentRes = await startRun(app, pr.id, [mine.id, foreignAgent!.id]);
    const unknownPr = await startRun(app, randomUUID(), [mine.id]);
    const foreignPrRes = await startRun(app, foreignPr.id, [mine.id]);

    expect([unknownAgent.statusCode, foreignAgentRes.statusCode, unknownPr.statusCode, foreignPrRes.statusCode]).toEqual([
      404, 404, 404, 404,
    ]);
    expect(await counts()).toEqual(before);
    await app.close();
  });

  it('AC-21 + AC-35 + AC-50 + AC-51: one failing child is stored failed with its error while the others finish; column findings equal the stored ones; attribution is queryable', async () => {
    const llm = new ScriptedLLM('openai', { structured: REVIEW_FIXTURE });
    const { app } = await appWith(llm);
    const repo = await setupRepo(pg.handle.db, workspaceId);
    const pr = await setupPr(pg.handle.db, workspaceId, repo.id);
    const good1 = await createAgent(app);
    const good2 = await createAgent(app);
    const bad = await createAgent(app);
    llm.failModels.add(bad.model);

    const started = (await startRun(app, pr.id, [good1.id, bad.id, good2.id])).json() as MultiAgentRun;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 3 });

    const run = (await app.inject({ method: 'GET', url: `/multi-agent-runs/${started.id}` })).json() as MultiAgentRun;
    const byAgent = new Map(run.columns.map((c) => [c.agent_id, c]));

    const failed = byAgent.get(bad.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('provider exploded');
    expect(failed.findings).toEqual([]);
    for (const good of [good1, good2]) {
      const col = byAgent.get(good.id)!;
      expect(col.status).toBe('done');
      expect(col.findings).toHaveLength(1);
    }
    expect(run.columns.map((c) => c.agent_name)).toEqual([...run.columns.map((c) => c.agent_name)].sort());
    expect(run.groups).toHaveLength(1);
    expect(run.groups[0]!.takes.map((tk) => tk.agent_id).sort()).toEqual([good1.id, good2.id].sort());

    for (const col of run.columns.filter((c) => c.status === 'done')) {
      const stored = await pg.handle.db
        .select({ finding: t.findings, review: t.reviews })
        .from(t.findings)
        .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
        .where(eq(t.reviews.runId, col.run_id));
      expect(stored.map((s) => s.finding.id).sort()).toEqual(col.findings.map((f) => f.id).sort());
      expect(stored.every((s) => s.review.agentId === col.agent_id)).toBe(true);
      expect(col.findings[0]!.title).toBe('Hardcoded Stripe secret key');
    }

    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json() as {
      agent_id: string | null;
      run_id: string | null;
    }[];
    const doneRunIds = run.columns.filter((c) => c.status === 'done').map((c) => c.run_id);
    for (const runId of doneRunIds) {
      const review = reviews.find((r) => r.run_id === runId)!;
      expect(review.agent_id).toBe(run.columns.find((c) => c.run_id === runId)!.agent_id);
    }
    await app.close();
  });

  it('AC-45 + EC-8: latest returns the repository newest run by ran_at, null for a repo with none, 404 for a foreign repo', async () => {
    const { app } = await appWith();
    const repo = await setupRepo(pg.handle.db, workspaceId);
    const otherRepo = await setupRepo(pg.handle.db, workspaceId);
    const emptyRepo = await setupRepo(pg.handle.db, workspaceId);
    const pr1 = await setupPr(pg.handle.db, workspaceId, repo.id);
    const pr2 = await setupPr(pg.handle.db, workspaceId, repo.id);
    const otherPr = await setupPr(pg.handle.db, workspaceId, otherRepo.id);
    const agent = await createAgent(app);

    const first = (await startRun(app, pr1.id, [agent.id])).json() as MultiAgentRun;
    const second = (await startRun(app, pr2.id, [agent.id])).json() as MultiAgentRun;
    const foreignRepoRun = (await startRun(app, otherPr.id, [agent.id])).json() as MultiAgentRun;
    await pg.handle.db
      .update(t.multiAgentRuns)
      .set({ ranAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(t.multiAgentRuns.id, first.id));
    await pg.handle.db
      .update(t.multiAgentRuns)
      .set({ ranAt: new Date('2026-02-01T00:00:00Z') })
      .where(eq(t.multiAgentRuns.id, second.id));
    await pg.handle.db
      .update(t.multiAgentRuns)
      .set({ ranAt: new Date('2026-03-01T00:00:00Z') })
      .where(eq(t.multiAgentRuns.id, foreignRepoRun.id));
    await waitForPrRuns(pg.handle.db, pr1.id, { expected: 1 });
    await waitForPrRuns(pg.handle.db, pr2.id, { expected: 1 });
    await waitForPrRuns(pg.handle.db, otherPr.id, { expected: 1 });

    const latest = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/multi-agent-runs/latest` })).json();
    expect(latest.run.id).toBe(second.id);

    const again = await startRun(app, pr1.id, [agent.id]);
    const third = again.json() as MultiAgentRun;
    await waitForPrRuns(pg.handle.db, pr1.id, { expected: 2 });
    const afterThird = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/multi-agent-runs/latest` })).json();
    expect(afterThird.run.id).toBe(third.id);
    expect(afterThird.run.columns).toHaveLength(1);

    const none = await app.inject({ method: 'GET', url: `/repos/${emptyRepo.id}/multi-agent-runs/latest` });
    expect(none.statusCode).toBe(200);
    expect(none.json()).toEqual({ run: null });

    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: `other-${randomUUID()}` }).returning();
    const foreignRepo = await setupRepo(pg.handle.db, otherWs!.id);
    const foreign = await app.inject({ method: 'GET', url: `/repos/${foreignRepo.id}/multi-agent-runs/latest` });
    const unknown = await app.inject({ method: 'GET', url: `/repos/${randomUUID()}/multi-agent-runs/latest` });
    const bad = await app.inject({ method: 'GET', url: `/repos/nope/multi-agent-runs/latest` });
    expect([foreign.statusCode, unknown.statusCode, bad.statusCode]).toEqual([404, 404, 422]);
    await app.close();
  });

  it('AC-48 + NFR-3: GET /multi-agent-runs/:id answers 404 for an unknown id and for another workspace run, 422 for a non-uuid', async () => {
    const { app } = await appWith();
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: `other-${randomUUID()}` }).returning();
    const foreignRepo = await setupRepo(pg.handle.db, otherWs!.id);
    const foreignPr = await setupPr(pg.handle.db, otherWs!.id, foreignRepo.id);
    const [foreignRun] = await pg.handle.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId: otherWs!.id, prId: foreignPr.id })
      .returning();

    const unknown = await app.inject({ method: 'GET', url: `/multi-agent-runs/${randomUUID()}` });
    const foreign = await app.inject({ method: 'GET', url: `/multi-agent-runs/${foreignRun!.id}` });
    const bad = await app.inject({ method: 'GET', url: `/multi-agent-runs/not-a-uuid` });
    expect([unknown.statusCode, foreign.statusCode, bad.statusCode]).toEqual([404, 404, 422]);
    await app.close();
  });

  it('AC-12: estimates carry the newest done run of each agent and null for both values when there is none', async () => {
    const { app } = await appWith();
    const repo = await setupRepo(pg.handle.db, workspaceId);
    const pr = await setupPr(pg.handle.db, workspaceId, repo.id);
    const withRuns = await createAgent(app);
    const withoutRuns = await createAgent(app);
    const run = (over: Partial<typeof t.agentRuns.$inferInsert>) => ({
      workspaceId,
      agentId: withRuns.id,
      prId: pr.id,
      ...over,
    });
    await pg.handle.db.insert(t.agentRuns).values([
      run({ status: 'done', durationMs: 1000, costUsd: 0.01, ranAt: new Date('2026-05-01T00:00:00Z') }),
      run({ status: 'done', durationMs: 2500, costUsd: 0.04, ranAt: new Date('2026-06-01T00:00:00Z') }),
      run({ status: 'failed', durationMs: 9, costUsd: null, ranAt: new Date('2026-07-01T00:00:00Z') }),
    ]);

    const res = await app.inject({ method: 'GET', url: '/multi-agent-runs/estimates' });
    expect(res.statusCode).toBe(200);
    const estimates = (res.json() as { estimates: { agent_id: string; duration_ms: number | null; cost_usd: number | null }[] })
      .estimates;
    const byId = new Map(estimates.map((e) => [e.agent_id, e]));
    expect(byId.get(withRuns.id)).toEqual({ agent_id: withRuns.id, duration_ms: 2500, cost_usd: 0.04 });
    expect(byId.get(withoutRuns.id)).toEqual({ agent_id: withoutRuns.id, duration_ms: null, cost_usd: null });
    await app.close();
  });

  it('AC-29 + AC-30 + EC-10: Learn stores one learning memory row without a model call and a repeat stores none; a foreign finding is 404', async () => {
    const { app, llm } = await appWith();
    const repo = await setupRepo(pg.handle.db, workspaceId);
    const pr = await setupPr(pg.handle.db, workspaceId, repo.id);
    const agent = await createAgent(app);
    const started = (await startRun(app, pr.id, [agent.id])).json() as MultiAgentRun;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const run = (await app.inject({ method: 'GET', url: `/multi-agent-runs/${started.id}` })).json() as MultiAgentRun;
    const finding = run.columns[0]!.findings[0]!;
    const modelCalls = llm.calls.length;

    const first = await app.inject({ method: 'POST', url: `/findings/${finding.id}/learn` });
    expect(first.statusCode).toBe(200);
    expect(first.json().finding.id).toBe(finding.id);
    const second = await app.inject({ method: 'POST', url: `/findings/${finding.id}/learn` });
    expect(second.statusCode).toBe(200);

    const rows = await pg.handle.db
      .select()
      .from(t.memory)
      .where(and(eq(t.memory.workspaceId, workspaceId), eq(t.memory.repoId, repo.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'learning', scope: 'repo' });
    expect(rows[0]!.content).toContain(finding.title);
    expect(rows[0]!.content).toContain(finding.rationale);
    expect(llm.calls.length).toBe(modelCalls);

    const unknown = await app.inject({ method: 'POST', url: `/findings/${randomUUID()}/learn` });
    expect(unknown.statusCode).toBe(404);

    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: `other-${randomUUID()}` }).returning();
    const foreignRepo = await setupRepo(pg.handle.db, otherWs!.id);
    const foreignPr = await setupPr(pg.handle.db, otherWs!.id, foreignRepo.id);
    const [foreignReview] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId: otherWs!.id, prId: foreignPr.id, kind: 'review' })
      .returning();
    const [foreignFinding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: foreignReview!.id,
        severity: 'WARNING',
        category: 'bug',
        title: 'x',
        file: 'a.ts',
        startLine: 1,
        endLine: 1,
        rationale: 'x',
        confidence: 0.5,
      })
      .returning();
    const foreign = await app.inject({ method: 'POST', url: `/findings/${foreignFinding!.id}/learn` });
    expect(foreign.statusCode).toBe(404);
    expect(await pg.handle.db.select().from(t.memory).where(inArray(t.memory.workspaceId, [otherWs!.id]))).toHaveLength(0);
    await app.close();
  });

  it('NFR-1: reading a run, the latest run and the estimates makes no model call and starts no run', async () => {
    const { app, llm } = await appWith();
    const repo = await setupRepo(pg.handle.db, workspaceId);
    const pr = await setupPr(pg.handle.db, workspaceId, repo.id);
    const agent = await createAgent(app);
    const started = (await startRun(app, pr.id, [agent.id])).json() as MultiAgentRun;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const before = await counts();
    const modelCalls = llm.calls.length;

    await app.inject({ method: 'GET', url: `/multi-agent-runs/${started.id}` });
    await app.inject({ method: 'GET', url: `/repos/${repo.id}/multi-agent-runs/latest` });
    await app.inject({ method: 'GET', url: '/multi-agent-runs/estimates' });

    expect(llm.calls.length).toBe(modelCalls);
    expect(await counts()).toEqual(before);
    await app.close();
  });
});
