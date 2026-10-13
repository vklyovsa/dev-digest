import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { insertEvalAgent, insertEvalSkill, insertSkillRun } from './helpers/eval.js';
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
import { EvalRepository } from '../src/modules/eval/repository.js';
import type { NewRun } from '../src/modules/eval/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

type App = Awaited<ReturnType<typeof buildApp>>;
type Json = Record<string, unknown>;

d('skill eval storage (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: App;
  let workspaceId: string;
  let seq = 0;

  const db = () => pg.handle.db;
  const store = () => new EvalRepository(db());

  function buildTestApp() {
    return buildApp({
      config: config(),
      db: db(),
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient(),
        secrets: new MockSecretsProvider({}),
        github: new MockGitHubClient(),
        llm: { openai: new MockLLMProvider('openai') },
      },
    });
  }

  const newRun = (agentId: string, skillId: string | null): NewRun => ({
    agentId,
    agentVersion: 1,
    skillId,
    skillVersion: skillId ? 1 : null,
    provider: 'openai',
    model: 'gpt-4.1',
    skills: [],
    caseIds: [],
    casesTotal: 0,
  });

  async function addAgentCase(agentId: string) {
    const [row] = await db()
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agentId,
        name: `case-${seq++}`,
        expectationType: 'must_find',
        expectedOutput: {
          file: 'src/a.ts',
          start_line: 11,
          end_line: 11,
          severity: 'CRITICAL',
          category: 'security',
          title: 'Expected',
        },
        inputDiff: 'diff --git a/src/a.ts b/src/a.ts\n',
        inputFiles: ['src/a.ts'],
        inputMeta: { pr_number: 1, pr_title: 't', pr_author: 'a', pr_body: null },
      })
      .returning();
    return row!;
  }

  beforeAll(async () => {
    pg = await startPg();
    await seed(db());
    const [ws] = await db().select().from(t.workspaces);
    workspaceId = ws!.id;
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('NFR-9, EC-25: rows in the pre-feature shape read back unchanged, with a null skill', async () => {
    const agent = await insertEvalAgent(db(), workspaceId);
    const kase = await addAgentCase(agent.id);
    const [run] = await db()
      .insert(t.evalRuns)
      .values({
        workspaceId,
        agentId: agent.id,
        agentVersion: 3,
        status: 'done',
        provider: 'openai',
        model: 'gpt-4.1',
        recall: 0.5,
        casesTotal: 1,
        casesPassed: 1,
        caseIds: [kase.id],
        results: [
          {
            case_id: kase.id,
            case_name: kase.name,
            expectation_type: 'must_find',
            status: 'pass',
            matched: 1,
            produced: 1,
            findings: [],
            error: null,
          },
        ],
      })
      .returning();

    const runs = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs` })).json() as Json[];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: run!.id, agent_version: 3, status: 'done', recall: 0.5, cases_total: 1 });

    const cases = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` })).json() as Json[];
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      id: kase.id,
      name: kase.name,
      last_result: { run_id: run!.id, status: 'pass', matched: 1 },
    });

    const one = (await app.inject({ method: 'GET', url: `/eval-runs/${run!.id}` })).json() as Json;
    expect(one).toMatchObject({ id: run!.id, agent_version: 3, status: 'done', recall: 0.5 });

    const stored = await store().getRun(workspaceId, run!.id);
    expect(stored).toMatchObject({ skillId: null, skillVersion: null });
  });

  it('AC-32: hosted skill runs do not leak into the host agent reads', async () => {
    const host = await insertEvalAgent(db(), workspaceId);
    const skill = await insertEvalSkill(db(), workspaceId);
    const kase = await addAgentCase(host.id);
    const ownRanAt = new Date(Date.now() - 3_600_000);
    const [own] = await db()
      .insert(t.evalRuns)
      .values({
        workspaceId,
        agentId: host.id,
        agentVersion: 1,
        status: 'done',
        provider: 'openai',
        model: 'gpt-4.1',
        ranAt: ownRanAt,
        recall: 0.25,
        caseIds: [kase.id],
        results: [
          {
            case_id: kase.id,
            case_name: kase.name,
            expectation_type: 'must_find',
            status: 'fail',
            matched: 0,
            produced: 0,
            findings: [],
            error: null,
          },
        ],
      })
      .returning();
    for (let i = 0; i < 20; i++) {
      await insertSkillRun(db(), {
        workspaceId,
        skillId: skill.id,
        hostAgentId: host.id,
        status: 'done',
        recall: 1,
        caseIds: [kase.id],
        results: [
          {
            case_id: kase.id,
            case_name: kase.name,
            expectation_type: 'must_find',
            status: 'pass',
            matched: 1,
            produced: 1,
            findings: [],
            error: null,
          },
        ],
        ranAt: new Date(Date.now() - i * 1000),
      });
    }
    await insertSkillRun(db(), { workspaceId, skillId: skill.id, hostAgentId: host.id, status: 'running' });

    const runs = (await app.inject({ method: 'GET', url: `/agents/${host.id}/eval-runs` })).json() as Json[];
    expect(runs.map((r) => r.id)).toEqual([own!.id]);

    const cases = (await app.inject({ method: 'GET', url: `/agents/${host.id}/eval-cases` })).json() as Json[];
    expect(cases[0]).toMatchObject({ last_result: { run_id: own!.id, status: 'fail', matched: 0 } });

    const dash = (await app.inject({ method: 'GET', url: '/eval/dashboard' })).json() as {
      agents: Json[];
      recent_runs: Json[];
    };
    const row = dash.agents.find((a) => a.agent_id === host.id)!;
    expect(row.latest_run).toMatchObject({ id: own!.id });
    expect(row.run_in_progress).toBe(false);
    expect(row.trend).toHaveLength(1);
    const recent = dash.recent_runs.filter((r) => r.agent_id === host.id);
    expect(recent.map((r) => r.id)).toEqual([own!.id]);

    const coverage = await store().listDoneRunsForAgent(workspaceId, host.id, 50);
    expect(coverage.map((c) => c.id)).toEqual([own!.id]);
    expect(await store().findRunningRun(workspaceId, host.id)).toBeUndefined();
    expect(await store().runningAgentIds(workspaceId)).not.toContain(host.id);
    expect(await store().listRunsForSkill(workspaceId, skill.id, 50)).toHaveLength(21);
    expect((await store().findRunningSkillRun(workspaceId, skill.id))?.agentId).toBe(host.id);
    expect(await store().listDoneRunsForSkill(workspaceId, skill.id, 50)).toHaveLength(20);
  });

  it('AC-22: a skill run left running is failed with "interrupted" when the API starts', async () => {
    const host = await insertEvalAgent(db(), workspaceId);
    const skill = await insertEvalSkill(db(), workspaceId);
    const stuck = await insertSkillRun(db(), {
      workspaceId,
      skillId: skill.id,
      hostAgentId: host.id,
      status: 'running',
    });
    const restarted = await buildTestApp();
    try {
      const [row] = await db().select().from(t.evalRuns).where(eq(t.evalRuns.id, stuck.id));
      expect(row).toMatchObject({ status: 'failed', error: 'interrupted' });
    } finally {
      await restarted.close();
    }
  });

  it('DR-3: one running run per skill and one per agent are independent', async () => {
    const host = await insertEvalAgent(db(), workspaceId);
    const s1 = await insertEvalSkill(db(), workspaceId);
    const s2 = await insertEvalSkill(db(), workspaceId);

    const own = await store().insertRunningRun(workspaceId, newRun(host.id, null));
    expect(own).not.toBeNull();

    const first = await store().insertRunningRun(workspaceId, newRun(host.id, s1.id));
    expect(first).toMatchObject({ skillId: s1.id, skillVersion: 1, agentId: host.id });
    expect(await store().insertRunningRun(workspaceId, newRun(host.id, s1.id))).toBeNull();

    const other = await store().insertRunningRun(workspaceId, newRun(host.id, s2.id));
    expect(other).not.toBeNull();

    expect(await store().insertRunningRun(workspaceId, newRun(host.id, null))).toBeNull();

    expect((await store().findRunningRun(workspaceId, host.id))?.id).toBe(own!.id);
    expect((await store().findRunningSkillRun(workspaceId, s1.id))?.id).toBe(first!.id);
  });
});
