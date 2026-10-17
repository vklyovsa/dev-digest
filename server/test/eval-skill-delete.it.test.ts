import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
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

const EXPECTED = {
  file: 'src/config.ts',
  start_line: 11,
  end_line: 11,
  severity: 'CRITICAL' as const,
  category: 'security',
  title: 'Hardcoded key',
};

d('eval skill and host agent delete (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: App;
  let workspaceId: string;
  let seq = 0;

  const db = () => pg.handle.db;

  async function newCase(ownerKind: 'agent' | 'skill', ownerId: string, ws = workspaceId) {
    const [row] = await db()
      .insert(t.evalCases)
      .values({
        workspaceId: ws,
        ownerKind,
        ownerId,
        name: `delete-case-${seq++}`,
        expectationType: 'must_find',
        expectedOutput: EXPECTED,
        inputDiff: 'diff --git a/src/config.ts b/src/config.ts\n',
        inputFiles: ['src/config.ts'],
        inputMeta: { pr_number: 1, pr_title: 'Add key', pr_author: 'a', pr_body: null },
      })
      .returning();
    return row!;
  }

  const casesOf = (ownerId: string) =>
    db().select().from(t.evalCases).where(eq(t.evalCases.ownerId, ownerId));
  const runsOf = (agentId: string) =>
    db().select().from(t.evalRuns).where(eq(t.evalRuns.agentId, agentId));

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
        git: new MockGitClient(),
        secrets: new MockSecretsProvider({}),
        github: new MockGitHubClient(),
        llm: { openai: new MockLLMProvider('openai') },
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('AC-34: deleting a skill removes its cases and runs and leaves an agent\'s rows identical', async () => {
    const host = await insertEvalAgent(db(), workspaceId);
    const skill = await insertEvalSkill(db(), workspaceId);
    await newCase('skill', skill.id);
    await newCase('skill', skill.id);
    await insertSkillRun(db(), { workspaceId, skillId: skill.id, hostAgentId: host.id, status: 'done' });

    const agent = await insertEvalAgent(db(), workspaceId);
    await newCase('agent', agent.id);
    await db().insert(t.evalRuns).values({
      workspaceId,
      agentId: agent.id,
      agentVersion: 1,
      status: 'done',
      provider: 'openai',
      model: 'gpt-4.1',
    });
    const agentCasesBefore = await casesOf(agent.id);
    const agentRunsBefore = await runsOf(agent.id);
    expect(agentCasesBefore).toHaveLength(1);
    expect(agentRunsBefore).toHaveLength(1);

    const res = await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
    expect(res.statusCode).toBe(200);

    expect(await casesOf(skill.id)).toEqual([]);
    expect(await db().select().from(t.evalRuns).where(eq(t.evalRuns.skillId, skill.id))).toEqual([]);
    expect(await db().select().from(t.skills).where(eq(t.skills.id, skill.id))).toEqual([]);
    expect(await casesOf(agent.id)).toEqual(agentCasesBefore);
    expect(await runsOf(agent.id)).toEqual(agentRunsBefore);
    expect(await runsOf(host.id)).toEqual([]);
  });

  it('EC-32: a running run of the deleted skill is gone, and a later completeRun stores nothing', async () => {
    const host = await insertEvalAgent(db(), workspaceId);
    const skill = await insertEvalSkill(db(), workspaceId);
    await newCase('skill', skill.id);
    const running = await insertSkillRun(db(), {
      workspaceId,
      skillId: skill.id,
      hostAgentId: host.id,
      status: 'running',
    });

    expect((await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` })).statusCode).toBe(200);
    expect(await db().select().from(t.evalRuns).where(eq(t.evalRuns.id, running.id))).toEqual([]);

    await app.container.evalRepo.completeRun(running.id, {
      status: 'done',
      error: null,
      recall: 1,
      precision: 1,
      citationAccuracy: 1,
      casesTotal: 1,
      casesPassed: 1,
      casesFailed: 0,
      casesErrored: 0,
      findingsTotal: 0,
      findingsGrounded: 0,
      durationMs: 1,
      costUsd: 0,
      results: [],
    });
    expect(await db().select().from(t.evalRuns).where(eq(t.evalRuns.id, running.id))).toEqual([]);
  });

  it('AC-35: after the host agent is deleted the skill keeps its case with last_result null and an empty run list', async () => {
    const host = await insertEvalAgent(db(), workspaceId);
    const skill = await insertEvalSkill(db(), workspaceId);
    await newCase('skill', skill.id);
    await insertSkillRun(db(), { workspaceId, skillId: skill.id, hostAgentId: host.id, status: 'done' });

    const res = await app.inject({ method: 'DELETE', url: `/agents/${host.id}` });
    expect(res.statusCode).toBe(200);

    const cases = await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-cases` });
    expect(cases.statusCode).toBe(200);
    const list = cases.json() as { last_result: unknown }[];
    expect(list).toHaveLength(1);
    expect(list[0]!.last_result).toBeNull();
    const runs = await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-runs` });
    expect(runs.json()).toEqual([]);
  });

  it('a skill of another workspace is not deleted', async () => {
    const [other] = await db().insert(t.workspaces).values({ name: 'other-skill-delete' }).returning();
    const foreign = await insertEvalSkill(db(), other!.id);
    await newCase('skill', foreign.id, other!.id);

    const res = await app.inject({ method: 'DELETE', url: `/skills/${foreign.id}` });
    expect(res.statusCode).toBe(404);
    expect(await db().select().from(t.skills).where(eq(t.skills.id, foreign.id))).toHaveLength(1);
    expect(await casesOf(foreign.id)).toHaveLength(1);
  });
});
