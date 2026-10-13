import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Finding, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { insertEvalAgent, insertEvalSkill, insertSkillRun, waitForEvalRun } from './helpers/eval.js';
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

const PATCH = CONFIG_PART.split('\n').slice(3).join('\n').trimEnd();
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
  gate: Promise<void> | null = null;
  onCall: ((index: number) => Promise<void>) | null = null;

  constructor() {
    super('openai');
  }

  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const index = this.structuredCalls.length;
    this.calls.push({ method: 'completeStructured', req });
    if (this.onCall) await this.onCall(index);
    if (this.gate) await this.gate;
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

  messages(index: number): { role: string; content: string }[] {
    return (this.structuredCalls[index]!.req as StructuredRequest<unknown>).messages as {
      role: string;
      content: string;
    }[];
  }

  text(index: number): string {
    return this.messages(index)
      .map((m) => m.content)
      .join('\n');
  }
}

d('eval skill runs (Testcontainers pg)', () => {
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

  const newHost = (over: Partial<typeof t.agents.$inferInsert> = {}) => insertEvalAgent(db(), workspaceId, over);
  const newSkill = (over: Partial<typeof t.skills.$inferInsert> = {}) => insertEvalSkill(db(), workspaceId, over);

  async function newCase(
    skillId: string,
    over: { type?: 'must_find' | 'must_not_flag'; line?: number; ownerWorkspace?: string } = {},
  ) {
    const n = seq++;
    const [row] = await db()
      .insert(t.evalCases)
      .values({
        workspaceId: over.ownerWorkspace ?? workspaceId,
        ownerKind: 'skill',
        ownerId: skillId,
        name: `skill-case-${n}`,
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
          pr_title: 'Add rate limiting',
          pr_author: 'marisa.koch',
          pr_body: 'Add rate limiting. Closes #471.',
        },
      })
      .returning();
    return row!;
  }

  const startRun = (skillId: string, hostId: string, target: App = app) =>
    target.inject({ method: 'POST', url: `/skills/${skillId}/eval-runs`, payload: { host_agent_id: hostId } });
  const listRuns = (skillId: string) =>
    app.inject({ method: 'GET', url: `/skills/${skillId}/eval-runs` });
  const codeOf = (res: { json(): unknown }) => (res.json() as { error: { code: string } }).error.code;
  const count = async (table: unknown) =>
    (await db().select().from(table as never)).length;
  const externalCalls = () =>
    git.cloned.length + git.syncs.length + git.readsAt.length + git.pullFetches.length +
    github.posted.length + github.openedPrs.length + github.committed.length + github.createdComments.length;

  async function runToEnd(skillId: string, hostId: string) {
    const res = await startRun(skillId, hostId);
    expect(res.statusCode).toBe(202);
    const started = res.json() as Json;
    const settled = await waitForEvalRun(app, started.id as string);
    return { started, settled };
  }

  async function foreignSkill() {
    const [other] = await db().insert(t.workspaces).values({ name: `other-skill-runs-${seq++}` }).returning();
    const skill = await insertEvalSkill(db(), other!.id);
    const host = await insertEvalAgent(db(), other!.id);
    await newCase(skill.id, { ownerWorkspace: other!.id });
    return { skill, host };
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

  it('AC-11, AC-12, AC-15, NFR-2: a disabled skill hosted by a disabled agent runs; one call per case holds only that skill block', async () => {
    const host = await newHost({ enabled: false, systemPrompt: 'You are a strict reviewer.' });
    const bystander = await newSkill({ name: `bystander-${seq++}`, body: 'Bystander rule body.' });
    await db().insert(t.agentSkills).values({ agentId: host.id, skillId: bystander.id, order: 0 });
    const skill = await newSkill({ enabled: false, body: 'Flag hardcoded secrets.' });
    const mustFind = await newCase(skill.id, { type: 'must_find' });
    const mustNot = await newCase(skill.id, { type: 'must_not_flag' });
    const before = scripted.structuredCalls.length;
    scripted.queue = [[finding(11)], [finding(11)]];

    const { started, settled } = await runToEnd(skill.id, host.id);

    expect(started).toMatchObject({
      status: 'running',
      agent_id: host.id,
      agent_version: 1,
      skill_id: skill.id,
      skill_version: 1,
      skills: [skill.name],
      provider: 'openai',
      model: 'gpt-4.1',
      cases_total: 2,
      case_ids: [mustFind.id, mustNot.id],
    });
    const [row] = await db().select().from(t.evalRuns).where(eq(t.evalRuns.id, started.id as string));
    expect(row).toMatchObject({ skillId: skill.id, skillVersion: 1, agentId: host.id, agentVersion: 1 });
    expect(row!.caseIds).toEqual([mustFind.id, mustNot.id]);

    expect(scripted.structuredCalls.length - before).toBe(2);
    const system = scripted.messages(before).find((m) => m.role === 'system')!.content;
    expect(system).toContain('You are a strict reviewer.');
    for (const index of [before, before + 1]) {
      const text = scripted.text(index);
      expect(text).toContain(`### Skill: ${skill.name} (rubric · manual)`);
      expect(text).toContain('Flag hardcoded secrets.');
      expect(text).not.toContain(`### Skill: ${bystander.name}`);
      expect(text).not.toContain('Bystander rule body.');
      expect(text).toContain('sk_live_xxx');
      expect(text).not.toContain(mustFind.name);
    }

    expect(settled).toMatchObject({
      status: 'done',
      cases_total: 2,
      cases_passed: 1,
      cases_failed: 1,
      recall: 1,
      precision: 0.5,
      skill_id: skill.id,
      skill_version: 1,
      error: null,
    });
    expect(settled.results).toHaveLength(2);
  });

  it('AC-12: a disabled skill linked to no agent runs the same way', async () => {
    const host = await newHost();
    const skill = await newSkill({ enabled: false, body: 'Unlinked disabled body.' });
    await newCase(skill.id);
    const before = scripted.structuredCalls.length;
    const { settled } = await runToEnd(skill.id, host.id);
    expect(settled.status).toBe('done');
    expect(scripted.text(before)).toContain('Unlinked disabled body.');
  });

  it('AC-9: a random uuid and an agent of another workspace are 400 eval_host_agent_missing, nothing stored, no model call', async () => {
    const skill = await newSkill();
    await newCase(skill.id);
    const other = await foreignSkill();
    const callsBefore = scripted.calls.length;
    const runsBefore = await count(t.evalRuns);

    for (const hostId of [UNKNOWN_ID, other.host.id]) {
      const res = await startRun(skill.id, hostId);
      expect(res.statusCode).toBe(400);
      expect(codeOf(res)).toBe('eval_host_agent_missing');
    }
    expect(await count(t.evalRuns)).toBe(runsBefore);
    expect(scripted.calls).toHaveLength(callsBefore);
  });

  it('AC-10: a provider without a key is eval_provider_unavailable and nothing is stored', async () => {
    const host = await newHost();
    const skill = await newSkill();
    await newCase(skill.id);
    const bare = await buildTestApp({ llm: undefined });
    try {
      const runsBefore = await count(t.evalRuns);
      const res = await startRun(skill.id, host.id, bare);
      expect(res.statusCode).toBe(400);
      expect(codeOf(res)).toBe('eval_provider_unavailable');
      expect(await count(t.evalRuns)).toBe(runsBefore);
    } finally {
      await bare.close();
    }
  });

  it('AC-16, NFR-14: a skill run writes no review, finding, agent run or trace and calls no git or GitHub', async () => {
    const host = await newHost();
    const skill = await newSkill();
    await newCase(skill.id);
    await newCase(skill.id, { type: 'must_not_flag' });
    const tables = [t.reviews, t.findings, t.agentRuns, t.runTraces];
    const rowsBefore = await Promise.all(tables.map((table) => count(table)));
    const externalBefore = externalCalls();
    scripted.queue = [[finding(11)], [finding(11)]];

    const { started } = await runToEnd(skill.id, host.id);
    await listRuns(skill.id);
    await app.inject({ method: 'GET', url: `/eval-runs/${started.id}` });
    await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-cases` });

    expect(await Promise.all(tables.map((table) => count(table)))).toEqual(rowsBefore);
    expect(externalCalls()).toBe(externalBefore);
  });

  it('AC-17: a skill without a case is eval_no_cases and stores no run', async () => {
    const host = await newHost();
    const skill = await newSkill();
    const runsBefore = await count(t.evalRuns);
    const res = await startRun(skill.id, host.id);
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('eval_no_cases');
    expect(await count(t.evalRuns)).toBe(runsBefore);
  });

  it('AC-18: a second start while one runs is refused with the id of the running run', async () => {
    const host = await newHost();
    const skill = await newSkill();
    await newCase(skill.id);
    let release!: () => void;
    scripted.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const first = await startRun(skill.id, host.id);
      expect(first.statusCode).toBe(202);
      const second = await startRun(skill.id, host.id);
      expect(second.statusCode).toBe(400);
      expect(codeOf(second)).toBe('eval_run_in_progress');
      expect((second.json() as { error: { details: Json } }).error.details).toEqual({
        run_id: (first.json() as Json).id,
      });
      const rows = await db().select().from(t.evalRuns).where(eq(t.evalRuns.skillId, skill.id));
      expect(rows.filter((r) => r.status === 'running')).toHaveLength(1);
      release();
      scripted.gate = null;
      expect((await waitForEvalRun(app, (first.json() as Json).id as string)).status).toBe('done');
    } finally {
      release();
      scripted.gate = null;
    }
  });

  it('AC-19: a skill run hosted by an agent does not block that agent own run', async () => {
    const host = await newHost();
    const other = await newSkill();
    await insertSkillRun(db(), { workspaceId, skillId: other.id, hostAgentId: host.id, status: 'running' });
    const [own] = await db()
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: host.id,
        name: `own-${seq++}`,
        expectationType: 'must_find',
        expectedOutput: { file: 'src/config.ts', start_line: 11, end_line: 11, severity: 'CRITICAL', category: 'security', title: 't' },
        inputDiff: CONFIG_PART,
        inputFiles: ['src/config.ts'],
        inputMeta: { pr_number: 1, pr_title: 'T', pr_author: 'a', pr_body: null },
      })
      .returning();
    const res = await app.inject({ method: 'POST', url: `/agents/${host.id}/eval-runs` });
    expect(res.statusCode).toBe(202);
    const settled = await waitForEvalRun(app, (res.json() as Json).id as string);
    expect(settled).toMatchObject({ status: 'done', skill_id: null, case_ids: [own!.id] });
  });

  it('AC-20: a running agent run of the host and a running run of a second skill do not block a skill run', async () => {
    const host = await newHost();
    const second = await newSkill();
    await db()
      .insert(t.evalRuns)
      .values({ workspaceId, agentId: host.id, agentVersion: 1, status: 'running', provider: 'openai', model: 'gpt-4.1' });
    await insertSkillRun(db(), { workspaceId, skillId: second.id, hostAgentId: host.id, status: 'running' });
    const skill = await newSkill();
    await newCase(skill.id);
    const { settled } = await runToEnd(skill.id, host.id);
    expect(settled).toMatchObject({ status: 'done', skill_id: skill.id });
  });

  it('AC-21: a case whose call throws becomes an error outcome and the others still run', async () => {
    const host = await newHost();
    const skill = await newSkill();
    await newCase(skill.id);
    const failing = await newCase(skill.id);
    await newCase(skill.id);
    const before = scripted.structuredCalls.length;
    scripted.queue = [[finding(11)], new Error('provider exploded'), [finding(11)]];

    const { settled } = await runToEnd(skill.id, host.id);

    expect(scripted.structuredCalls.length - before).toBe(3);
    expect(settled).toMatchObject({ status: 'done', cases_total: 3, cases_passed: 2, cases_errored: 1 });
    expect((settled.results as Json[])[1]).toMatchObject({
      case_id: failing.id,
      status: 'error',
      error: 'provider exploded',
      findings: [],
    });
  });

  it('AC-23: 21 stored skill runs list as the 20 newest, without results', async () => {
    const host = await newHost();
    const skill = await newSkill();
    const base = Date.now() - 100_000_000;
    for (let i = 0; i < 21; i += 1) {
      await insertSkillRun(db(), {
        workspaceId,
        skillId: skill.id,
        hostAgentId: host.id,
        status: 'done',
        skillVersion: i + 1,
        ranAt: new Date(base + i * 1000),
      });
    }
    const res = await listRuns(skill.id);
    expect(res.statusCode).toBe(200);
    const list = res.json() as Json[];
    expect(list).toHaveLength(20);
    expect(list[0]!.skill_version).toBe(21);
    expect(list[19]!.skill_version).toBe(2);
    for (const run of list) expect(run).not.toHaveProperty('results');
  });

  it('AC-24: a completed skill run reads back with its skill id, version and two outcomes', async () => {
    const host = await newHost();
    const skill = await newSkill();
    const a = await newCase(skill.id);
    const b = await newCase(skill.id);
    scripted.queue = [[finding(11)], []];
    const { started } = await runToEnd(skill.id, host.id);
    const res = await app.inject({ method: 'GET', url: `/eval-runs/${started.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Json;
    expect(body).toMatchObject({ status: 'done', skill_id: skill.id, skill_version: 1 });
    expect((body.results as Json[]).map((r) => r.case_id)).toEqual([a.id, b.id]);
  });

  it('AC-25: a body saved between two cases leaves both calls with the first body and the run at the earlier version', async () => {
    const host = await newHost();
    const skill = await newSkill({ body: 'FIRST body rule.' });
    await newCase(skill.id);
    await newCase(skill.id);
    const before = scripted.structuredCalls.length;
    scripted.onCall = async (index) => {
      if (index !== before) return;
      const res = await app.inject({
        method: 'PUT',
        url: `/skills/${skill.id}`,
        payload: { body: 'SECOND body rule.' },
      });
      expect(res.statusCode).toBe(200);
    };
    try {
      const { started, settled } = await runToEnd(skill.id, host.id);
      expect(scripted.structuredCalls.length - before).toBe(2);
      for (const index of [before, before + 1]) {
        expect(scripted.text(index)).toContain('FIRST body rule.');
        expect(scripted.text(index)).not.toContain('SECOND body rule.');
      }
      expect(started.skill_version).toBe(1);
      expect(settled.skill_version).toBe(1);
      const [live] = await db().select().from(t.skills).where(eq(t.skills.id, skill.id));
      expect(live!.version).toBe(2);
    } finally {
      scripted.onCall = null;
    }
  });

  it('AC-7: a skill of another workspace is 404 on both run routes before any write and any model call', async () => {
    const other = await foreignSkill();
    const own = await newHost();
    const runsBefore = await count(t.evalRuns);
    const callsBefore = scripted.calls.length;
    expect((await startRun(other.skill.id, own.id)).statusCode).toBe(404);
    expect((await startRun(other.skill.id, other.host.id)).statusCode).toBe(404);
    expect((await startRun(UNKNOWN_ID, own.id)).statusCode).toBe(404);
    expect((await listRuns(other.skill.id)).statusCode).toBe(404);
    expect(await count(t.evalRuns)).toBe(runsBefore);
    expect(scripted.calls).toHaveLength(callsBefore);
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
    const start = seen.find((r) => r.url === '/skills/:id/eval-runs' && r.method === 'POST');
    expect(start?.config?.rateLimit).toEqual(EVAL_RUN_RATE_LIMIT);
    await bare.close();
  });

  it('NFR-5: a disabled linked skill, evaluated, reaches no live review and no agent run', async () => {
    const host = await newHost();
    const skill = await newSkill({ enabled: false, body: 'Quarantined rule text.' });
    await db().insert(t.agentSkills).values({ agentId: host.id, skillId: skill.id, order: 0 });
    await newCase(skill.id);
    await runToEnd(skill.id, host.id);

    const [own] = await db()
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: host.id,
        name: `own-${seq++}`,
        expectationType: 'must_find',
        expectedOutput: { file: 'src/config.ts', start_line: 11, end_line: 11, severity: 'CRITICAL', category: 'security', title: 't' },
        inputDiff: CONFIG_PART,
        inputFiles: ['src/config.ts'],
        inputMeta: { pr_number: 1, pr_title: 'T', pr_author: 'a', pr_body: null },
      })
      .returning();
    const beforeAgentRun = scripted.structuredCalls.length;
    const agentRun = await app.inject({ method: 'POST', url: `/agents/${host.id}/eval-runs` });
    expect(agentRun.statusCode).toBe(202);
    await waitForEvalRun(app, (agentRun.json() as Json).id as string);
    expect(own).toBeDefined();
    expect(scripted.text(beforeAgentRun)).not.toContain('Quarantined rule text.');

    const name = `skill-runs-pr-${seq++}`;
    const [repo] = await db()
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db()
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 9,
        title: 'Add key',
        author: 'marisa.koch',
        branch: 'feat/k',
        base: 'main',
        headSha: 'deadbeef',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await db().insert(t.prFiles).values({ prId: pr!.id, path: 'src/config.ts', additions: 1, deletions: 0, patch: PATCH });
    const review = await app.inject({ method: 'POST', url: `/pulls/${pr!.id}/review`, payload: { agentId: host.id } });
    const runId: string = review.json().runs[0].run_id;
    await waitForPrRuns(db(), pr!.id, { expected: 1 });
    const deadline = Date.now() + 10_000;
    let trace: { prompt_assembly: { skills: string | null; user: string } } | undefined;
    while (!trace && Date.now() < deadline) {
      const res = await app.inject({ method: 'GET', url: `/runs/${runId}/trace` });
      if (res.statusCode === 200) trace = res.json();
      else await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(trace).toBeDefined();
    expect(trace!.prompt_assembly.skills ?? '').not.toContain('Quarantined rule text.');
    expect(trace!.prompt_assembly.user).not.toContain('Quarantined rule text.');
  });

  it('NFR-6: a non-uuid id or host_agent_id is 422; an oversized body starts nothing', async () => {
    const host = await newHost();
    const skill = await newSkill();
    await newCase(skill.id);
    const runsBefore = await count(t.evalRuns);
    const callsBefore = scripted.calls.length;

    expect((await startRun('not-a-uuid', host.id)).statusCode).toBe(422);
    expect((await startRun(skill.id, 'not-a-uuid')).statusCode).toBe(422);
    const noBody = await app.inject({ method: 'POST', url: `/skills/${skill.id}/eval-runs`, payload: {} });
    expect(noBody.statusCode).toBe(422);
    const huge = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/eval-runs`,
      payload: { host_agent_id: host.id, padding: 'x'.repeat(1_100_000) },
    });
    expect(huge.statusCode).toBe(413);
    expect(await count(t.evalRuns)).toBe(runsBefore);
    expect(scripted.calls).toHaveLength(callsBefore);
  });

  it('NFR-13: a skill run logs two records with the skill id and version and none holds the body or the diff', async () => {
    const host = await newHost();
    const skill = await newSkill({ body: 'Confidential skill body marker.' });
    const c = await newCase(skill.id);
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
    const run = await service.startSkillRun(workspaceId, skill.id, host.id);
    expect((await waitForEvalRun(app, run.id)).status).toBe('done');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(records).toHaveLength(2);
    expect(records.map((r) => r.msg)).toEqual(['eval run started', 'eval run settled']);
    for (const record of records) {
      expect(record.obj).toMatchObject({
        runId: run.id,
        agentId: host.id,
        agentVersion: 1,
        skillId: skill.id,
        skillVersion: 1,
      });
    }
    expect(records[1]!.obj).toMatchObject({ casesPassed: 1, recall: 1, tokensIn: 10, tokensOut: 5 });
    const logged = JSON.stringify(records);
    for (const text of ['Confidential skill body marker.', 'sk_live_xxx', 'Secret finding title', c.name, 'Add rate limiting']) {
      expect(logged).not.toContain(text);
    }
  });

  it('NFR-14: no git or GitHub call is recorded by a start, a list or a read', async () => {
    const host = await newHost();
    const skill = await newSkill();
    await newCase(skill.id);
    const before = externalCalls();
    const { started } = await runToEnd(skill.id, host.id);
    await listRuns(skill.id);
    await app.inject({ method: 'GET', url: `/eval-runs/${started.id}` });
    expect(externalCalls()).toBe(before);
  });
});
