import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Finding, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { findingCaseBody, insertDecidedFinding, insertEvalAgent } from './helpers/eval.js';
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

class ScriptedLLM extends MockLLMProvider {
  queue: Step[] = [];

  constructor() {
    super('openai');
  }

  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
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

const tryBody = (over: Json = {}): Json => ({
  expectation_type: 'must_find',
  input_diff: CONFIG_PART,
  input_meta: { pr_number: 480, pr_title: 'Add rate limiting', pr_author: 'marisa.koch', pr_body: 'Closes #471.' },
  expected_output: { file: 'src/config.ts', start_line: 11, end_line: 11 },
  ...over,
});

d('eval case try (Testcontainers pg)', () => {
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

  const tryCase = (agentId: string, body: Json = tryBody(), target: App = app) =>
    target.inject({ method: 'POST', url: `/agents/${agentId}/eval-cases/try`, payload: body });
  const codeOf = (res: { json(): unknown }) => (res.json() as { error: { code: string } }).error.code;

  const TABLES = [t.evalCases, t.evalRuns, t.reviews, t.findings, t.agentRuns, t.runTraces] as const;
  const rowCounts = async () =>
    Promise.all(TABLES.map(async (table) => (await db().select().from(table as never)).length));

  async function readSurfaces(agentId: string) {
    const get = async (url: string) => (await app.inject({ method: 'GET', url })).json();
    return [
      await get(`/agents/${agentId}/eval-cases`),
      await get(`/agents/${agentId}/eval-runs`),
      await get('/eval/dashboard'),
    ];
  }

  async function newCase(agentId: string) {
    const n = seq++;
    await db()
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agentId,
        name: `case-${n}`,
        expectationType: 'must_find',
        expectedOutput: {
          file: 'src/config.ts',
          start_line: 11,
          end_line: 11,
          severity: 'CRITICAL',
          category: 'security',
          title: `Expected ${n}`,
        },
        inputDiff: CONFIG_PART,
        inputFiles: ['src/config.ts'],
        inputMeta: { pr_number: 480, pr_title: 'Add rate limiting', pr_author: 'marisa.koch', pr_body: null },
      });
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

  it('AC-37, NFR-2: one structured call carries the agent prompt and the body diff', async () => {
    const agent = await insertEvalAgent(db(), workspaceId, { systemPrompt: 'You are a strict secret hunter.' });
    scripted.queue = [[finding(11)]];
    const before = scripted.structuredCalls.length;
    const res = await tryCase(agent.id);
    expect(res.statusCode).toBe(200);
    expect(scripted.structuredCalls.length - before).toBe(1);
    const messages = scripted.messages(before);
    expect(messages.find((m) => m.role === 'system')!.content).toContain('strict secret hunter');
    const user = messages.find((m) => m.role === 'user')!.content;
    expect(user).toContain('sk_live_xxx');
    expect(user).toContain('Closes #471.');
    expect(user).not.toContain('must_find');
  });

  it('AC-38, AC-39: a matching finding passes must_find and fails must_not_flag; the result carries findings, duration and cost', async () => {
    const agent = await insertEvalAgent(db(), workspaceId);
    scripted.queue = [[finding(11), finding(12, 'Second finding')]];
    const pass = (await tryCase(agent.id)).json() as Json;
    expect(pass).toMatchObject({ status: 'pass', matched: 1, error: null, cost_usd: 0.001 });
    expect(pass.findings).toHaveLength(2);
    expect((pass.findings as Json[])[0]).toEqual({
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      severity: 'WARNING',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
    });
    expect(pass.duration_ms).toEqual(expect.any(Number));

    scripted.queue = [[finding(11)]];
    const fail = (await tryCase(agent.id, tryBody({ expectation_type: 'must_not_flag' }))).json() as Json;
    expect(fail).toMatchObject({ status: 'fail', matched: 1 });
  });

  it('AC-42, AC-43: a pass, a fail and an error write no row and change no read', async () => {
    const agent = await insertEvalAgent(db(), workspaceId);
    await newCase(agent.id);
    const rowsBefore = await rowCounts();
    const readsBefore = await readSurfaces(agent.id);

    scripted.queue = [[finding(11)]];
    expect(((await tryCase(agent.id)).json() as Json).status).toBe('pass');
    scripted.queue = [[]];
    expect(((await tryCase(agent.id)).json() as Json).status).toBe('fail');
    scripted.queue = [new Error('provider exploded')];
    expect(((await tryCase(agent.id)).json() as Json).status).toBe('error');

    expect(await rowCounts()).toEqual(rowsBefore);
    expect(await readSurfaces(agent.id)).toEqual(readsBefore);
  });

  it('AC-44: a failing engine review answers 200 with the message cut to 500 characters', async () => {
    const agent = await insertEvalAgent(db(), workspaceId);
    scripted.queue = [new Error('x'.repeat(900))];
    const res = await tryCase(agent.id);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Json;
    expect(body).toMatchObject({ status: 'error', findings: [], cost_usd: null });
    expect((body.error as string).length).toBe(500);
  });

  it('AC-45: a provider without a key is 400 eval_provider_unavailable before any model call', async () => {
    const agent = await insertEvalAgent(db(), workspaceId);
    const bare = await buildTestApp({ llm: undefined });
    try {
      const before = scripted.calls.length;
      const res = await tryCase(agent.id, tryBody(), bare);
      expect(res.statusCode).toBe(400);
      expect(codeOf(res)).toBe('eval_provider_unavailable');
      expect(scripted.calls).toHaveLength(before);
    } finally {
      await bare.close();
    }
  });

  it('AC-46, NFR-5: schema, diff and expectation failures answer before any model call', async () => {
    const agent = await insertEvalAgent(db(), workspaceId);
    const before = scripted.calls.length;

    const blank = await tryCase(agent.id, tryBody({ input_diff: '   ' }));
    expect(blank.statusCode).toBe(422);
    const reversed = await tryCase(
      agent.id,
      tryBody({ expected_output: { file: 'src/config.ts', start_line: 12, end_line: 11 } }),
    );
    expect(reversed.statusCode).toBe(422);
    const prose = await tryCase(agent.id, tryBody({ input_diff: 'just some prose' }));
    expect(prose.statusCode).toBe(400);
    expect(codeOf(prose)).toBe('eval_diff_invalid');
    const outside = await tryCase(
      agent.id,
      tryBody({ expected_output: { file: 'src/config.ts', start_line: 40, end_line: 41 } }),
    );
    expect(outside.statusCode).toBe(400);
    expect(codeOf(outside)).toBe('expectation_outside_diff');
    const bad = await tryCase('not-a-uuid');
    expect(bad.statusCode).toBe(422);

    const huge = await tryCase(agent.id, tryBody({ input_diff: `${CONFIG_PART}${'+x\n'.repeat(400_000)}` }));
    expect(huge.statusCode).toBeGreaterThanOrEqual(400);
    expect(scripted.calls).toHaveLength(before);
  });

  it('AC-47: an unknown agent and an agent of another workspace are 404 before any model call', async () => {
    const [other] = await db().insert(t.workspaces).values({ name: 'other try' }).returning();
    const foreign = await insertEvalAgent(db(), other!.id);
    const before = scripted.calls.length;
    expect((await tryCase(foreign.id)).statusCode).toBe(404);
    expect((await tryCase('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect(scripted.calls).toHaveLength(before);
  });

  it('AC-48: a try is executed while a run of the agent is running', async () => {
    const agent = await insertEvalAgent(db(), workspaceId);
    await db()
      .insert(t.evalRuns)
      .values({ workspaceId, agentId: agent.id, agentVersion: 1, status: 'running', provider: 'openai', model: 'gpt-4.1' });
    scripted.queue = [[finding(11)]];
    const res = await tryCase(agent.id);
    expect(res.statusCode).toBe(200);
    expect((res.json() as Json).status).toBe('pass');
  });

  it('AC-36: a draft and two tries leave the case and run rows as they were', async () => {
    const agent = await insertEvalAgent(db(), workspaceId);
    await newCase(agent.id);
    const pr = await newPullFor();
    const { findingId } = await insertDecidedFinding(db(), {
      prId: pr,
      agentId: agent.id,
      decision: 'accepted',
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
    });
    const snapshot = async () => ({
      cases: await db().select().from(t.evalCases),
      runs: await db().select().from(t.evalRuns),
    });
    const before = JSON.stringify(await snapshot());
    const body = await findingCaseBody(app, findingId);
    expect(body.input_diff).toBe(CONFIG_PART);
    scripted.queue = [[finding(11)], []];
    await tryCase(agent.id);
    await tryCase(agent.id);
    expect(JSON.stringify(await snapshot())).toBe(before);
  });

  it('NFR-3: the try route carries the eval rate limit', async () => {
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
    const route = seen.find((r) => r.url === '/agents/:id/eval-cases/try' && r.method === 'POST');
    expect(route?.config?.rateLimit).toEqual(EVAL_RUN_RATE_LIMIT);
    await bare.close();
  });

  it('NFR-13: a try logs one record and none holds diff, title or finding text', async () => {
    const agent = await insertEvalAgent(db(), workspaceId);
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
    const result = await service.tryCase(workspaceId, agent.id, tryBody() as never);
    expect(result.status).toBe('pass');
    expect(records).toHaveLength(1);
    expect(records[0]!.msg).toBe('eval case tried');
    expect(records[0]!.obj).toMatchObject({
      agentId: agent.id,
      agentVersion: 1,
      status: 'pass',
      matched: 1,
      findingsProduced: 1,
      findingsGrounded: 1,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.001,
    });
    const logged = JSON.stringify(records);
    for (const text of ['sk_live_xxx', 'Secret finding title', 'Add rate limiting', 'Closes #471.']) {
      expect(logged).not.toContain(text);
    }
  });

  async function newPullFor() {
    const name = `try-repo-${seq++}`;
    const [repo] = await db()
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db()
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 700 + seq,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: 'Body.',
      })
      .returning();
    await db().insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: CONFIG_PART.split('\n').slice(3).join('\n').trimEnd(),
    });
    return pr!.id;
  }
});
