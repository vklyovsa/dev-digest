import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-promote] Docker not available — skipping integration tests.');
}

type Json = Record<string, unknown>;

/**
 * Promote vN (SPEC-09 AC-85, EC-28): `PUT /agents/:id` carrying an earlier version's
 * snapshot is a plain update — it adds a version and leaves every earlier row alone.
 */
d('promoting an earlier agent version', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  async function agentAtVersion3(app: Awaited<ReturnType<typeof makeApp>>) {
    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: 'Promote me', provider: 'openai', model: 'gpt-4o-mini', system_prompt: 'Prompt one.' },
    });
    const id = (created.json() as Json).id as string;
    await app.inject({ method: 'PUT', url: `/agents/${id}`, payload: { model: 'gpt-4o', system_prompt: 'Prompt two.' } });
    const third = await app.inject({ method: 'PUT', url: `/agents/${id}`, payload: { strategy: 'map-reduce' } });
    expect((third.json() as Json).version).toBe(3);
    return id;
  }

  const versionsOf = async (app: Awaited<ReturnType<typeof makeApp>>, id: string) =>
    (await app.inject({ method: 'GET', url: `/agents/${id}/versions` })).json() as Array<{
      version: number;
      config: Json;
    }>;

  async function promoteV1(app: Awaited<ReturnType<typeof makeApp>>, id: string) {
    const snapshot = (await app.inject({ method: 'GET', url: `/agents/${id}/versions/1` })).json() as {
      config: Json;
    };
    const { provider, model, system_prompt, strategy, output_schema, ci_fail_on, repo_intel } = snapshot.config;
    return app.inject({
      method: 'PUT',
      url: `/agents/${id}`,
      payload: { provider, model, system_prompt, strategy, output_schema, ci_fail_on, repo_intel },
    });
  }

  it('AC-85: an agent at version 3 promoted to version 1 reads version 4; versions 1-3 are untouched', async () => {
    const app = await makeApp();
    const id = await agentAtVersion3(app);
    const before = await versionsOf(app, id);
    expect(before.map((v) => v.version)).toEqual([3, 2, 1]);

    const res = await promoteV1(app, id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ version: 4, model: 'gpt-4o-mini', system_prompt: 'Prompt one.' });

    const after = await versionsOf(app, id);
    expect(after.map((v) => v.version)).toEqual([4, 3, 2, 1]);
    expect(after.slice(1)).toEqual(before);
    const v1 = before.find((v) => v.version === 1)!;
    expect(after[0]!.config).toMatchObject({
      provider: v1.config.provider,
      model: v1.config.model,
      system_prompt: v1.config.system_prompt,
      strategy: v1.config.strategy,
      ci_fail_on: v1.config.ci_fail_on,
      repo_intel: v1.config.repo_intel,
    });
    await app.close();
  });

  it('EC-28: promoting while a run executes saves the agent and the run keeps the version it started with', async () => {
    const app = await makeApp();
    const id = await agentAtVersion3(app);
    const [agent] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.id, id));
    const [run] = await pg.handle.db
      .insert(t.evalRuns)
      .values({
        workspaceId: agent!.workspaceId,
        agentId: id,
        agentVersion: 3,
        status: 'running',
        provider: 'openai',
        model: 'gpt-4o',
      })
      .returning();

    const res = await promoteV1(app, id);
    expect((res.json() as Json).version).toBe(4);

    const [after] = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.id, run!.id));
    expect(after).toMatchObject({ agentVersion: 3, status: 'running', model: 'gpt-4o' });
    await app.close();
  });
});
