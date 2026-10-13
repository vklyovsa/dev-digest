import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Finding, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { insertEvalAgent, insertEvalSkill } from './helpers/eval.js';
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

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

type App = Awaited<ReturnType<typeof buildApp>>;
type Json = Record<string, unknown>;
type Step = Finding[] | Error;

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
    return {
      data: { verdict: 'comment', summary: 'ok', score: 90, findings: step } as T,
      model: req.model,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.001,
      raw: '{}',
      attempts: 1,
    };
  }

  get structuredCalls() {
    return this.calls.filter((c) => c.method === 'completeStructured');
  }

  text(index: number): string {
    return (this.structuredCalls[index]!.req as StructuredRequest<unknown>).messages
      .map((m) => (m as { content: string }).content)
      .join('\n');
  }
}

const tryBody = (hostId: string, over: Json = {}): Json => ({
  host_agent_id: hostId,
  expectation_type: 'must_find',
  input_diff: CONFIG_PART,
  input_meta: { pr_number: 480, pr_title: 'Add rate limiting', pr_author: 'marisa.koch', pr_body: 'Closes #471.' },
  expected_output: { file: 'src/config.ts', start_line: 11, end_line: 11 },
  ...over,
});

d('eval skill try (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: App;
  let workspaceId: string;
  let scripted: ScriptedLLM;
  let git: MockGitClient;
  let github: MockGitHubClient;
  let seq = 0;

  const db = () => pg.handle.db;

  function buildTestApp(overrides: Record<string, unknown> = {}) {
    return buildApp({
      config: config(),
      db: db(),
      overrides: {
        embedder: new MockEmbedder(),
        git,
        secrets: new MockSecretsProvider({}),
        github,
        llm: { openai: scripted },
        ...overrides,
      },
    });
  }

  const tryCase = (skillId: string, body: Json, target: App = app) =>
    target.inject({ method: 'POST', url: `/skills/${skillId}/eval-cases/try`, payload: body });
  const codeOf = (res: { json(): unknown }) => (res.json() as { error: { code: string } }).error.code;
  const newHost = () => insertEvalAgent(db(), workspaceId);
  const newSkill = (over: Partial<typeof t.skills.$inferInsert> = {}) => insertEvalSkill(db(), workspaceId, over);
  const externalCalls = () =>
    git.cloned.length + git.syncs.length + git.readsAt.length + git.pullFetches.length +
    github.posted.length + github.openedPrs.length + github.committed.length + github.createdComments.length;

  const TABLES = [t.evalCases, t.evalRuns, t.reviews, t.findings, t.agentRuns, t.runTraces] as const;
  const rowCounts = async () =>
    Promise.all(TABLES.map(async (table) => (await db().select().from(table as never)).length));

  async function newCase(skillId: string) {
    const n = seq++;
    await db()
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'skill',
        ownerId: skillId,
        name: `skill-case-${n}`,
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

  async function readSurfaces(skillId: string) {
    const get = async (url: string) => (await app.inject({ method: 'GET', url })).json();
    return [await get(`/skills/${skillId}/eval-cases`), await get(`/skills/${skillId}/eval-runs`)];
  }

  beforeAll(async () => {
    pg = await startPg();
    await seed(db());
    const [ws] = await db().select().from(t.workspaces);
    workspaceId = ws!.id;
    scripted = new ScriptedLLM();
    git = new MockGitClient({ diff: CONFIG_PART });
    github = new MockGitHubClient();
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('AC-26: one structured call holds the skill block and the body diff; an overlapping grounded finding passes must_find', async () => {
    const host = await newHost();
    const skill = await newSkill({ body: 'Flag hardcoded secrets.' });
    scripted.queue = [[finding(11)]];
    const before = scripted.structuredCalls.length;

    const res = await tryCase(skill.id, tryBody(host.id));

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'pass', matched: 1, error: null, cost_usd: 0.001 });
    expect(scripted.structuredCalls.length - before).toBe(1);
    const text = scripted.text(before);
    expect(text).toContain(`### Skill: ${skill.name} (rubric · manual)`);
    expect(text).toContain('Flag hardcoded secrets.');
    expect(text).toContain('sk_live_xxx');
    expect(text).toContain('Closes #471.');
    expect(text).not.toContain('must_find');
  });

  it('AC-27: a pass, a fail and an error write no row and change neither list', async () => {
    const host = await newHost();
    const skill = await newSkill();
    await newCase(skill.id);
    const rowsBefore = await rowCounts();
    const readsBefore = await readSurfaces(skill.id);

    scripted.queue = [[finding(11)]];
    expect(((await tryCase(skill.id, tryBody(host.id))).json() as Json).status).toBe('pass');
    scripted.queue = [[]];
    expect(((await tryCase(skill.id, tryBody(host.id))).json() as Json).status).toBe('fail');
    scripted.queue = [new Error('provider exploded')];
    expect(((await tryCase(skill.id, tryBody(host.id))).json() as Json).status).toBe('error');

    expect(await rowCounts()).toEqual(rowsBefore);
    expect(await readSurfaces(skill.id)).toEqual(readsBefore);
  });

  it('AC-28: schema, diff and expectation failures answer before any model call', async () => {
    const host = await newHost();
    const skill = await newSkill();
    const before = scripted.calls.length;

    expect((await tryCase(skill.id, tryBody(host.id, { input_diff: '   ' }))).statusCode).toBe(422);
    expect(
      (
        await tryCase(
          skill.id,
          tryBody(host.id, { expected_output: { file: 'src/config.ts', start_line: 12, end_line: 11 } }),
        )
      ).statusCode,
    ).toBe(422);
    const prose = await tryCase(skill.id, tryBody(host.id, { input_diff: 'just some prose' }));
    expect(prose.statusCode).toBe(400);
    expect(codeOf(prose)).toBe('eval_diff_invalid');
    const outside = await tryCase(
      skill.id,
      tryBody(host.id, { expected_output: { file: 'src/config.ts', start_line: 40, end_line: 41 } }),
    );
    expect(outside.statusCode).toBe(400);
    expect(codeOf(outside)).toBe('expectation_outside_diff');
    expect(scripted.calls).toHaveLength(before);
  });

  it('AC-29: a try is executed while a run of the skill is running', async () => {
    const host = await newHost();
    const skill = await newSkill();
    await db().insert(t.evalRuns).values({
      workspaceId,
      agentId: host.id,
      agentVersion: 1,
      skillId: skill.id,
      skillVersion: 1,
      status: 'running',
      provider: 'openai',
      model: 'gpt-4.1',
    });
    scripted.queue = [[finding(11)]];
    const res = await tryCase(skill.id, tryBody(host.id));
    expect(res.statusCode).toBe(200);
    expect((res.json() as Json).status).toBe('pass');
  });

  it('AC-9: a random uuid and an agent of another workspace are 400 eval_host_agent_missing before any model call', async () => {
    const skill = await newSkill();
    const [other] = await db().insert(t.workspaces).values({ name: `other-try-host-${seq++}` }).returning();
    const foreignHost = await insertEvalAgent(db(), other!.id);
    const before = scripted.calls.length;
    for (const hostId of [UNKNOWN_ID, foreignHost.id]) {
      const res = await tryCase(skill.id, tryBody(hostId));
      expect(res.statusCode).toBe(400);
      expect(codeOf(res)).toBe('eval_host_agent_missing');
    }
    expect(scripted.calls).toHaveLength(before);
  });

  it('AC-10: a provider without a key is 400 eval_provider_unavailable before any model call', async () => {
    const host = await newHost();
    const skill = await newSkill();
    const bare = await buildTestApp({ llm: undefined });
    try {
      const before = scripted.calls.length;
      const res = await tryCase(skill.id, tryBody(host.id), bare);
      expect(res.statusCode).toBe(400);
      expect(codeOf(res)).toBe('eval_provider_unavailable');
      expect(scripted.calls).toHaveLength(before);
    } finally {
      await bare.close();
    }
  });

  it('AC-7: a skill of another workspace and an unknown skill are 404 before any model call; no git or GitHub call', async () => {
    const [other] = await db().insert(t.workspaces).values({ name: `other-try-skill-${seq++}` }).returning();
    const foreign = await insertEvalSkill(db(), other!.id);
    const host = await newHost();
    const before = scripted.calls.length;
    const externalBefore = externalCalls();
    expect((await tryCase(foreign.id, tryBody(host.id))).statusCode).toBe(404);
    expect((await tryCase(UNKNOWN_ID, tryBody(host.id))).statusCode).toBe(404);
    expect((await tryCase('not-a-uuid', tryBody(host.id))).statusCode).toBe(422);
    expect(scripted.calls).toHaveLength(before);
    expect(externalCalls()).toBe(externalBefore);
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
    const route = seen.find((r) => r.url === '/skills/:id/eval-cases/try' && r.method === 'POST');
    expect(route?.config?.rateLimit).toEqual(EVAL_RUN_RATE_LIMIT);
    await bare.close();
  });

  it('NFR-13: a skill try logs one record with the skill id and version and none holds the body or the diff', async () => {
    const host = await newHost();
    const skill = await newSkill({ body: 'Confidential skill body marker.' });
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
    const result = await service.trySkillCase(workspaceId, skill.id, tryBody(host.id) as never);
    expect(result.status).toBe('pass');
    expect(records).toHaveLength(1);
    expect(records[0]!.msg).toBe('eval case tried');
    expect(records[0]!.obj).toMatchObject({
      agentId: host.id,
      agentVersion: 1,
      skillId: skill.id,
      skillVersion: 1,
      status: 'pass',
      matched: 1,
      findingsProduced: 1,
      findingsGrounded: 1,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.001,
    });
    const logged = JSON.stringify(records);
    for (const text of [
      'Confidential skill body marker.',
      'sk_live_xxx',
      'Secret finding title',
      'Add rate limiting',
      'Closes #471.',
    ]) {
      expect(logged).not.toContain(text);
    }
  });
});
