import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { findingCaseBody, insertDecidedFinding, insertEvalAgent, manualCaseBody } from './helpers/eval.js';
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

const A_PART = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 const a = 1;
+const a2 = 2;
 export { a };
`;

const CONFIG_PART = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,
`;

const B_PART = `diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -5,2 +5,3 @@
 const b = 1;
+const b2 = 2;
 export { b };
`;

const DIFF = A_PART + CONFIG_PART + B_PART;

const MANUAL_HEAD = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,3 +10,4 @@
`;

const PATCH_OF = (part: string) => part.split('\n').slice(3).join('\n').trimEnd();

type App = Awaited<ReturnType<typeof buildApp>>;
type Json = Record<string, unknown>;

d('eval cases (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: App;
  let workspaceId: string;
  let agentId: string;
  const openai = new MockLLMProvider('openai');
  const anthropic = new MockLLMProvider('anthropic');
  let seq = 0;

  const db = () => pg.handle.db;

  async function newPull(owner = workspaceId) {
    const name = `eval-repo-${seq++}`;
    const [repo] = await db()
      .insert(t.repos)
      .values({ workspaceId: owner, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db()
      .insert(t.pullRequests)
      .values({
        workspaceId: owner,
        repoId: repo!.id,
        number: 480 + seq,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 3,
        deletions: 0,
        filesCount: 3,
        status: 'needs_review',
        body: 'Add rate limiting. Closes #471.',
      })
      .returning();
    await db()
      .insert(t.prFiles)
      .values(
        [
          ['src/a.ts', A_PART],
          ['src/config.ts', CONFIG_PART],
          ['src/b.ts', B_PART],
        ].map(([path, part]) => ({
          prId: pr!.id,
          path: path!,
          additions: 1,
          deletions: 0,
          patch: PATCH_OF(part!),
        })),
      );
    return pr!;
  }

  async function configFinding(
    decision: 'accepted' | 'dismissed' | 'undecided',
    over: { title?: string; startLine?: number; endLine?: number; file?: string } = {},
  ) {
    const pr = await newPull();
    const ids = await insertDecidedFinding(db(), {
      prId: pr.id,
      agentId,
      decision,
      file: over.file ?? 'src/config.ts',
      startLine: over.startLine ?? 11,
      endLine: over.endLine ?? 11,
      ...(over.title ? { title: over.title } : {}),
    });
    return { pr, ...ids };
  }

  const post = async (findingId: string, body?: Json) =>
    app.inject({
      method: 'POST',
      url: `/findings/${findingId}/eval-case`,
      payload: body ?? (await findingCaseBody(app, findingId)),
    });
  const listCases = (forAgent = agentId) =>
    app.inject({ method: 'GET', url: `/agents/${forAgent}/eval-cases` });
  const countRows = async (table: typeof t.evalCases | typeof t.evalRuns) =>
    (await db().select().from(table)).length;

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
        git: new MockGitClient({ diff: DIFF }),
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

  it('AC-95: migrate, seed and buildApp create no case and no run', async () => {
    expect(await countRows(t.evalCases)).toBe(0);
    expect(await countRows(t.evalRuns)).toBe(0);
  });

  it('AC-1, AC-3, AC-4, AC-5: an accepted finding becomes a must_find case of its agent', async () => {
    const { findingId } = await configFinding('accepted');
    const res = await post(findingId);
    expect(res.statusCode).toBe(201);
    const body = res.json() as Json;
    expect(body).toMatchObject({
      owner_kind: 'agent',
      owner_id: agentId,
      name: 'must-find-hardcoded-stripe-secret-key',
      expectation_type: 'must_find',
      source_finding_id: findingId,
      last_result: null,
      expected_output: {
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
      },
      input_files: ['src/config.ts'],
      input_meta: {
        pr_title: 'Add rate limiting',
        pr_author: 'marisa.koch',
        pr_body: 'Add rate limiting. Closes #471.',
      },
    });
    expect((body.input_meta as Json).pr_number).toEqual(expect.any(Number));
    expect(body.input_diff).toBe(CONFIG_PART);
    expect(body.input_diff).not.toContain('src/a.ts');
    expect(body.input_diff).not.toContain('src/b.ts');
  });

  it('AC-2: a dismissed finding becomes a must_not_flag case', async () => {
    const { findingId } = await configFinding('dismissed', { title: 'Missing rate limit!' });
    const res = await post(findingId);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      expectation_type: 'must_not_flag',
      name: 'no-missing-rate-limit-',
    });
  });

  it('AC-7: an undecided finding is refused with finding_undecided', async () => {
    const { findingId } = await configFinding('undecided');
    const res = await post(findingId);
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('finding_undecided');
    expect(await db().select().from(t.evalCases).where(eq(t.evalCases.sourceFindingId, findingId))).toHaveLength(0);
  });

  it('AC-8: a second request returns the stored case and stores no second one', async () => {
    const { findingId } = await configFinding('accepted', { title: 'Twice' });
    const first = await post(findingId);
    const second = await post(findingId);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect((second.json() as Json).id).toBe((first.json() as Json).id);
    const rows = await db()
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.sourceFindingId, findingId));
    expect(rows).toHaveLength(1);
  });

  it('AC-8, EC-2: two simultaneous requests yield one row, one 201 and one 200', async () => {
    const { findingId } = await configFinding('accepted', { title: 'Simultaneous' });
    const [one, two] = await Promise.all([post(findingId), post(findingId)]);
    expect([one.statusCode, two.statusCode].sort()).toEqual([200, 201]);
    expect((one.json() as Json).id).toBe((two.json() as Json).id);
    const rows = await db()
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.sourceFindingId, findingId));
    expect(rows).toHaveLength(1);
  });

  it('AC-9: a review without an agent, and an agent that is gone, are refused', async () => {
    const pr = await newPull();
    const noAgent = await insertDecidedFinding(db(), {
      prId: pr.id,
      agentId: null,
      decision: 'accepted',
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
    });
    const gone = await insertEvalAgent(db(), workspaceId);
    const orphan = await insertDecidedFinding(db(), {
      prId: pr.id,
      agentId: gone.id,
      decision: 'accepted',
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
    });
    await db().delete(t.agents).where(eq(t.agents.id, gone.id));

    for (const { findingId } of [noAgent, orphan]) {
      const res = await post(findingId);
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe('eval_owner_missing');
    }
  });

  it('AC-28: a body outside the diff, or prose as the diff, is refused and stores nothing', async () => {
    const { findingId } = await configFinding('accepted', { title: 'Refused body' });
    const draftBody = await findingCaseBody(app, findingId);
    const outside = await post(findingId, {
      ...draftBody,
      expected_output: { ...(draftBody.expected_output as Json), start_line: 40, end_line: 41 },
    });
    expect(outside.statusCode).toBe(400);
    expect((outside.json() as { error: { code: string } }).error.code).toBe('expectation_outside_diff');

    const prose = await post(findingId, { ...draftBody, input_diff: 'this is prose, not a diff' });
    expect(prose.statusCode).toBe(400);
    expect((prose.json() as { error: { code: string } }).error.code).toBe('eval_diff_invalid');
    expect(
      await db().select().from(t.evalCases).where(eq(t.evalCases.sourceFindingId, findingId)),
    ).toHaveLength(0);
  });

  it('AC-11, AC-29: an unknown finding is 404 and a non-uuid is 422', async () => {
    expect((await post('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await post('not-a-uuid')).statusCode).toBe(422);
  });

  it('AC-23, AC-24, AC-25: the body is stored as sent; the type and the PR identity come from the server', async () => {
    const { findingId, pr } = await configFinding('accepted', { title: 'Body wins' });
    const res = await post(findingId, {
      name: 'my-own-name',
      expectation_type: 'must_not_flag',
      input_diff: CONFIG_PART,
      input_meta: { pr_title: 'Edited title', pr_body: 'Edited body', pr_number: 99999, pr_author: 'mallory' },
      expected_output: {
        file: 'src/config.ts',
        start_line: 10,
        end_line: 12,
        severity: 'SUGGESTION',
        category: 'bug',
        title: 'Edited finding title',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      owner_id: agentId,
      owner_kind: 'agent',
      name: 'my-own-name',
      expectation_type: 'must_find',
      source_finding_id: findingId,
      revision: 1,
      input_files: ['src/config.ts'],
      input_meta: {
        pr_number: pr.number,
        pr_author: 'marisa.koch',
        pr_title: 'Edited title',
        pr_body: 'Edited body',
      },
      expected_output: {
        start_line: 10,
        end_line: 12,
        severity: 'SUGGESTION',
        category: 'bug',
        title: 'Edited finding title',
      },
    });
  });

  it('AC-26: a second call with another body returns the first case and stores no second', async () => {
    const { findingId } = await configFinding('accepted', { title: 'First body kept' });
    const first = await post(findingId);
    const second = await post(findingId, manualCaseBody({ name: 'second-body' }));
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect((second.json() as Json).id).toBe((first.json() as Json).id);
    expect((second.json() as Json).name).toBe('must-find-first-body-kept');
    const rows = await db()
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.sourceFindingId, findingId));
    expect(rows).toHaveLength(1);
  });

  it('AC-27, AC-29: no body or a blank name is 422; undecided and ownerless findings store nothing', async () => {
    const { findingId } = await configFinding('accepted', { title: 'Needs a body' });
    const before = await countRows(t.evalCases);
    const none = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(none.statusCode).toBe(422);
    const blank = await post(findingId, { ...(await findingCaseBody(app, findingId)), name: '   ' });
    expect(blank.statusCode).toBe(422);
    const undecided = await configFinding('undecided');
    const refused = await post(undecided.findingId);
    expect(refused.statusCode).toBe(400);
    expect((refused.json() as { error: { code: string } }).error.code).toBe('finding_undecided');
    expect(await countRows(t.evalCases)).toBe(before);
  });

  it('NFR-5: SQL text in the file is stored as data; a 1,100,000-byte body stores nothing', async () => {
    const { findingId } = await configFinding('accepted', { title: 'Hostile body' });
    const sqlPath = "'; drop table eval_cases; --";
    const hostileDiff = `diff --git a/${sqlPath} b/${sqlPath}\n--- a/${sqlPath}\n+++ b/${sqlPath}\n@@ -1,2 +1,3 @@\n a\n+b\n c\n`;
    const res = await post(findingId, {
      ...manualCaseBody(),
      input_diff: hostileDiff,
      expected_output: { ...(manualCaseBody().expected_output as Json), file: sqlPath, start_line: 2, end_line: 2 },
    });
    expect(res.statusCode).toBe(201);
    const read = await listCases();
    expect((read.json() as Json[]).map((c) => (c.expected_output as Json).file)).toContain(sqlPath);

    const big = await configFinding('accepted', { title: 'Oversized body' });
    const before = await countRows(t.evalCases);
    const huge = await post(big.findingId, {
      ...manualCaseBody(),
      input_diff: `${MANUAL_HEAD}${'+x\n'.repeat(400_000)}`,
    });
    expect(huge.statusCode).toBeGreaterThanOrEqual(400);
    expect(await countRows(t.evalCases)).toBe(before);
  });

  it('AC-11, AC-44: another workspace answers 404 on all three routes', async () => {
    const [other] = await db().insert(t.workspaces).values({ name: 'other' }).returning();
    const otherAgent = await insertEvalAgent(db(), other!.id);
    const otherPr = await newPull(other!.id);
    const { findingId } = await insertDecidedFinding(db(), {
      prId: otherPr.id,
      agentId: otherAgent.id,
      decision: 'accepted',
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
    });
    const [otherCase] = await db()
      .insert(t.evalCases)
      .values({
        workspaceId: other!.id,
        ownerKind: 'agent',
        ownerId: otherAgent.id,
        name: 'foreign',
        expectationType: 'must_find',
      })
      .returning();

    expect((await post(findingId)).statusCode).toBe(404);
    expect((await listCases(otherAgent.id)).statusCode).toBe(404);
    const del = await app.inject({ method: 'DELETE', url: `/eval-cases/${otherCase!.id}` });
    expect(del.statusCode).toBe(404);

    const rows = await db().select().from(t.evalCases).where(eq(t.evalCases.id, otherCase!.id));
    expect(rows).toHaveLength(1);
    expect(
      await db().select().from(t.evalCases).where(eq(t.evalCases.sourceFindingId, findingId)),
    ).toHaveLength(0);
  });

  it('AC-12: a changed decision or a deleted finding, review and PR leaves the case unchanged', async () => {
    const owner = await insertEvalAgent(db(), workspaceId);
    const pr = await newPull();
    const { reviewId, findingId } = await insertDecidedFinding(db(), {
      prId: pr.id,
      agentId: owner.id,
      decision: 'accepted',
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
      title: 'Stays as it was',
    });
    const created = await post(findingId);
    expect(created.statusCode).toBe(201);
    const before = (await listCases(owner.id)).json() as Json[];

    const dismissed = await app.inject({ method: 'POST', url: `/findings/${findingId}/dismiss` });
    expect(dismissed.statusCode).toBe(200);
    const again = await post(findingId);
    expect(again.statusCode).toBe(200);
    expect((again.json() as Json).expectation_type).toBe('must_find');
    expect((await listCases(owner.id)).json()).toEqual(before);

    await db().delete(t.reviews).where(eq(t.reviews.id, reviewId));
    await db().delete(t.pullRequests).where(eq(t.pullRequests.id, pr.id));
    expect((await listCases(owner.id)).json()).toEqual(before);
    expect(before).toHaveLength(1);
  });

  it('AC-20: a case list is oldest first with last_result null when nothing ran', async () => {
    const owner = await insertEvalAgent(db(), workspaceId);
    const titles = ['First one', 'Second one', 'Third one'];
    for (const title of titles) {
      const pr = await newPull();
      const { findingId } = await insertDecidedFinding(db(), {
        prId: pr.id,
        agentId: owner.id,
        decision: 'accepted',
        file: 'src/config.ts',
        startLine: 11,
        endLine: 11,
        title,
      });
      expect((await post(findingId)).statusCode).toBe(201);
    }
    const res = await listCases(owner.id);
    expect(res.statusCode).toBe(200);
    const cases = res.json() as Json[];
    expect(cases.map((c) => c.name)).toEqual([
      'must-find-first-one',
      'must-find-second-one',
      'must-find-third-one',
    ]);
    expect(cases.every((c) => c.last_result === null)).toBe(true);
  });

  it('AC-20: last_result comes from the newest completed run that covered the case', async () => {
    const owner = await insertEvalAgent(db(), workspaceId);
    const pr = await newPull();
    const { findingId } = await insertDecidedFinding(db(), {
      prId: pr.id,
      agentId: owner.id,
      decision: 'accepted',
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
      title: 'Ran twice',
    });
    const caseId = ((await post(findingId)).json() as Json).id as string;

    const outcome = (status: 'pass' | 'fail', matched: number) => ({
      case_id: caseId,
      case_name: 'must-find-ran-twice',
      expectation_type: 'must_find' as const,
      status,
      matched,
      produced: matched,
      findings: [],
      error: null,
    });
    const run = (ranAt: string, status: 'pass' | 'fail', matched: number) => ({
      workspaceId,
      agentId: owner.id,
      agentVersion: 1,
      status: 'done' as const,
      ranAt: new Date(ranAt),
      provider: 'openai',
      model: 'gpt-4.1',
      caseIds: [caseId],
      casesTotal: 1,
      results: [outcome(status, matched)],
    });
    await db().insert(t.evalRuns).values(run('2026-10-01T10:00:00Z', 'fail', 0));
    const [newest] = await db()
      .insert(t.evalRuns)
      .values(run('2026-10-02T10:00:00Z', 'pass', 2))
      .returning();

    const cases = (await listCases(owner.id)).json() as Json[];
    expect(cases[0]!.last_result).toEqual({
      run_id: newest!.id,
      status: 'pass',
      matched: 2,
      error: null,
    });
  });

  it('AC-28, AC-29: deleting a case removes only it and keeps the stored runs', async () => {
    const owner = await insertEvalAgent(db(), workspaceId);
    const pr = await newPull();
    const { findingId } = await insertDecidedFinding(db(), {
      prId: pr.id,
      agentId: owner.id,
      decision: 'dismissed',
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
      title: 'Delete me',
    });
    const caseId = ((await post(findingId)).json() as Json).id as string;
    const [run] = await db()
      .insert(t.evalRuns)
      .values({
        workspaceId,
        agentId: owner.id,
        agentVersion: 1,
        status: 'done',
        provider: 'openai',
        model: 'gpt-4.1',
        caseIds: [caseId],
        casesTotal: 1,
        results: [
          {
            case_id: caseId,
            case_name: 'no-delete-me',
            expectation_type: 'must_not_flag',
            status: 'pass',
            matched: 0,
            produced: 0,
            findings: [],
            error: null,
          },
        ],
      })
      .returning();

    const del = await app.inject({ method: 'DELETE', url: `/eval-cases/${caseId}` });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true });
    expect((await listCases(owner.id)).json()).toEqual([]);
    expect((await app.inject({ method: 'DELETE', url: `/eval-cases/${caseId}` })).statusCode).toBe(
      404,
    );
    const [kept] = await db().select().from(t.evalRuns).where(eq(t.evalRuns.id, run!.id));
    expect(kept!.results[0]!.case_name).toBe('no-delete-me');
  });

  it('AC-30: deleting an agent deletes its cases and its runs, and only its own', async () => {
    const doomed = await insertEvalAgent(db(), workspaceId);
    const spared = await insertEvalAgent(db(), workspaceId);
    const caseIds: string[] = [];
    for (const [owner, title] of [
      [doomed, 'Doomed case'],
      [spared, 'Spared case'],
    ] as const) {
      const pr = await newPull();
      const { findingId } = await insertDecidedFinding(db(), {
        prId: pr.id,
        agentId: owner.id,
        decision: 'accepted',
        file: 'src/config.ts',
        startLine: 11,
        endLine: 11,
        title,
      });
      caseIds.push(((await post(findingId)).json() as Json).id as string);
    }
    await db().insert(t.evalRuns).values({
      workspaceId,
      agentId: doomed.id,
      agentVersion: 1,
      status: 'done',
      provider: 'openai',
      model: 'gpt-4.1',
    });

    const del = await app.inject({ method: 'DELETE', url: `/agents/${doomed.id}` });
    expect(del.statusCode).toBe(200);

    expect(
      await db().select().from(t.evalCases).where(eq(t.evalCases.ownerId, doomed.id)),
    ).toHaveLength(0);
    expect(
      await db().select().from(t.evalRuns).where(eq(t.evalRuns.agentId, doomed.id)),
    ).toHaveLength(0);
    expect(
      await db().select().from(t.evalCases).where(eq(t.evalCases.id, caseIds[1]!)),
    ).toHaveLength(1);
  });

  it('AC-97: none of these routes called a model', () => {
    expect(openai.calls).toEqual([]);
    expect(anthropic.calls).toEqual([]);
  });
});
