import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Finding, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { findingCaseBody, insertDecidedFinding, insertEvalAgent, waitForEvalRun } from './helpers/eval.js';
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
import evalRoutes from '../src/modules/eval/routes.js';
import { EvalService } from '../src/modules/eval/service.js';
import { EVAL_RUN_RATE_LIMIT } from '../src/modules/eval/constants.js';
import { scoreRun } from '../src/modules/eval/scoring.js';
import { tallyOf } from '../src/modules/eval/helpers.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const CONFIG_PART = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,
`;

const PATCH = CONFIG_PART.split('\n').slice(3).join('\n').trimEnd();

type App = Awaited<ReturnType<typeof buildApp>>;
type Json = Record<string, unknown>;
type Step = Finding[] | Error | { costUsd: number | null; findings: Finding[] };

const finding = (line: number, title = 'Hardcoded Stripe secret key'): Finding => ({
  id: `f-${line}-${title}`,
  severity: 'WARNING',
  category: 'security',
  title,
  file: 'src/config.ts',
  start_line: line,
  end_line: line,
  rationale: 'A live key is committed.',
  confidence: 0.9,
  kind: 'finding',
});

/** Answers each structured call from a queue; an empty queue answers "no findings". */
class ScriptedLLM extends MockLLMProvider {
  queue: Step[] = [];
  gate: Promise<void> | null = null;

  constructor() {
    super('openai');
  }

  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
    if (this.gate) await this.gate;
    const step = this.queue.shift() ?? [];
    if (step instanceof Error) throw step;
    const findings = Array.isArray(step) ? step : step.findings;
    const costUsd = Array.isArray(step) ? 0.001 : step.costUsd;
    return {
      data: { verdict: 'comment', summary: 'ok', score: 90, findings } as T,
      model: req.model,
      tokensIn: 10,
      tokensOut: 5,
      costUsd,
      raw: '{}',
      attempts: 1,
    };
  }

  get structuredCalls() {
    return this.calls.filter((c) => c.method === 'completeStructured');
  }

  messages(index: number): { role: string; content: string }[] {
    return (this.structuredCalls[index]!.req as StructuredRequest<unknown>).messages as {
      role: string;
      content: string;
    }[];
  }
}

d('eval runs (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: App;
  let workspaceId: string;
  let scripted: ScriptedLLM;
  let seq = 0;

  const db = () => pg.handle.db;

  function buildTestApp(overrides: Record<string, unknown> = {}) {
    return buildApp({
      config: config(),
      db: db(),
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: CONFIG_PART }),
        secrets: new MockSecretsProvider({}),
        github: new MockGitHubClient(),
        llm: { openai: scripted },
        ...overrides,
      },
    });
  }

  async function newAgent(over: Partial<typeof t.agents.$inferInsert> = {}) {
    return insertEvalAgent(db(), workspaceId, over);
  }

  async function newCase(
    agentId: string,
    over: {
      type?: 'must_find' | 'must_not_flag';
      line?: number;
      prTitle?: string;
      ownerWorkspace?: string;
    } = {},
  ) {
    const n = seq++;
    const [row] = await db()
      .insert(t.evalCases)
      .values({
        workspaceId: over.ownerWorkspace ?? workspaceId,
        ownerKind: 'agent',
        ownerId: agentId,
        name: `case-${n}`,
        expectationType: over.type ?? 'must_find',
        expectedOutput: {
          file: 'src/config.ts',
          start_line: over.line ?? 11,
          end_line: over.line ?? 11,
          severity: 'CRITICAL',
          category: 'security',
          title: `Expected ${n}`,
        },
        inputDiff: CONFIG_PART,
        inputFiles: ['src/config.ts'],
        inputMeta: {
          pr_number: 480,
          pr_title: over.prTitle ?? 'Add rate limiting',
          pr_author: 'marisa.koch',
          pr_body: 'Add rate limiting. Closes #471.',
        },
      })
      .returning();
    return row!;
  }

  const startRun = (agentId: string, target: App = app) =>
    target.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
  const codeOf = (res: { json(): unknown }) => (res.json() as { error: { code: string } }).error.code;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const count = async (table: any) => (await db().select().from(table)).length;

  async function runToEnd(agentId: string) {
    const res = await startRun(agentId);
    expect(res.statusCode).toBe(202);
    const started = res.json() as Json;
    const settled = await waitForEvalRun(app, started.id as string);
    return { started, settled };
  }

  beforeAll(async () => {
    pg = await startPg();
    await seed(db());
    const [ws] = await db().select().from(t.workspaces);
    workspaceId = ws!.id;
    scripted = new ScriptedLLM();
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('AC-31, AC-32, AC-38, AC-65, NFR-2: a disabled agent runs; one call per case; the run settles with its outcomes', async () => {
    const agent = await newAgent({ enabled: false, systemPrompt: 'You are a strict reviewer.' });
    const mustFind = await newCase(agent.id, { type: 'must_find' });
    const mustNot = await newCase(agent.id, { type: 'must_not_flag', line: 11 });
    const before = scripted.structuredCalls.length;
    scripted.queue = [[finding(11)], [finding(99, 'Not in the diff')]];

    const { started, settled } = await runToEnd(agent.id);

    expect(started).toMatchObject({
      status: 'running',
      agent_id: agent.id,
      agent_version: 1,
      cases_total: 2,
      case_ids: [mustFind.id, mustNot.id],
      provider: 'openai',
      model: 'gpt-4.1',
    });
    expect(scripted.structuredCalls.length - before).toBe(2);

    const first = scripted.messages(before);
    expect(first.find((m) => m.role === 'system')!.content).toContain('You are a strict reviewer.');
    const user = first.find((m) => m.role === 'user')!.content;
    expect(user).toContain('sk_live_xxx');
    expect(user).not.toContain(mustFind.name);
    expect(user).not.toContain('must_find');
    expect(user).not.toContain('Expected');

    expect(settled).toMatchObject({
      status: 'done',
      cases_total: 2,
      cases_passed: 2,
      cases_failed: 0,
      cases_errored: 0,
      recall: 1,
      findings_total: 2,
      findings_grounded: 1,
      precision: 1,
      citation_accuracy: 0.5,
      error: null,
    });
    expect(settled.cost_usd as number).toBeCloseTo(0.002, 6);
    expect(settled.duration_ms).toEqual(expect.any(Number));
    const results = settled.results as Json[];
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      case_id: mustFind.id,
      case_name: mustFind.name,
      expectation_type: 'must_find',
      status: 'pass',
      matched: 1,
      error: null,
    });
    expect(results[0]).not.toHaveProperty('produced');
    expect((results[0]!.findings as Json[])[0]).toMatchObject({ file: 'src/config.ts', start_line: 11 });
    expect(results[1]).toMatchObject({ status: 'pass', matched: 0, findings: [] });
  });

  it('AC-33: repo intel on and attached documents add no skeleton, callers, context or intent', async () => {
    const agent = await newAgent({ repoIntel: true });
    await db().insert(t.agentContextDocs).values({ agentId: agent.id, path: 'docs/guide.md', position: 0 });
    await newCase(agent.id);
    const before = scripted.structuredCalls.length;
    await runToEnd(agent.id);

    const user = scripted.messages(before).find((m) => m.role === 'user')!.content;
    for (const section of ['## Repo skeleton', '## Project context', '## Callers', '## PR intent']) {
      expect(user).not.toContain(section);
    }
    expect(user).toContain('## Diff to review');
  });

  it('AC-34, AC-36: the task line comes from the stored case, and two runs send identical input', async () => {
    const agent = await newAgent();
    const repoName = `eval-live-${seq++}`;
    const [repo] = await db()
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: repoName, fullName: `acme/${repoName}` })
      .returning();
    const [pr] = await db()
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 501,
        title: 'Original title',
        author: 'marisa.koch',
        branch: 'feat/x',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: 'Original body.',
      })
      .returning();
    await db()
      .insert(t.prFiles)
      .values({ prId: pr!.id, path: 'src/config.ts', additions: 1, deletions: 0, patch: PATCH });
    const { findingId } = await insertDecidedFinding(db(), {
      prId: pr!.id,
      agentId: agent.id,
      decision: 'accepted',
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/findings/${findingId}/eval-case`,
          payload: await findingCaseBody(app, findingId),
        })
      ).statusCode,
    ).toBe(201);
    await db()
      .update(t.pullRequests)
      .set({ title: 'Changed later', body: 'Changed body.' })
      .where(eq(t.pullRequests.id, pr!.id));

    const before = scripted.structuredCalls.length;
    await runToEnd(agent.id);
    await runToEnd(agent.id);

    const first = JSON.stringify(scripted.messages(before));
    expect(first).toContain('Original title');
    expect(first).toContain('Original body.');
    expect(first).not.toContain('Changed');
    expect(JSON.stringify(scripted.messages(before + 1))).toBe(first);
  });

  it('AC-37: a case whose call throws becomes an error outcome and the others still run', async () => {
    const agent = await newAgent();
    await newCase(agent.id);
    const failing = await newCase(agent.id);
    await newCase(agent.id);
    const before = scripted.structuredCalls.length;
    scripted.queue = [[finding(11)], new Error('provider exploded'), [finding(11)]];

    const { settled } = await runToEnd(agent.id);

    expect(scripted.structuredCalls.length - before).toBe(3);
    expect(settled).toMatchObject({ status: 'done', cases_total: 3, cases_passed: 2, cases_errored: 1 });
    const results = settled.results as Json[];
    expect(results[1]).toMatchObject({
      case_id: failing.id,
      status: 'error',
      error: 'provider exploded',
      findings: [],
    });
  });

  it('AC-38: the cost is null as soon as one execution reports none', async () => {
    const agent = await newAgent();
    await newCase(agent.id);
    await newCase(agent.id);
    scripted.queue = [{ costUsd: 0.5, findings: [] }, { costUsd: null, findings: [] }];
    const { settled } = await runToEnd(agent.id);
    expect(settled.status).toBe('done');
    expect(settled.cost_usd).toBeNull();
  });

  it('AC-39, AC-44: no case is eval_no_cases; an unknown agent or a foreign workspace is 404', async () => {
    const empty = await newAgent();
    const res = await startRun(empty.id);
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('eval_no_cases');

    expect((await startRun('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await startRun('not-a-uuid')).statusCode).toBe(422);

    const [other] = await db().insert(t.workspaces).values({ name: 'other-runs' }).returning();
    const foreign = await insertEvalAgent(db(), other!.id);
    await newCase(foreign.id, { ownerWorkspace: other!.id });
    const [foreignRun] = await db()
      .insert(t.evalRuns)
      .values({
        workspaceId: other!.id,
        agentId: foreign.id,
        agentVersion: 1,
        status: 'done',
        provider: 'openai',
        model: 'gpt-4.1',
      })
      .returning();
    expect((await startRun(foreign.id)).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/agents/${foreign.id}/eval-runs` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/eval-runs/${foreignRun!.id}` })).statusCode).toBe(404);
    expect(await db().select().from(t.evalRuns).where(eq(t.evalRuns.agentId, empty.id))).toHaveLength(0);
  });

  it('AC-40: a provider without a key is eval_provider_unavailable and nothing is stored', async () => {
    const agent = await newAgent();
    await newCase(agent.id);
    const bare = await buildTestApp({ llm: undefined });
    try {
      const res = await startRun(agent.id, bare);
      expect(res.statusCode).toBe(400);
      expect(codeOf(res)).toBe('eval_provider_unavailable');
      expect(await db().select().from(t.evalRuns).where(eq(t.evalRuns.agentId, agent.id))).toHaveLength(0);
    } finally {
      await bare.close();
    }
  });

  it('AC-41: a second start while one runs is refused with the id of the running run', async () => {
    const agent = await newAgent();
    await newCase(agent.id);
    let release!: () => void;
    scripted.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const first = await startRun(agent.id);
      expect(first.statusCode).toBe(202);
      const second = await startRun(agent.id);
      expect(second.statusCode).toBe(400);
      expect(codeOf(second)).toBe('eval_run_in_progress');
      expect((second.json() as { error: { details: Json } }).error.details).toEqual({
        run_id: (first.json() as Json).id,
      });
      release();
      scripted.gate = null;
      const settled = await waitForEvalRun(app, (first.json() as Json).id as string);
      expect(settled.status).toBe('done');
      expect((await startRun(agent.id)).statusCode).toBe(202);
      await waitForEvalRun(app, (await db().select().from(t.evalRuns).where(eq(t.evalRuns.agentId, agent.id)))[1]!.id);
    } finally {
      release();
      scripted.gate = null;
    }
  });

  it('AC-42: a run left running is failed with "interrupted" when the API starts', async () => {
    const agent = await newAgent();
    const [stuck] = await db()
      .insert(t.evalRuns)
      .values({ workspaceId, agentId: agent.id, agentVersion: 1, status: 'running', provider: 'openai', model: 'm' })
      .returning();
    const restarted = await buildTestApp();
    try {
      const [row] = await db().select().from(t.evalRuns).where(eq(t.evalRuns.id, stuck!.id));
      expect(row).toMatchObject({ status: 'failed', error: 'interrupted' });
      const body = (await restarted.inject({ method: 'GET', url: `/eval-runs/${stuck!.id}` })).json() as Json;
      expect(body).toMatchObject({ status: 'failed', error: 'interrupted' });
    } finally {
      await restarted.close();
    }
  });

  it('AC-43, AC-97: a run writes no review, finding, agent run or trace; reads and scoring call no model', async () => {
    const agent = await newAgent();
    await newCase(agent.id);
    await newCase(agent.id, { type: 'must_not_flag' });
    const tables = [t.reviews, t.findings, t.agentRuns, t.runTraces];
    const rowsBefore = await Promise.all(tables.map((table) => count(table)));
    scripted.queue = [[finding(11)], [finding(11)]];

    const { started, settled } = await runToEnd(agent.id);
    expect(settled).toMatchObject({ status: 'done', cases_passed: 1, cases_failed: 1 });
    expect(await Promise.all(tables.map((table) => count(table)))).toEqual(rowsBefore);

    const callsBefore = scripted.calls.length;
    await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs` });
    await app.inject({ method: 'GET', url: `/eval-runs/${started.id}` });
    await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
    const stored = await app.container.evalRepo.getRun(workspaceId, started.id as string);
    const rescored = scoreRun(stored!.results.map(tallyOf));
    expect(rescored.recall).toBe(settled.recall);
    expect(rescored.precision).toBe(settled.precision);
    expect(rescored.citationAccuracy).toBe(settled.citation_accuracy);
    expect(scripted.calls.length).toBe(callsBefore);
  });

  it('AC-64, NFR-13: 21 stored runs list as the 20 newest, without results', async () => {
    const agent = await newAgent();
    const base = Date.now() - 100_000_000;
    await db()
      .insert(t.evalRuns)
      .values(
        Array.from({ length: 21 }, (_, i) => ({
          workspaceId,
          agentId: agent.id,
          agentVersion: i + 1,
          status: 'done' as const,
          provider: 'openai',
          model: 'm',
          ranAt: new Date(base + i * 1000),
        })),
      );
    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(200);
    const list = res.json() as Json[];
    expect(list).toHaveLength(20);
    expect(list[0]!.agent_version).toBe(21);
    expect(list[19]!.agent_version).toBe(2);
    for (const run of list) expect(run).not.toHaveProperty('results');
  });

  it('AC-67: the run stores the names of the enabled linked skills in order', async () => {
    const agent = await newAgent();
    await newCase(agent.id);
    const mk = async (name: string, enabled: boolean) => {
      const [skill] = await db()
        .insert(t.skills)
        .values({ workspaceId, name, description: name, type: 'custom', source: 'manual', body: `Body of ${name}`, enabled })
        .returning();
      return skill!;
    };
    const one = await mk(`skill-one-${seq++}`, true);
    const off = await mk(`skill-off-${seq++}`, false);
    const two = await mk(`skill-two-${seq++}`, true);
    await db().insert(t.agentSkills).values([
      { agentId: agent.id, skillId: two.id, order: 1 },
      { agentId: agent.id, skillId: off.id, order: 2 },
      { agentId: agent.id, skillId: one.id, order: 0 },
    ]);
    const before = scripted.structuredCalls.length;
    const { started, settled } = await runToEnd(agent.id);
    expect(started.skills).toEqual([one.name, two.name]);
    expect(settled.skills).toEqual([one.name, two.name]);
    const user = scripted.messages(before).map((m) => m.content).join('\n');
    expect(user).toContain('Body of ' + one.name);
    expect(user).not.toContain('Body of ' + off.name);
  });

  it('AC-29: deleting a case leaves the stored run unchanged', async () => {
    const agent = await newAgent();
    const doomed = await newCase(agent.id);
    await newCase(agent.id);
    const { started } = await runToEnd(agent.id);
    const read = async () =>
      (await app.inject({ method: 'GET', url: `/eval-runs/${started.id}` })).json() as Json;
    const before = await read();
    expect((await app.inject({ method: 'DELETE', url: `/eval-cases/${doomed.id}` })).statusCode).toBe(200);
    expect(await read()).toEqual(before);
    expect((before.results as Json[])[0]).toMatchObject({ case_id: doomed.id, case_name: doomed.name });
  });

  it('AC-20: last_result comes from the newest done run; a later case has none', async () => {
    const agent = await newAgent();
    const covered = await newCase(agent.id);
    scripted.queue = [[]];
    const { started } = await runToEnd(agent.id);
    const later = await newCase(agent.id);

    const cases = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` })).json() as Json[];
    expect(cases.map((c) => c.id)).toEqual([covered.id, later.id]);
    expect(cases[0]!.last_result).toEqual({ run_id: started.id, status: 'fail', matched: 0, error: null });
    expect(cases[1]!.last_result).toBeNull();
  });

  it('AC-93: eight cases of both types run and score as one run', async () => {
    const agent = await newAgent();
    for (let i = 0; i < 4; i += 1) await newCase(agent.id, { type: 'must_find' });
    for (let i = 0; i < 4; i += 1) await newCase(agent.id, { type: 'must_not_flag' });
    const before = scripted.structuredCalls.length;
    scripted.queue = [
      [finding(11)], [finding(11)], [finding(11)], [],
      [], [], [finding(11)], [],
    ];
    const { settled } = await runToEnd(agent.id);
    expect(scripted.structuredCalls.length - before).toBe(8);
    expect(settled).toMatchObject({
      status: 'done',
      cases_total: 8,
      cases_passed: 6,
      cases_failed: 2,
      recall: 0.75,
      findings_grounded: 4,
      findings_total: 4,
    });
    expect(settled.precision).toBe(0.75);
    expect(settled.citation_accuracy).toBe(1);
  });

  it('NFR-3: the start route carries the eval rate limit', async () => {
    const seen: { url: string; method: unknown; config?: { rateLimit?: unknown } }[] = [];
    const bare = Fastify();
    bare.setValidatorCompiler(validatorCompiler);
    bare.setSerializerCompiler(serializerCompiler);
    bare.addHook('onRoute', (route) => {
      seen.push({ url: route.url, method: route.method, config: route.config as never });
    });
    bare.decorate('container', { evalService: {} } as never);
    await bare.register(evalRoutes);
    await bare.ready();
    const start = seen.find((r) => r.url === '/agents/:id/eval-runs' && r.method === 'POST');
    expect(start?.config?.rateLimit).toEqual(EVAL_RUN_RATE_LIMIT);
    expect(EVAL_RUN_RATE_LIMIT).toEqual({ max: 10, timeWindow: '1 minute' });
    await bare.close();
  });

  it('NFR-12: a run logs two records and none holds diff or expectation text', async () => {
    const agent = await newAgent();
    const c = await newCase(agent.id);
    scripted.queue = [[finding(11, 'Secret finding title')]];
    const records: { obj: Record<string, unknown>; msg: string }[] = [];
    const container = app.container;
    const service = new EvalService({
      store: container.evalRepo,
      agents: container.agentsRepo,
      skills: container.skillsRepo,
      findings: container.reviewService,
      llm: async () => scripted,
      log: {
        info: (obj, msg) => records.push({ obj: obj as Record<string, unknown>, msg: msg ?? '' }),
        warn: (obj, msg) => records.push({ obj: obj as Record<string, unknown>, msg }),
      },
    });
    const run = await service.startRun(workspaceId, agent.id);
    const settled = await waitForEvalRun(app, run.id);
    expect(settled.status).toBe('done');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(records).toHaveLength(2);
    expect(records[0]!.obj).toMatchObject({ runId: run.id, agentId: agent.id, agentVersion: 1, casesTotal: 1 });
    expect(records[1]!.obj).toMatchObject({
      runId: run.id,
      agentId: agent.id,
      agentVersion: 1,
      casesPassed: 1,
      recall: 1,
      tokensIn: 10,
      tokensOut: 5,
    });
    const logged = JSON.stringify(records);
    for (const secret of ['sk_live_xxx', 'Secret finding title', c.name, 'Add rate limiting']) {
      expect(logged).not.toContain(secret);
    }
  });
});
