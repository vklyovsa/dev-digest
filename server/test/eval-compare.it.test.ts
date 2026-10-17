import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Finding, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { insertEvalAgent, waitForEvalRun } from './helpers/eval.js';
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
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { expectationInsideDiff } from '../src/modules/eval/helpers.js';
import {
  EVAL_FIXTURE_CASES,
  agentNameFromArgs,
  insertEvalFixtures,
  runEvalFixtures,
} from '../src/db/eval-fixtures.js';

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

const finding = (line: number): Finding => ({
  id: `f-${line}`,
  severity: 'WARNING',
  category: 'security',
  title: 'Hardcoded Stripe secret key',
  file: 'src/config.ts',
  start_line: line,
  end_line: line,
  rationale: 'A live key is committed.',
  confidence: 0.9,
  kind: 'finding',
});

/** Answers each structured call from a queue; an empty queue answers "no findings". */
class ScriptedLLM extends MockLLMProvider {
  queue: Finding[][] = [];
  gate: Promise<void> | null = null;

  constructor() {
    super('openai');
  }

  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
    if (this.gate) await this.gate;
    const findings = this.queue.shift() ?? [];
    return {
      data: { verdict: 'comment', summary: 'ok', score: 90, findings } as T,
      model: req.model,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.001,
      raw: '{}',
      attempts: 1,
    };
  }
}

