import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { insertEvalAgent } from './helpers/eval.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { EvalRepository } from '../src/modules/eval/repository.js';
import { EvalService } from '../src/modules/eval/service.js';
import type { EvalAgentsReader, EvalDeps, EvalStore } from '../src/modules/eval/types.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('eval dashboard rows (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let llm: MockLLMProvider;
  let calls: string[] = [];
  let seq = 0;

  const db = () => pg.handle.db;

  function service(): EvalService {
    const repo = new EvalRepository(db());
    const store = new Proxy(repo, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          calls.push(String(prop));
          return value.apply(target, args);
        };
      },
    }) as EvalStore;
    const agents: EvalAgentsReader = {
      async list(ws) {
        const rows = await db().select().from(t.agents);
        return rows
          .filter((row) => row.workspaceId === ws)
          .map((row) => ({
            id: row.id,
            name: row.name,
            provider: row.provider,
            model: row.model,
            systemPrompt: row.systemPrompt,
            strategy: row.strategy,
            version: row.version,
          }));
      },
      async getById() {
        return undefined;
      },
      async getVersion() {
        return undefined;
      },
    };
    const deps = {
      store,
      agents,
      llm: async () => llm,
    } as unknown as EvalDeps;
    return new EvalService(deps);
  }

  async function addCases(agentId: string, n: number) {
    for (let i = 0; i < n; i++) {
      await db().insert(t.evalCases).values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agentId,
        name: `case-${seq++}`,
        expectationType: 'must_find',
      });
    }
  }

  async function addRun(
    agentId: string,
    over: Partial<typeof t.evalRuns.$inferInsert> = {},
  ) {
    await db().insert(t.evalRuns).values({
      workspaceId,
      agentId,
      agentVersion: 1,
      status: 'done',
      provider: 'openai',
      model: 'gpt-4.1',
      ...over,
    });
  }

  const rowOf = async (agentId: string) => {
    const dash = await service().dashboard(workspaceId);
    return dash.agents.find((a) => a.agent_id === agentId)!;
  };

  beforeAll(async () => {
    pg = await startPg();
    await seed(db());
    const [ws] = await db().select().from(t.workspaces);
    workspaceId = ws!.id;
    llm = new MockLLMProvider('openai');
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('AC-72: case_count and run_in_progress per agent; zero and false without cases or runs', async () => {
    const busy = await insertEvalAgent(db(), workspaceId);
    const idle = await insertEvalAgent(db(), workspaceId);
    const empty = await insertEvalAgent(db(), workspaceId);
    await addCases(busy.id, 3);
    await addCases(idle.id, 2);
    await addRun(busy.id, { status: 'running' });

    expect(await rowOf(busy.id)).toMatchObject({ case_count: 3, run_in_progress: true, trend: [] });
    expect(await rowOf(idle.id)).toMatchObject({ case_count: 2, run_in_progress: false });
    expect(await rowOf(empty.id)).toMatchObject({ case_count: 0, run_in_progress: false, trend: [] });
  });

  it('AC-89: the 20 newest completed runs, oldest first; none gives []', async () => {
    const agent = await insertEvalAgent(db(), workspaceId);
    const none = await insertEvalAgent(db(), workspaceId);
    const base = Date.parse('2026-09-01T00:00:00Z');
    for (let i = 0; i < 21; i++) {
      await addRun(agent.id, { ranAt: new Date(base + i * 60_000), recall: (i + 1) / 100 });
    }
    await addRun(agent.id, { status: 'failed', ranAt: new Date(base + 99 * 60_000), recall: 0.99 });
    await addRun(agent.id, { status: 'running', ranAt: new Date(base + 100 * 60_000), recall: 0.98 });

    const row = await rowOf(agent.id);
    expect(row.trend).toHaveLength(20);
    expect(row.trend.map((p) => p.recall)).toEqual(
      Array.from({ length: 20 }, (_, i) => (i + 2) / 100),
    );
    expect(row.trend[0]).toMatchObject({ precision: null, citation_accuracy: null });
    expect((await rowOf(none.id)).trend).toEqual([]);
  });

  it('NFR-14, NFR-1: the repository is called the same number of times for 1 and for 5 agents; no model call', async () => {
    const countCalls = async () => {
      calls = [];
      await service().dashboard(workspaceId);
      return calls.length;
    };
    const before = await countCalls();
    for (let i = 0; i < 5; i++) {
      const agent = await insertEvalAgent(db(), workspaceId);
      await addCases(agent.id, 2);
      await addRun(agent.id);
    }
    const after = await countCalls();
    expect(after).toBe(before);
    expect(calls.sort()).toEqual(
      [
        'caseCountsByAgent',
        'latestDoneRunPerAgent',
        'recentDoneRuns',
        'runningAgentIds',
        'trendPerAgent',
      ].sort(),
    );
    expect(llm.calls).toHaveLength(0);
  });
});
