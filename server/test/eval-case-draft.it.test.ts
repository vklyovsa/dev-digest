import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import {
  findingCaseBody,
  insertDecidedFinding,
  insertEvalAgent,
  insertFindingBornCase,
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

const PATCH_OF = (part: string) => part.split('\n').slice(3).join('\n').trimEnd();

type App = Awaited<ReturnType<typeof buildApp>>;
type Json = Record<string, unknown>;

d('eval case draft (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: App;
  let workspaceId: string;
  let agentId: string;
  let agentName: string;
  const openai = new MockLLMProvider('openai');
  let seq = 0;

  const db = () => pg.handle.db;

  async function newPull(owner = workspaceId, parts: [string, string][] = [
    ['src/a.ts', A_PART],
    ['src/config.ts', CONFIG_PART],
    ['src/b.ts', B_PART],
  ]) {
    const name = `draft-repo-${seq++}`;
    const [repo] = await db()
      .insert(t.repos)
      .values({ workspaceId: owner, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db()
      .insert(t.pullRequests)
      .values({
        workspaceId: owner,
        repoId: repo!.id,
        number: 600 + seq,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 3,
        deletions: 0,
        filesCount: parts.length,
        status: 'needs_review',
        body: 'Add rate limiting. Closes #471.',
      })
      .returning();
    await db()
      .insert(t.prFiles)
      .values(
        parts.map(([path, part]) => ({
          prId: pr!.id,
          path,
          additions: 1,
          deletions: 0,
          patch: PATCH_OF(part),
        })),
      );
    return pr!;
  }

  async function configFinding(
    decision: 'accepted' | 'dismissed' | 'undecided',
    over: { title?: string; startLine?: number; endLine?: number; file?: string; owner?: string | null } = {},
  ) {
    const pr = await newPull();
    const ids = await insertDecidedFinding(db(), {
      prId: pr.id,
      agentId: over.owner === undefined ? agentId : over.owner,
      decision,
      file: over.file ?? 'src/config.ts',
      startLine: over.startLine ?? 11,
      endLine: over.endLine ?? 11,
      ...(over.title ? { title: over.title } : {}),
    });
    return { pr, ...ids };
  }

  const draft = (findingId: string) =>
    app.inject({ method: 'GET', url: `/findings/${findingId}/eval-case-draft` });
  const codeOf = (res: { json(): unknown }) => (res.json() as { error: { code: string } }).error.code;
  const counts = async () => ({
    cases: (await db().select().from(t.evalCases)).length,
    runs: (await db().select().from(t.evalRuns)).length,
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
        git: new MockGitClient({ diff: A_PART + CONFIG_PART + B_PART }),
        secrets: new MockSecretsProvider({}),
        github: new MockGitHubClient(),
        llm: { openai },
      },
    });
    const agent = await insertEvalAgent(db(), workspaceId);
    agentId = agent.id;
    agentName = agent.name;
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('AC-12, AC-13, AC-14, AC-15: an accepted finding drafts a must_find case of its file alone', async () => {
    const { findingId, pr } = await configFinding('accepted', {
      title: 'Hardcoded Stripe secret key in commit',
    });
    const res = await draft(findingId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { agent: Json; case: unknown; draft: Json };
    expect(body.case).toBeNull();
    expect(body.agent).toEqual({ id: agentId, name: agentName });
    expect(body.draft).toMatchObject({
      expectation_type: 'must_find',
      name: 'must-find-hardcoded-stripe-secret-key-in-com',
      input_diff: CONFIG_PART,
      problem: null,
      input_meta: {
        pr_number: pr.number,
        pr_title: 'Add rate limiting',
        pr_author: 'marisa.koch',
        pr_body: 'Add rate limiting. Closes #471.',
      },
      expected_output: {
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
      },
    });
    expect(body.draft.input_diff).not.toContain('src/a.ts');
    expect(body.draft.input_diff).not.toContain('src/b.ts');
  });

  it('AC-12: a dismissed finding drafts a must_not_flag case', async () => {
    const { findingId } = await configFinding('dismissed', { title: 'Missing rate limit!' });
    const body = (await draft(findingId)).json() as { draft: Json };
    expect(body.draft).toMatchObject({ expectation_type: 'must_not_flag', name: 'no-missing-rate-limit-' });
  });

  it('AC-16, NFR-1: a draft writes no row and calls no model', async () => {
    const { findingId } = await configFinding('accepted', { title: 'Read only' });
    const before = await counts();
    const calls = openai.calls.length;
    expect((await draft(findingId)).statusCode).toBe(200);
    expect((await draft(findingId)).statusCode).toBe(200);
    expect(await counts()).toEqual(before);
    expect(openai.calls).toHaveLength(calls);
  });

  it('AC-17, AC-18, AC-19: undecided, ownerless and foreign findings are refused', async () => {
    const undecided = await configFinding('undecided');
    const undecidedRes = await draft(undecided.findingId);
    expect(undecidedRes.statusCode).toBe(400);
    expect(codeOf(undecidedRes)).toBe('finding_undecided');

    const noAgent = await configFinding('accepted', { owner: null });
    const gone = await insertEvalAgent(db(), workspaceId);
    const orphan = await configFinding('accepted', { owner: gone.id });
    await db().delete(t.agents).where(eq(t.agents.id, gone.id));
    for (const { findingId } of [noAgent, orphan]) {
      const res = await draft(findingId);
      expect(res.statusCode).toBe(400);
      expect(codeOf(res)).toBe('eval_owner_missing');
    }

    const [other] = await db().insert(t.workspaces).values({ name: 'other draft' }).returning();
    const otherAgent = await insertEvalAgent(db(), other!.id);
    const otherPr = await newPull(other!.id);
    const foreign = await insertDecidedFinding(db(), {
      prId: otherPr.id,
      agentId: otherAgent.id,
      decision: 'accepted',
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
    });
    expect((await draft(foreign.findingId)).statusCode).toBe(404);
    expect((await draft('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
  });

  it('AC-20: a finding with a case answers with that case and its last result, whatever its decision', async () => {
    const { findingId, reviewId } = await configFinding('accepted', { title: 'Has a case' });
    const created = await app.inject({
      method: 'POST',
      url: `/findings/${findingId}/eval-case`,
      payload: await findingCaseBody(app, findingId),
    });
    expect(created.statusCode).toBe(201);
    const stored = created.json() as Json;
    const [run] = await db()
      .insert(t.evalRuns)
      .values({
        workspaceId,
        agentId,
        agentVersion: 1,
        status: 'done',
        provider: 'openai',
        model: 'gpt-4.1',
        caseIds: [stored.id as string],
        casesTotal: 1,
        casesPassed: 1,
        results: [
          {
            case_id: stored.id,
            case_name: stored.name,
            case_revision: 1,
            expectation_type: 'must_find',
            status: 'pass',
            matched: 1,
            findings: [],
            error: null,
            produced: 1,
          },
        ] as never,
      })
      .returning();
    await db()
      .update(t.findings)
      .set({ acceptedAt: null, dismissedAt: new Date() })
      .where(eq(t.findings.id, findingId));
    void reviewId;

    const res = await draft(findingId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { draft: unknown; case: Json; agent: Json };
    expect(body.draft).toBeNull();
    expect(body.agent.id).toBe(agentId);
    const list = (await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-cases` })).json() as Json[];
    expect(body.case).toEqual(list.find((c) => c.id === stored.id));
    expect((body.case.last_result as Json).run_id).toBe(run!.id);
  });

  it('AC-21: a finding whose file the diff lacks drafts an empty diff and file_not_in_diff', async () => {
    const { findingId } = await configFinding('accepted', { file: 'src/missing.ts' });
    const res = await draft(findingId);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { draft: Json }).draft).toMatchObject({
      input_diff: '',
      problem: 'file_not_in_diff',
    });
  });

  it('AC-22: lines outside every hunk draft the file diff and lines_outside_diff', async () => {
    const { findingId } = await configFinding('accepted', { startLine: 40, endLine: 44 });
    const res = await draft(findingId);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { draft: Json }).draft).toMatchObject({
      input_diff: CONFIG_PART,
      problem: 'lines_outside_diff',
    });
  });

  it('NFR-5: a non-uuid finding id is 422', async () => {
    expect((await draft('not-a-uuid')).statusCode).toBe(422);
  });

  it('NFR-9, EC-19: a case born from a finding comes back as the case', async () => {
    const owner = await insertEvalAgent(db(), workspaceId);
    const born = await insertFindingBornCase(db(), workspaceId, owner.id);
    const res = await draft(born.sourceFindingId!);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { draft: unknown; case: Json };
    expect(body.draft).toBeNull();
    expect(body.case.id).toBe(born.id);
    expect(body.case.name).toBe('must-find-born');
  });
});