d('eval compare, dashboard and fixtures (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: App;
  let workspaceId: string;
  let scripted: ScriptedLLM;
  let git: MockGitClient;
  let github: MockGitHubClient;
  let seq = 0;

  const db = () => pg.handle.db;
  const codeOf = (res: { json(): unknown }) => (res.json() as { error: { code: string } }).error.code;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const count = async (table: any) => (await db().select().from(table)).length;

  async function newAgent(prompt = 'You are a reviewer.') {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: `Compare agent ${seq++}`,
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: prompt,
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; name: string };
  }

  async function newCase(agentId: string, type: 'must_find' | 'must_not_flag', ws = workspaceId) {
    const n = seq++;
    const [row] = await db()
      .insert(t.evalCases)
      .values({
        workspaceId: ws,
        ownerKind: 'agent',
        ownerId: agentId,
        name: `compare-case-${n}`,
        expectationType: type,
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
        inputMeta: { pr_number: 1, pr_title: 'Add key', pr_author: 'a', pr_body: null },
      })
      .returning();
    return row!;
  }

  async function runToEnd(agentId: string): Promise<Json> {
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    expect(res.statusCode).toBe(202);
    const settled = await waitForEvalRun(app, (res.json() as Json).id as string);
    expect(settled.status).toBe('done');
    return settled;
  }

  const compare = (agentId: string, base: string, head: string) =>
    app.inject({ method: 'GET', url: `/agents/${agentId}/eval-runs/compare?base=${base}&head=${head}` });

  beforeAll(async () => {
    pg = await startPg();
    await seed(db());
    const [ws] = await db().select().from(t.workspaces);
    workspaceId = ws!.id;
    scripted = new ScriptedLLM();
    git = new MockGitClient({ diff: CONFIG_PART });
    github = new MockGitHubClient();
    app = await buildApp({
      config: config(),
      db: db(),
      overrides: {
        embedder: new MockEmbedder(),
        git,
        secrets: new MockSecretsProvider({}),
        github,
        llm: { openai: scripted },
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('AC-79, AC-80, AC-70, NFR-13: two versions, two prompts, a lower precision; swapped ids give the same body; no git call', async () => {
    const agent = await newAgent('You are a reviewer.');
    await newCase(agent.id, 'must_find');
    await newCase(agent.id, 'must_not_flag');

    scripted.queue = [[finding(11)], []];
    const first = await runToEnd(agent.id);
    const put = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}`,
      payload: { system_prompt: 'You are a stricter reviewer.' },
    });
    expect(put.statusCode).toBe(200);
    scripted.queue = [[finding(11)], [finding(11)]];
    const second = await runToEnd(agent.id);

    const touched = () => JSON.stringify([git, github]);
    const before = touched();
    const res = await compare(agent.id, first.id as string, second.id as string);
    expect(res.statusCode).toBe(200);
    expect(touched()).toBe(before);

    const body = res.json() as { base: Json; head: Json; cases_only_in_base: string[]; cases_only_in_head: string[] };
    expect(body.base).toMatchObject({
      run_id: first.id,
      agent_version: 1,
      system_prompt: 'You are a reviewer.',
      provider: 'openai',
      model: 'gpt-4.1',
      recall: 1,
      precision: 1,
      cases_total: 2,
      cases_passed: 2,
    });
    expect(body.head).toMatchObject({
      run_id: second.id,
      agent_version: 2,
      system_prompt: 'You are a stricter reviewer.',
      recall: 1,
      precision: 0.5,
      cases_total: 2,
      cases_passed: 1,
    });
    expect(body.cases_only_in_base).toEqual([]);
    expect(body.cases_only_in_head).toEqual([]);

    const swapped = await compare(agent.id, second.id as string, first.id as string);
    expect(swapped.statusCode).toBe(200);
    expect(swapped.json()).toEqual(body);
  });

  it('AC-71: a running run, a run of another agent and a missing run are not comparable', async () => {
    const agent = await newAgent();
    await newCase(agent.id, 'must_find');
    const done = await runToEnd(agent.id);

    let release!: () => void;
    scripted.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(started.statusCode).toBe(202);
    const runningId = (started.json() as Json).id as string;

    const withRunning = await compare(agent.id, done.id as string, runningId);
    expect(withRunning.statusCode).toBe(400);
    expect(codeOf(withRunning)).toBe('eval_runs_not_comparable');

    release();
    scripted.gate = null;
    await waitForEvalRun(app, runningId);

    const other = await newAgent();
    await newCase(other.id, 'must_find');
    const otherRun = await runToEnd(other.id);
    const foreign = await compare(agent.id, done.id as string, otherRun.id as string);
    expect(foreign.statusCode).toBe(400);
    expect(codeOf(foreign)).toBe('eval_runs_not_comparable');

    const missing = await compare(agent.id, done.id as string, '00000000-0000-4000-8000-000000000000');
    expect(missing.statusCode).toBe(400);
    expect(codeOf(missing)).toBe('eval_runs_not_comparable');
  });

  it('AC-72: a case added between the runs is scored by neither side and named on the head', async () => {
    const agent = await newAgent();
    await newCase(agent.id, 'must_find');
    scripted.queue = [[finding(11)]];
    const first = await runToEnd(agent.id);
    const added = await newCase(agent.id, 'must_not_flag');
    scripted.queue = [[finding(11)], []];
    const second = await runToEnd(agent.id);

    const res = await compare(agent.id, first.id as string, second.id as string);
    const body = res.json() as { base: Json; head: Json; cases_only_in_base: string[]; cases_only_in_head: string[] };
    expect(body.base).toMatchObject({ cases_total: 1, cases_passed: 1 });
    expect(body.head).toMatchObject({ cases_total: 1, cases_passed: 1 });
    expect(body.cases_only_in_head).toEqual([added.name]);
    expect(body.cases_only_in_base).toEqual([]);
  });

  it('a run of a version without a stored snapshot is not comparable', async () => {
    const agent = await insertEvalAgent(db(), workspaceId);
    await newCase(agent.id, 'must_find');
    const first = await runToEnd(agent.id);
    const second = await runToEnd(agent.id);
    const res = await compare(agent.id, first.id as string, second.id as string);
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('eval_runs_not_comparable');
  });

  it('AC-44: compare refuses a query that is not a uuid, an unknown agent and another workspace', async () => {
    const agent = await newAgent();
    const bad = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/eval-runs/compare?base=abc&head=def`,
    });
    expect(bad.statusCode).toBe(422);
    const noQuery = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs/compare` });
    expect(noQuery.statusCode).toBe(422);

    const unknown = await compare(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    );
    expect(unknown.statusCode).toBe(404);

    const [otherWs] = await db().insert(t.workspaces).values({ name: `other-${seq++}` }).returning();
    const foreignAgent = await insertEvalAgent(db(), otherWs!.id);
    const foreign = await compare(
      foreignAgent.id,
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    );
    expect(foreign.statusCode).toBe(404);
  });

  it('AC-82, NFR-13: the dashboard lists every agent with its latest done run and the six newest runs', async () => {
    const withRuns = await newAgent();
    const another = await newAgent();
    const without = await newAgent();
    await newCase(withRuns.id, 'must_find');
    await newCase(another.id, 'must_find');

    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      ids.push((await runToEnd(withRuns.id)).id as string);
      ids.push((await runToEnd(another.id)).id as string);
    }

    const before = JSON.stringify([git, github]);
    const res = await app.inject({ method: 'GET', url: '/eval/dashboard' });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify([git, github])).toBe(before);

    const body = res.json() as {
      agents: { agent_id: string; name: string; model: string; latest_run: Json | null }[];
      recent_runs: Json[];
    };
    const row = (id: string) => body.agents.find((agent) => agent.agent_id === id)!;
    expect(row(without.id)).toMatchObject({ name: without.name, model: 'gpt-4.1', latest_run: null });
    expect(row(withRuns.id).latest_run).toMatchObject({ id: ids[6] });
    expect(row(another.id).latest_run).toMatchObject({ id: ids[7] });

    expect(body.recent_runs).toHaveLength(6);
    expect(body.recent_runs.map((run) => run.id)).toEqual(ids.slice(2).reverse());
    expect(body.recent_runs[0]).toMatchObject({ agent_name: another.name });
  });

  it('AC-94: the fixture command is additive, idempotent and touches no other row', async () => {
    const agent = await newAgent();
    const bystander = await newAgent();
    await newCase(bystander.id, 'must_find');

    expect(agentNameFromArgs([])).toBeNull();
    expect(agentNameFromArgs(['--agent'])).toBeNull();
    expect(agentNameFromArgs(['--agent', agent.name])).toBe(agent.name);
    expect(EVAL_FIXTURE_CASES.filter((c) => c.expectationType === 'must_find').length).toBeGreaterThan(0);
    expect(EVAL_FIXTURE_CASES.filter((c) => c.expectationType === 'must_not_flag').length).toBeGreaterThanOrEqual(3);
    for (const fixture of EVAL_FIXTURE_CASES) {
      expect(
        expectationInsideDiff(parseUnifiedDiff(fixture.inputDiff), {
          file: fixture.expectedOutput.file,
          startLine: fixture.expectedOutput.start_line,
          endLine: fixture.expectedOutput.end_line,
        }),
      ).toBe(true);
    }

    const tables = [t.agents, t.findings, t.reviews, t.evalRuns];
    const countsOf = () => Promise.all(tables.map((table) => count(table)));
    const rowsBefore = await countsOf();
    const casesBefore = await count(t.evalCases);

    expect(await runEvalFixtures(db(), 'No such agent')).toBeNull();
    expect(await count(t.evalCases)).toBe(casesBefore);

    expect(await runEvalFixtures(db(), agent.name)).toBe(EVAL_FIXTURE_CASES.length);
    expect(await count(t.evalCases)).toBe(casesBefore + EVAL_FIXTURE_CASES.length);
    const snapshot = JSON.stringify(
      (await db().select().from(t.evalCases)).sort((a, b) => a.id.localeCompare(b.id)),
    );

    expect(await insertEvalFixtures(db(), workspaceId, agent.id)).toBe(0);
    expect(
      JSON.stringify((await db().select().from(t.evalCases)).sort((a, b) => a.id.localeCompare(b.id))),
    ).toBe(snapshot);
    expect(await countsOf()).toEqual(rowsBefore);
  });
});
