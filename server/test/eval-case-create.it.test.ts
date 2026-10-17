import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import {
  findingCaseBody,
  insertDecidedFinding,
  insertEvalAgent,
  manualCaseBody,
  MANUAL_DIFF_TWO_GIT_FILES,
  MANUAL_DIFF_TWO_PLAIN_FILES,
} from './helpers/eval.js';
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

const INJECTION_PATH = "'; drop table eval_cases; --";
const INJECTION_DIFF = `--- a/${INJECTION_PATH}
+++ b/${INJECTION_PATH}
@@ -1,2 +1,3 @@
 const a = 1;
+const a2 = 2;
 export { a };
`;

type App = Awaited<ReturnType<typeof buildApp>>;
type Json = Record<string, unknown>;

d('eval case create (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: App;
  let workspaceId: string;
  let agentId: string;
  const openai = new MockLLMProvider('openai');
  const anthropic = new MockLLMProvider('anthropic');

  const db = () => pg.handle.db;
  const create = (body: Record<string, unknown>, forAgent = agentId) =>
    app.inject({ method: 'POST', url: `/agents/${forAgent}/eval-cases`, payload: body });
  const countCases = async () => (await db().select().from(t.evalCases)).length;
  const codeOf = (res: { json(): unknown }) => (res.json() as { error: { code: string } }).error.code;
  const expectation = (over: Record<string, unknown> = {}) => ({
    ...(manualCaseBody().expected_output as Json),
    ...over,
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
        git: new MockGitClient({ diff: CONFIG_PART }),
        secrets: new MockSecretsProvider({}),
        github: new MockGitHubClient(),
        llm: { openai, anthropic },
      },
    });
    agentId = (await insertEvalAgent(db(), workspaceId)).id;
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('AC-1, AC-3: stores one agent-owned case with revision 1 and null pull request values', async () => {
    const res = await create(manualCaseBody());
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      owner_kind: 'agent',
      owner_id: agentId,
      name: 'manual-case',
      expectation_type: 'must_find',
      source_finding_id: null,
      revision: 1,
      last_result: null,
      input_meta: { pr_number: null, pr_title: 'Add a2', pr_author: null, pr_body: 'Adds a2.' },
      expected_output: {
        file: 'src/a.ts',
        start_line: 11,
        end_line: 11,
        title: 'A new constant',
        severity: 'WARNING',
        category: 'bug',
      },
    });
    const before = await countCases();
    const again = await create(manualCaseBody());
    expect(again.statusCode).toBe(201);
    expect((again.json() as Json).id).not.toBe((res.json() as Json).id);
    expect(await countCases()).toBe(before + 1);
  });

  it('AC-2: the diff is stored byte for byte with the path of every file in order', async () => {
    const git = await create(manualCaseBody());
    expect(git.statusCode).toBe(201);
    expect((git.json() as Json).input_diff).toBe(MANUAL_DIFF_TWO_GIT_FILES);
    expect((git.json() as Json).input_files).toEqual(['src/a.ts', 'src/b.ts']);

    const plain = await create(
      manualCaseBody({
        input_diff: MANUAL_DIFF_TWO_PLAIN_FILES,
        expected_output: expectation({ file: 'src/d.ts', start_line: 8, end_line: 8 }),
      }),
    );
    expect(plain.statusCode).toBe(201);
    expect((plain.json() as Json).input_diff).toBe(MANUAL_DIFF_TWO_PLAIN_FILES);
    expect((plain.json() as Json).input_files).toEqual(['src/c.ts', 'src/d.ts']);

    const [row] = await db()
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.id, (plain.json() as { id: string }).id));
    expect(row!.inputDiff).toBe(MANUAL_DIFF_TWO_PLAIN_FILES);
  });

  it('AC-3, AC-4: the four meta values, and an empty string for each of the last three left out', async () => {
    const full = await create(manualCaseBody());
    expect((full.json() as Json).input_meta).toEqual({
      pr_number: null,
      pr_title: 'Add a2',
      pr_author: null,
      pr_body: 'Adds a2.',
    });

    const bare = await create(
      manualCaseBody({
        input_meta: { pr_body: null },
        expected_output: { file: 'src/a.ts', start_line: 11, end_line: 11 },
      }),
    );
    expect(bare.statusCode).toBe(201);
    const body = bare.json() as { input_meta: Json; expected_output: Json };
    expect(body.input_meta).toEqual({
      pr_number: null,
      pr_title: '',
      pr_author: null,
      pr_body: null,
    });
    expect(body.expected_output).toMatchObject({ title: '', severity: '', category: '' });
  });

  it('AC-5: a body that fails the schema answers 422 and stores nothing', async () => {
    const before = await countCases();
    const bodies: Record<string, unknown>[] = [
      manualCaseBody({ name: '   ' }),
      manualCaseBody({ name: 'x'.repeat(65) }),
      manualCaseBody({ input_diff: '  \n ' }),
      manualCaseBody({ expectation_type: 'maybe' }),
      manualCaseBody({ expected_output: expectation({ file: ' ' }) }),
      manualCaseBody({ expected_output: expectation({ start_line: 0, end_line: 3 }) }),
      manualCaseBody({ expected_output: expectation({ start_line: 12, end_line: 11 }) }),
      manualCaseBody({ expected_output: expectation({ severity: 'URGENT' }) }),
      manualCaseBody({ expected_output: expectation({ category: 'vibes' }) }),
      manualCaseBody({ input_meta: { pr_title: 'x' } }),
      (() => {
        const { expected_output: _omitted, ...rest } = manualCaseBody();
        return rest;
      })(),
    ];
    for (const body of bodies) {
      const res = await create(body);
      expect(res.statusCode, JSON.stringify(body).slice(0, 120)).toBe(422);
    }
    expect(await countCases()).toBe(before);
  });

  it('AC-6: prose, and a hunk with no +++ line, are refused with eval_diff_invalid', async () => {
    const before = await countCases();
    for (const input_diff of [
      'This is a pull request, not a diff.',
      '--- a/src/a.ts\n@@ -1,2 +1,3 @@\n const a = 1;\n+const a2 = 2;\n',
    ]) {
      const res = await create(manualCaseBody({ input_diff }));
      expect(res.statusCode).toBe(400);
      expect(codeOf(res)).toBe('eval_diff_invalid');
    }
    expect(await countCases()).toBe(before);
  });

  it('AC-7: a file outside the diff, and lines outside its hunk, are refused', async () => {
    const before = await countCases();
    const otherFile = await create(
      manualCaseBody({ expected_output: expectation({ file: 'src/other.ts' }) }),
    );
    expect(otherFile.statusCode).toBe(400);
    expect(codeOf(otherFile)).toBe('expectation_outside_diff');

    const otherLines = await create(
      manualCaseBody({ expected_output: expectation({ start_line: 40, end_line: 41 }) }),
    );
    expect(otherLines.statusCode).toBe(400);
    expect(codeOf(otherLines)).toBe('expectation_outside_diff');
    expect(await countCases()).toBe(before);
  });

  it('AC-8: an agent of another workspace, or none at all, answers 404', async () => {
    const [other] = await db().insert(t.workspaces).values({ name: 'other' }).returning();
    const foreign = await insertEvalAgent(db(), other!.id);
    const before = await countCases();
    expect((await create(manualCaseBody(), foreign.id)).statusCode).toBe(404);
    expect(
      (await create(manualCaseBody(), '00000000-0000-4000-8000-000000000000')).statusCode,
    ).toBe(404);
    expect(await countCases()).toBe(before);
  });

  it('AC-9: a diff over the 1,048,576-byte body limit is refused and stores nothing', async () => {
    const before = await countCases();
    const huge = `${MANUAL_DIFF_TWO_GIT_FILES}${' '.repeat(1_100_000)}`;
    const res = await create(manualCaseBody({ input_diff: huge }));
    console.info(`AC-9: body of ${huge.length} bytes answered ${res.statusCode}`);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(await countCases()).toBe(before);
  });

  it('AC-22: the list holds a finding-born and a hand-made case in one shape', async () => {
    const [repo] = await db()
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'list-repo', fullName: 'acme/list-repo' })
      .returning();
    const [pr] = await db()
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 700,
        title: 'Add config',
        author: 'marisa.koch',
        branch: 'feat/c',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: '',
      })
      .returning();
    await db().insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: CONFIG_PART.split('\n').slice(3).join('\n').trimEnd(),
    });
    const listAgent = (await insertEvalAgent(db(), workspaceId)).id;
    const { findingId } = await insertDecidedFinding(db(), {
      prId: pr!.id,
      agentId: listAgent,
      decision: 'accepted',
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/findings/${findingId}/eval-case`,
          payload: await findingCaseBody(app, findingId),
        })
      ).statusCode,
    ).toBe(201);
    expect((await create(manualCaseBody(), listAgent)).statusCode).toBe(201);

    const list = await app.inject({ method: 'GET', url: `/agents/${listAgent}/eval-cases` });
    expect(list.statusCode).toBe(200);
    const cases = list.json() as Json[];
    expect(cases).toHaveLength(2);
    expect(cases.map((c) => c.source_finding_id === null).sort()).toEqual([false, true]);
    expect(new Set(cases.map((c) => Object.keys(c).sort().join()))).toHaveProperty('size', 1);
  });

  it('NFR-1: creating a case makes no model call', async () => {
    expect(openai.calls).toEqual([]);
    expect(anthropic.calls).toEqual([]);
  });

  it('NFR-2: a non-uuid agent id answers 422; a path with SQL text is stored as data', async () => {
    const bad = await create(manualCaseBody(), 'not-a-uuid');
    expect(bad.statusCode).toBe(422);

    const res = await create(
      manualCaseBody({
        input_diff: INJECTION_DIFF,
        expected_output: expectation({ file: INJECTION_PATH, start_line: 2, end_line: 2 }),
      }),
    );
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { id: string }).id;
    const [row] = await db().select().from(t.evalCases).where(eq(t.evalCases.id, id));
    expect(row!.inputFiles).toEqual([INJECTION_PATH]);
    expect(row!.expectedOutput).toMatchObject({ file: INJECTION_PATH });
    expect((await db().select().from(t.evalCases)).length).toBeGreaterThan(0);
  });
});
