import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { insertEvalAgent, insertEvalSkill, insertSkillRun } from './helpers/eval.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

type App = Awaited<ReturnType<typeof buildApp>>;
type Json = Record<string, unknown>;
type Outcome = NonNullable<typeof t.evalRuns.$inferInsert.results>[number];

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const outcome = (caseId: string, name: string, revision: number, status: 'pass' | 'fail'): Outcome => ({
  case_id: caseId,
  case_name: name,
  case_revision: revision,
  expectation_type: 'must_find',
  status,
  matched: status === 'pass' ? 1 : 0,
  produced: status === 'pass' ? 1 : 0,
  findings: [],
  error: null,
});

d('eval skill compare (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: App;
  let workspaceId: string;
  let llm: MockLLMProvider;
  let git: MockGitClient;
  let github: MockGitHubClient;
  let tick = 0;

  const db = () => pg.handle.db;
  const codeOf = (res: { json(): unknown }) => (res.json() as { error: { code: string } }).error.code;
  const compare = (skillId: string, base: string, head: string) =>
    app.inject({ method: 'GET', url: `/skills/${skillId}/eval-runs/compare?base=${base}&head=${head}` });

  async function doneRun(
    skillId: string,
    hostAgentId: string,
    skillVersion: number,
    results: Outcome[],
    over: Partial<Omit<typeof t.evalRuns.$inferInsert, 'skillId' | 'workspaceId'>> = {},
  ) {
    return insertSkillRun(db(), {
      workspaceId,
      skillId,
      hostAgentId,
      status: 'done',
      skillVersion,
      ranAt: new Date(Date.UTC(2026, 9, 1, 12, 0, tick++)),
      results,
      caseIds: results.map((r) => r.case_id),
      casesTotal: results.length,
      casesPassed: results.filter((r) => r.status === 'pass').length,
      ...over,
    });
  }

  beforeAll(async () => {
    pg = await startPg();
    await seed(db());
    const [ws] = await db().select().from(t.workspaces);
    workspaceId = ws!.id;
    llm = new MockLLMProvider('openai');
    git = new MockGitClient();
    github = new MockGitHubClient();
    app = await buildApp({
      config: config(),
      db: db(),
      overrides: {
        embedder: new MockEmbedder(),
        git,
        secrets: new MockSecretsProvider({}),
        github,
        llm: { openai: llm },
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('AC-30, AC-7, NFR-1: two versions return both bodies and the host fields; swapped ids give the same body; an edited case is left out; no provider call', async () => {
    const host = await insertEvalAgent(db(), workspaceId);
    const skill = await insertEvalSkill(db(), workspaceId, { body: 'Flag hardcoded secrets.' });
    const put = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { body: 'Flag hardcoded secrets and tokens.' },
    });
    expect(put.statusCode).toBe(200);

    const base = await doneRun(skill.id, host.id, 1, [
      outcome('c1', 'stable', 1, 'pass'),
      outcome('c2', 'edited', 1, 'fail'),
      outcome('c3', 'only base', 1, 'pass'),
    ]);
    const head = await doneRun(skill.id, host.id, 2, [
      outcome('c1', 'stable', 1, 'pass'),
      outcome('c2', 'edited', 2, 'pass'),
      outcome('c4', 'only head', 1, 'pass'),
    ]);

    const callsBefore = JSON.stringify([llm.calls, git, github]);
    const res = await compare(skill.id, base.id, head.id);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { base: Json; head: Json } & Record<string, unknown>;
    expect(body.base).toMatchObject({
      run_id: base.id,
      skill_version: 1,
      skill_body: 'Flag hardcoded secrets.',
      agent_id: host.id,
      agent_version: 1,
      provider: 'openai',
      model: 'gpt-4.1',
      cases_total: 1,
      cases_passed: 1,
    });
    expect(body.head).toMatchObject({
      run_id: head.id,
      skill_version: 2,
      skill_body: 'Flag hardcoded secrets and tokens.',
      agent_id: host.id,
    });
    expect(body.cases_edited).toEqual(['edited']);
    expect(body.cases_only_in_base).toEqual(['only base']);
    expect(body.cases_only_in_head).toEqual(['only head']);

    const swapped = await compare(skill.id, head.id, base.id);
    expect(swapped.statusCode).toBe(200);
    expect(swapped.json()).toEqual(body);
    expect(JSON.stringify([llm.calls, git, github])).toBe(callsBefore);
  });

  it('AC-31: a running run, a run of a second skill, an agent run and a removed snapshot are refused', async () => {
    const host = await insertEvalAgent(db(), workspaceId);
    const skill = await insertEvalSkill(db(), workspaceId);
    const other = await insertEvalSkill(db(), workspaceId);
    const ok = await doneRun(skill.id, host.id, 1, [outcome('c1', 'a', 1, 'pass')]);
    const okToo = await doneRun(skill.id, host.id, 1, [outcome('c1', 'a', 1, 'pass')]);

    const running = await insertSkillRun(db(), {
      workspaceId,
      skillId: skill.id,
      hostAgentId: host.id,
      status: 'running',
    });
    const ofOther = await doneRun(other.id, host.id, 1, [outcome('c1', 'a', 1, 'pass')]);
    const [agentRun] = await db()
      .insert(t.evalRuns)
      .values({
        workspaceId,
        agentId: host.id,
        agentVersion: 1,
        status: 'done',
        provider: 'openai',
        model: 'gpt-4.1',
        results: [outcome('c1', 'a', 1, 'pass')],
      })
      .returning();

    for (const bad of [running.id, ofOther.id, agentRun!.id, UNKNOWN_ID]) {
      const res = await compare(skill.id, ok.id, bad);
      expect(res.statusCode).toBe(400);
      expect(codeOf(res)).toBe('eval_runs_not_comparable');
    }

    const orphan = await doneRun(skill.id, host.id, 7, [outcome('c1', 'a', 1, 'pass')]);
    const noSnapshot = await compare(skill.id, ok.id, orphan.id);
    expect(noSnapshot.statusCode).toBe(400);
    expect(codeOf(noSnapshot)).toBe('eval_runs_not_comparable');

    await db()
      .delete(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skill.id), eq(t.skillVersions.version, 1)));
    const removed = await compare(skill.id, ok.id, okToo.id);
    expect(removed.statusCode).toBe(400);
    expect(codeOf(removed)).toBe('eval_runs_not_comparable');

    expect((await compare(UNKNOWN_ID, ok.id, okToo.id)).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-runs/compare?base=x&head=y` })).statusCode).toBe(422);
  });

  it('AC-33: an agent run compared with a hosted skill run on the agent route is refused', async () => {
    const host = await insertEvalAgent(db(), workspaceId);
    const skill = await insertEvalSkill(db(), workspaceId);
    const skillRun = await doneRun(skill.id, host.id, 1, [outcome('c1', 'a', 1, 'pass')]);
    const [agentRun] = await db()
      .insert(t.evalRuns)
      .values({
        workspaceId,
        agentId: host.id,
        agentVersion: 1,
        status: 'done',
        provider: 'openai',
        model: 'gpt-4.1',
        results: [outcome('c1', 'a', 1, 'pass')],
      })
      .returning();
    const res = await app.inject({
      method: 'GET',
      url: `/agents/${host.id}/eval-runs/compare?base=${agentRun!.id}&head=${skillRun.id}`,
    });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('eval_runs_not_comparable');
  });
});
