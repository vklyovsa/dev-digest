import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import {
  insertEvalAgent,
  insertEvalSkill,
  insertSkillRun,
  manualCaseBody,
  MANUAL_DIFF_TWO_GIT_FILES,
  SilentEvalLLM,
} from './helpers/eval.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { EvalService } from '../src/modules/eval/service.js';
import { EvalRepository } from '../src/modules/eval/repository.js';
import type { EvalStore } from '../src/modules/eval/types.js';
import {
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

type App = Awaited<ReturnType<typeof buildApp>>;
type Json = Record<string, unknown>;

const INJECTION_PATH = "'; drop table eval_cases; --";
const INJECTION_DIFF = `--- a/${INJECTION_PATH}
+++ b/${INJECTION_PATH}
@@ -1,2 +1,3 @@
 const a = 1;
+const a2 = 2;
 export { a };
`;

d('eval skill cases (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: App;
  let workspaceId: string;
  let hostId: string;
  const llm = new SilentEvalLLM();
  const git = new MockGitClient({ diff: MANUAL_DIFF_TWO_GIT_FILES });
  const github = new MockGitHubClient();

  const db = () => pg.handle.db;
  const codeOf = (res: { json(): unknown }) => (res.json() as { error: { code: string } }).error.code;
  const expectation = (over: Record<string, unknown> = {}) => ({
    ...(manualCaseBody().expected_output as Json),
    ...over,
  });
  const newSkill = async () => (await insertEvalSkill(db(), workspaceId)).id;
  const create = (skillId: string, over: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: `/skills/${skillId}/eval-cases`, payload: manualCaseBody(over) });
  const newCase = async (skillId: string, over: Record<string, unknown> = {}): Promise<Json> => {
    const res = await create(skillId, over);
    expect(res.statusCode).toBe(201);
    return res.json() as Json;
  };
  const list = async (skillId: string) =>
    (await app.inject({ method: 'GET', url: `/skills/${skillId}/eval-cases` })).json() as Json[];
  const update = (caseId: string, over: Record<string, unknown> = {}) => {
    const { expectation_type: _fixed, ...body } = manualCaseBody(over);
    return app.inject({ method: 'PUT', url: `/eval-cases/${caseId}`, payload: body });
  };
  const countCases = async () => (await db().select().from(t.evalCases)).length;
  const modelCalls = () => llm.calls.length +
    git.cloned.length + git.syncs.length + git.readsAt.length + git.pullFetches.length +
    github.posted.length + github.openedPrs.length + github.committed.length + github.createdComments.length;
  const outcome = (c: Json, status: 'pass' | 'fail') => ({
    case_id: c.id,
    case_name: c.name,
    case_revision: c.revision,
    expectation_type: 'must_find',
    status,
    matched: status === 'pass' ? 1 : 0,
    findings: [],
    error: null,
    produced: 0,
  });

  beforeAll(async () => {
    pg = await startPg();
    await seed(db());
    const [ws] = await db().select().from(t.workspaces);
    workspaceId = ws!.id;
    app = await buildApp({
      config: config(),
      db: db(),
      overrides: {
        embedder: new MockEmbedder(),
        git,
        secrets: new MockSecretsProvider({}),
        github,
        llm: { openai: llm, anthropic: llm },
      },
    });
    hostId = (await insertEvalAgent(db(), workspaceId)).id;
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('AC-1: the list carries the last result of a case a completed skill run covers, null for a case never run', async () => {
    const skillId = await newSkill();
    const covered = await newCase(skillId, { name: 'covered' });
    const fresh = await newCase(skillId, { name: 'fresh' });
    const run = await insertSkillRun(db(), {
      workspaceId,
      skillId,
      hostAgentId: hostId,
      status: 'done',
      caseIds: [covered.id as string],
      results: [outcome(covered, 'pass')] as never,
    });

    const rows = await list(skillId);
    expect(rows).toHaveLength(2);
    expect(rows.find((c) => c.id === covered.id)!.last_result).toMatchObject({ run_id: run.id, status: 'pass' });
    expect(rows.find((c) => c.id === fresh.id)!.last_result).toBeNull();
  });

  it('AC-2: the new row is skill-owned with null pull request values', async () => {
    const skillId = await newSkill();
    const res = await create(skillId);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      owner_kind: 'skill',
      owner_id: skillId,
      source_finding_id: null,
      revision: 1,
      last_result: null,
      input_meta: { pr_number: null, pr_author: null },
    });
    const [row] = await db().select().from(t.evalCases).where(eq(t.evalCases.ownerId, skillId));
    expect(row!.ownerKind).toBe('skill');
  });

  it('AC-3: a blank name, prose as the diff and lines outside every hunk store nothing', async () => {
    const skillId = await newSkill();
    const before = await countCases();

    const blank = await create(skillId, { name: '  ' });
    expect(blank.statusCode).toBe(422);
    const prose = await create(skillId, { input_diff: 'Not a diff at all.' });
    expect(prose.statusCode).toBe(400);
    expect(codeOf(prose)).toBe('eval_diff_invalid');
    const outside = await create(skillId, { expected_output: expectation({ start_line: 40, end_line: 41 }) });
    expect(outside.statusCode).toBe(400);
    expect(codeOf(outside)).toBe('expectation_outside_diff');

    expect(await countCases()).toBe(before);
  });

  it('AC-4: a rename keeps revision and the last result; a changed end line bumps the revision and clears it', async () => {
    const skillId = await newSkill();
    const created = await newCase(skillId);
    const run = await insertSkillRun(db(), {
      workspaceId,
      skillId,
      hostAgentId: hostId,
      status: 'done',
      caseIds: [created.id as string],
      results: [outcome(created, 'pass')] as never,
    });

    const renamed = await update(created.id as string, { name: 'renamed' });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ revision: 1, last_result: { run_id: run.id } });

    const moved = await update(created.id as string, {
      name: 'renamed',
      expected_output: expectation({ end_line: 12 }),
    });
    expect(moved.json()).toMatchObject({ revision: 2, last_result: null });
  });

  it('AC-5: a running skill run refuses the update; a running run of the host agent does not', async () => {
    const skillId = await newSkill();
    const created = await newCase(skillId);

    const [hostRun] = await db()
      .insert(t.evalRuns)
      .values({ workspaceId, agentId: hostId, agentVersion: 1, status: 'running', provider: 'openai', model: 'm' })
      .returning();
    expect((await update(created.id as string, { name: 'host-running' })).statusCode).toBe(200);
    await db().update(t.evalRuns).set({ status: 'failed', error: 'x' }).where(eq(t.evalRuns.id, hostRun!.id));

    const running = await insertSkillRun(db(), { workspaceId, skillId, hostAgentId: hostId, status: 'running' });
    const before = (await list(skillId))[0];
    const res = await update(created.id as string, { name: 'blocked' });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('eval_run_in_progress');
    const body = res.json() as { error: { message: string; details: Json } };
    expect(body.error.message).toBe('An eval run of this skill is already in progress');
    expect(body.error.details).toEqual({ run_id: running.id });
    expect((await list(skillId))[0]).toEqual(before);
  });

  it('AC-6: a deleted case is gone and the completed skill run still holds its outcome', async () => {
    const skillId = await newSkill();
    const created = await newCase(skillId);
    const run = await insertSkillRun(db(), {
      workspaceId,
      skillId,
      hostAgentId: hostId,
      status: 'done',
      caseIds: [created.id as string],
      results: [outcome(created, 'pass')] as never,
    });

    const del = await app.inject({ method: 'DELETE', url: `/eval-cases/${created.id}` });
    expect(del.statusCode).toBe(200);
    expect(await list(skillId)).toEqual([]);
    const [stored] = await db().select().from(t.evalRuns).where(eq(t.evalRuns.id, run.id));
    expect((stored!.results as Json[])[0]).toMatchObject({ case_id: created.id, status: 'pass' });
  });

  it('AC-7: a skill of another workspace answers 404 on both routes and changes nothing', async () => {
    const [other] = await db().insert(t.workspaces).values({ name: 'other-skill-cases' }).returning();
    const foreign = await insertEvalSkill(db(), other!.id);
    const before = await countCases();

    expect((await create(foreign.id)).statusCode).toBe(404);
    const read = await app.inject({ method: 'GET', url: `/skills/${foreign.id}/eval-cases` });
    expect(read.statusCode).toBe(404);
    expect((await create('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect(await countCases()).toBe(before);
  });

  it('AC-8: an agent and a skill with one case each list their own', async () => {
    const skillId = await newSkill();
    const agentId = (await insertEvalAgent(db(), workspaceId)).id;
    const skillCase = await newCase(skillId, { name: 'skill-own' });
    const agentRes = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-cases`,
      payload: manualCaseBody({ name: 'agent-own' }),
    });
    expect(agentRes.statusCode).toBe(201);

    const skillRows = await list(skillId);
    expect(skillRows.map((c) => c.id)).toEqual([skillCase.id]);
    const agentRows = (await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-cases` })).json() as Json[];
    expect(agentRows.map((c) => c.name)).toEqual(['agent-own']);
  });

  it('NFR-6: a non-uuid id answers 422, an oversized body stores nothing, an injection path is data', async () => {
    const skillId = await newSkill();
    expect((await create('not-a-uuid')).statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: '/skills/not-a-uuid/eval-cases' })).statusCode).toBe(422);

    const before = await countCases();
    const huge = `${MANUAL_DIFF_TWO_GIT_FILES}${' '.repeat(1_100_000)}`;
    const res = await create(skillId, { input_diff: huge });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(await countCases()).toBe(before);

    const stored = await create(skillId, {
      input_diff: INJECTION_DIFF,
      expected_output: expectation({ file: INJECTION_PATH, start_line: 2, end_line: 2 }),
    });
    expect(stored.statusCode).toBe(201);
    const read = (await list(skillId)).find((c) => c.id === (stored.json() as Json).id)!;
    expect((read.expected_output as Json).file).toBe(INJECTION_PATH);
  });

  it('NFR-14, NFR-1: the list costs the same repository calls for 1 case and for 5; no model, git or GitHub call', async () => {
    let calls: string[] = [];
    const store = new Proxy(new EvalRepository(db()), {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          calls.push(String(prop));
          return value.apply(target, args);
        };
      },
    }) as EvalStore;
    const skillsReader = app.container.skillsRepo;
    const service = new EvalService({
      store,
      agents: app.container.agentsRepo,
      skills: skillsReader,
      findings: app.container.reviewService,
      llm: async () => llm,
      log: app.log,
    });

    const skillId = await newSkill();
    await newCase(skillId, { name: 'one' });
    const countCalls = async () => {
      calls = [];
      await service.listSkillCases(workspaceId, skillId);
      return calls.length;
    };
    const one = await countCalls();
    for (let i = 0; i < 4; i++) await newCase(skillId, { name: `more-${i}` });
    expect((await list(skillId)).length).toBe(5);
    const five = await countCalls();

    expect(five).toBe(one);
    expect(calls.sort()).toEqual(['listCasesForSkill', 'listDoneRunsForSkill']);
    expect(modelCalls()).toBe(0);
  });
});
