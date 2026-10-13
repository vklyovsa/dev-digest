import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import {
  insertEvalAgent,
  insertFindingBornCase,
  manualCaseBody,
  waitForEvalRun,
  SilentEvalLLM,
  MANUAL_DIFF_TWO_GIT_FILES,
  MANUAL_DIFF_TWO_PLAIN_FILES,
} from './helpers/eval.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
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

d('eval case update (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: App;
  let workspaceId: string;
  const llm = new SilentEvalLLM();

  const db = () => pg.handle.db;
  const codeOf = (res: { json(): unknown }) => (res.json() as { error: { code: string } }).error.code;
  const expectation = (over: Record<string, unknown> = {}) => ({
    ...(manualCaseBody().expected_output as Json),
    ...over,
  });

  async function newAgent(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: `Update agent ${Math.random()}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'p' },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }
  async function newCase(agentId: string, over: Record<string, unknown> = {}): Promise<Json> {
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-cases`,
      payload: manualCaseBody(over),
    });
    expect(res.statusCode).toBe(201);
    return res.json() as Json;
  }
  const update = (caseId: string, over: Record<string, unknown> = {}) => {
    const { expectation_type: _fixed, ...body } = manualCaseBody(over);
    return app.inject({ method: 'PUT', url: `/eval-cases/${caseId}`, payload: body });
  };
  const list = async (agentId: string) =>
    (await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-cases` })).json() as Json[];
  const fromList = async (agentId: string, caseId: string) =>
    (await list(agentId)).find((c) => c.id === caseId)!;
  async function runToEnd(agentId: string): Promise<Json> {
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    expect(res.statusCode).toBe(202);
    const settled = await waitForEvalRun(app, (res.json() as Json).id as string);
    expect(settled.status).toBe('done');
    return settled;
  }

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
        git: new MockGitClient({ diff: '' }),
        secrets: new MockSecretsProvider({}),
        github: new MockGitHubClient(),
        llm: { openai: llm },
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('AC-10: every replaced value reads back from the list', async () => {
    const agentId = await newAgent();
    const created = await newCase(agentId);
    const res = await update(created.id as string, {
      name: 'renamed',
      input_diff: MANUAL_DIFF_TWO_PLAIN_FILES,
      input_meta: { pr_title: 'New title', pr_body: null },
      expected_output: expectation({
        file: 'src/d.ts',
        start_line: 8,
        end_line: 8,
        title: 'Another',
        severity: 'CRITICAL',
        category: 'security',
      }),
    });
    expect(res.statusCode).toBe(200);
    const expected = {
      name: 'renamed',
      input_diff: MANUAL_DIFF_TWO_PLAIN_FILES,
      input_files: ['src/c.ts', 'src/d.ts'],
      input_meta: { pr_number: null, pr_title: 'New title', pr_author: null, pr_body: null },
      expected_output: {
        file: 'src/d.ts',
        start_line: 8,
        end_line: 8,
        title: 'Another',
        severity: 'CRITICAL',
        category: 'security',
      },
    };
    expect(res.json()).toMatchObject(expected);
    expect(await fromList(agentId, created.id as string)).toMatchObject(expected);
  });

  it('AC-11: type, owner, source finding, creation time, number and author are not writable', async () => {
    const agentId = await newAgent();
    const born = await insertFindingBornCase(db(), workspaceId, agentId);
    const res = await app.inject({
      method: 'PUT',
      url: `/eval-cases/${born.id}`,
      payload: {
        ...manualCaseBody({ name: 'edited-born' }),
        expectation_type: 'must_not_flag',
        owner_id: '00000000-0000-4000-8000-000000000000',
        source_finding_id: null,
        created_at: '2001-01-01T00:00:00.000Z',
        input_meta: { pr_title: 'Add a2', pr_body: 'Adds a2.', pr_number: 5, pr_author: 'mallory' },
      },
    });
    expect(res.statusCode).toBe(200);
    const after = await fromList(agentId, born.id);
    expect(after).toMatchObject({
      name: 'edited-born',
      expectation_type: 'must_find',
      owner_id: agentId,
      owner_kind: 'agent',
      source_finding_id: born.sourceFindingId,
      created_at: born.createdAt.toISOString(),
      input_meta: { pr_number: 701, pr_author: 'marisa.koch' },
    });
  });

  it('AC-12: a refused update leaves the case as it was', async () => {
    const agentId = await newAgent();
    const created = await newCase(agentId);
    const before = await fromList(agentId, created.id as string);

    const outside = await update(created.id as string, {
      expected_output: expectation({ start_line: 40, end_line: 41 }),
    });
    expect(outside.statusCode).toBe(400);
    expect(codeOf(outside)).toBe('expectation_outside_diff');

    const prose = await update(created.id as string, { input_diff: 'Not a diff at all.' });
    expect(prose.statusCode).toBe(400);
    expect(codeOf(prose)).toBe('eval_diff_invalid');

    const invalid = await update(created.id as string, { name: '  ' });
    expect(invalid.statusCode).toBe(422);
    expect(await fromList(agentId, created.id as string)).toEqual(before);
  });

  it('AC-13: a case of another workspace, a deleted case and an unknown id answer 404', async () => {
    const [other] = await db().insert(t.workspaces).values({ name: 'other-update' }).returning();
    const foreignAgent = await insertEvalAgent(db(), other!.id);
    const [foreign] = await db()
      .insert(t.evalCases)
      .values({
        workspaceId: other!.id,
        ownerKind: 'agent',
        ownerId: foreignAgent.id,
        name: 'foreign',
        expectationType: 'must_find',
        inputDiff: MANUAL_DIFF_TWO_GIT_FILES,
        inputFiles: ['src/a.ts'],
      })
      .returning();
    expect((await update(foreign!.id)).statusCode).toBe(404);
    const [row] = await db().select().from(t.evalCases).where(eq(t.evalCases.id, foreign!.id));
    expect(row!.name).toBe('foreign');

    const agentId = await newAgent();
    const created = await newCase(agentId);
    const del = await app.inject({ method: 'DELETE', url: `/eval-cases/${created.id}` });
    expect(del.statusCode).toBe(200);
    expect((await update(created.id as string)).statusCode).toBe(404);
    expect((await update('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
  });

  it('AC-14: while a run of the agent is running the update is refused and the case is unchanged', async () => {
    const agentId = await newAgent();
    const created = await newCase(agentId);
    const before = await fromList(agentId, created.id as string);
    const [running] = await db()
      .insert(t.evalRuns)
      .values({ workspaceId, agentId, agentVersion: 1, status: 'running', provider: 'openai', model: 'm' })
      .returning();

    const res = await update(created.id as string, { name: 'blocked' });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('eval_run_in_progress');
    expect((res.json() as { error: { details: Json } }).error.details).toEqual({ run_id: running!.id });
    expect(await fromList(agentId, created.id as string)).toEqual(before);

    await db().update(t.evalRuns).set({ status: 'failed', error: 'x' }).where(eq(t.evalRuns.id, running!.id));
    expect((await update(created.id as string, { name: 'allowed' })).statusCode).toBe(200);
  });

  it('AC-15: a rename keeps revision 1, a changed end line makes it 2, an identical save keeps it', async () => {
    const agentId = await newAgent();
    const created = await newCase(agentId);
    expect(created.revision).toBe(1);

    const renamed = await update(created.id as string, { name: 'renamed' });
    expect((renamed.json() as Json).revision).toBe(1);

    const same = await update(created.id as string, { name: 'renamed' });
    expect((same.json() as Json).revision).toBe(1);

    const moved = await update(created.id as string, {
      name: 'renamed',
      expected_output: expectation({ end_line: 12 }),
    });
    expect((moved.json() as Json).revision).toBe(2);

    const retitled = await update(created.id as string, {
      name: 'renamed',
      expected_output: expectation({ end_line: 12, title: 'Other', severity: 'CRITICAL' }),
    });
    expect((retitled.json() as Json).revision).toBe(2);
    expect((await fromList(agentId, created.id as string)).revision).toBe(2);
  });

  it('AC-16, NFR-1: stored runs are unchanged by edits, and no edit calls the model', async () => {
    const agentId = await newAgent();
    const created = await newCase(agentId);
    const run = await runToEnd(agentId);
    const callsAfterRun = llm.calls.length;

    await update(created.id as string, { name: 'renamed' });
    await update(created.id as string, { expected_output: expectation({ end_line: 12, title: 'Other' }) });

    const read = await app.inject({ method: 'GET', url: `/eval-runs/${run.id}` });
    expect(read.json()).toEqual(run);
    expect(llm.calls.length).toBe(callsAfterRun);
  });

  it('AC-17: a run after one content edit stores case_revision 2 for that case only', async () => {
    const agentId = await newAgent();
    const edited = await newCase(agentId, { name: 'edited' });
    const kept = await newCase(agentId, { name: 'kept' });
    await update(edited.id as string, { name: 'edited', expected_output: expectation({ end_line: 12 }) });

    const run = await runToEnd(agentId);
    const results = run.results as Array<{ case_id: string; case_revision: number }>;
    expect(results.find((r) => r.case_id === edited.id)!.case_revision).toBe(2);
    expect(results.find((r) => r.case_id === kept.id)!.case_revision).toBe(1);
  });

  it('AC-18: last_result is null after a content edit, kept after a rename, new after the next run', async () => {
    const agentId = await newAgent();
    const created = await newCase(agentId);
    const id = created.id as string;
    const first = await runToEnd(agentId);
    expect((await fromList(agentId, id)).last_result).toMatchObject({ run_id: first.id });

    const renamed = await update(id, { name: 'renamed' });
    expect((renamed.json() as Json).last_result).toMatchObject({ run_id: first.id });
    expect((await fromList(agentId, id)).last_result).toMatchObject({ run_id: first.id });

    const edited = await update(id, { name: 'renamed', expected_output: expectation({ end_line: 12 }) });
    expect((edited.json() as Json).last_result).toBeNull();
    expect((await fromList(agentId, id)).last_result).toBeNull();

    const second = await runToEnd(agentId);
    expect((await fromList(agentId, id)).last_result).toMatchObject({ run_id: second.id });
  });

  it('AC-19: a case edited between two runs is left out of both sides and named in cases_edited', async () => {
    const agentId = await newAgent();
    await newCase(agentId, { name: 'case-a' });
    const b = await newCase(agentId, { name: 'case-b' });
    await newCase(agentId, { name: 'case-c' });
    const first = await runToEnd(agentId);
    await update(b.id as string, { name: 'case-b', expected_output: expectation({ end_line: 12 }) });
    const second = await runToEnd(agentId);

    const res = await app.inject({
      method: 'GET',
      url: `/agents/${agentId}/eval-runs/compare?base=${first.id}&head=${second.id}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { base: Json; head: Json; cases_edited: string[]; cases_only_in_base: string[] };
    expect(body.base.cases_total).toBe(2);
    expect(body.head.cases_total).toBe(2);
    expect(body.cases_edited).toEqual(['case-b']);
    expect(body.cases_only_in_base).toEqual([]);
  });

  it('AC-21: a case and an outcome stored without a revision read back as revision 1', async () => {
    const agentId = await newAgent();
    const [row] = await db()
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agentId,
        name: 'legacy',
        expectationType: 'must_find',
        expectedOutput: {
          file: 'src/a.ts',
          start_line: 11,
          end_line: 11,
          severity: 'CRITICAL',
          category: 'security',
          title: 'Legacy',
        },
        inputDiff: MANUAL_DIFF_TWO_GIT_FILES,
        inputFiles: ['src/a.ts', 'src/b.ts'],
        inputMeta: { pr_number: 1, pr_title: 'Legacy', pr_author: 'a', pr_body: null },
      })
      .returning();
    const [runRow] = await db()
      .insert(t.evalRuns)
      .values({
        workspaceId,
        agentId,
        agentVersion: 1,
        status: 'done',
        provider: 'openai',
        model: 'm',
        caseIds: [row!.id],
        casesTotal: 1,
        results: [
          {
            case_id: row!.id,
            case_name: 'legacy',
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

    expect((await fromList(agentId, row!.id)).revision).toBe(1);
    const run = (await app.inject({ method: 'GET', url: `/eval-runs/${runRow!.id}` })).json() as {
      results: Array<{ case_revision: number }>;
    };
    expect(run.results[0]!.case_revision).toBe(1);
    expect((await fromList(agentId, row!.id)).last_result).toMatchObject({ run_id: runRow!.id });
  });

  it('AC-23: a finding-born and a hand-made case are both run and both get an outcome', async () => {
    const agentId = await newAgent();
    const born = await insertFindingBornCase(db(), workspaceId, agentId);
    const manual = await newCase(agentId, { name: 'by-hand' });

    const run = await runToEnd(agentId);
    expect(run.case_ids).toEqual([born.id, manual.id]);
    const results = run.results as Array<{ case_id: string }>;
    expect(results.map((r) => r.case_id).sort()).toEqual([born.id, manual.id as string].sort());
  });
});
