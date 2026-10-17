import { eq } from 'drizzle-orm';
import * as t from '../../src/db/schema.js';
import type { buildApp } from '../../src/app.js';
import type { StructuredRequest, StructuredResult } from '@devdigest/shared';
import { MockLLMProvider } from '../../src/adapters/mocks.js';
import type { PgFixture } from './pg.js';

type TestDb = PgFixture['handle']['db'];
type TestApp = Awaited<ReturnType<typeof buildApp>>;

let agentSeq = 0;

export async function insertEvalAgent(
  db: TestDb,
  workspaceId: string,
  overrides: Partial<typeof t.agents.$inferInsert> = {},
): Promise<typeof t.agents.$inferSelect> {
  const [agent] = await db
    .insert(t.agents)
    .values({
      workspaceId,
      name: `Eval agent ${agentSeq++}`,
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'You are a reviewer.',
      ...overrides,
    })
    .returning();
  return agent!;
}

let skillSeq = 0;

/** A `skills` row plus its `skill_versions` row for version 1, as the skills module writes them. */
export async function insertEvalSkill(
  db: TestDb,
  workspaceId: string,
  over: Partial<typeof t.skills.$inferInsert> = {},
): Promise<typeof t.skills.$inferSelect> {
  const [skill] = await db
    .insert(t.skills)
    .values({
      workspaceId,
      name: `Eval skill ${skillSeq++}`,
      description: 'A skill under eval.',
      type: 'rubric',
      source: 'manual',
      body: 'Flag hardcoded secrets.',
      ...over,
    })
    .returning();
  await db.insert(t.skillVersions).values({ skillId: skill!.id, version: skill!.version, body: skill!.body });
  return skill!;
}

export interface SkillRunInput extends Partial<typeof t.evalRuns.$inferInsert> {
  workspaceId: string;
  skillId: string;
  hostAgentId: string;
  status: 'running' | 'done' | 'failed';
}

/** A run of a skill's case set, hosted by an agent: `agent_id` is the host. */
export async function insertSkillRun(
  db: TestDb,
  { hostAgentId, ...input }: SkillRunInput,
): Promise<typeof t.evalRuns.$inferSelect> {
  const [run] = await db
    .insert(t.evalRuns)
    .values({
      agentVersion: 1,
      skillVersion: 1,
      provider: 'openai',
      model: 'gpt-4.1',
      ...input,
      agentId: hostAgentId,
    })
    .returning();
  return run!;
}

export interface DecidedFindingInput {
  prId: string;
  agentId: string | null;
  decision: 'accepted' | 'dismissed' | 'undecided';
  file: string;
  startLine: number;
  endLine: number;
  title?: string;
  severity?: string;
  category?: string;
}

/** Inserts a review of the pull request and one finding of it, decided as asked. */
export async function insertDecidedFinding(
  db: TestDb,
  input: DecidedFindingInput,
): Promise<{ reviewId: string; findingId: string }> {
  const [pull] = await db.select().from(t.pullRequests).where(eq(t.pullRequests.id, input.prId));
  const [review] = await db
    .insert(t.reviews)
    .values({
      workspaceId: pull!.workspaceId,
      prId: input.prId,
      agentId: input.agentId,
      kind: 'review',
      verdict: 'request_changes',
      summary: 'A review.',
      score: 50,
      model: 'gpt-4.1',
    })
    .returning();
  const decidedAt = new Date();
  const [finding] = await db
    .insert(t.findings)
    .values({
      reviewId: review!.id,
      file: input.file,
      startLine: input.startLine,
      endLine: input.endLine,
      severity: input.severity ?? 'CRITICAL',
      category: input.category ?? 'security',
      title: input.title ?? 'Hardcoded Stripe secret key',
      rationale: 'A live key is committed in source.',
      confidence: 0.9,
      acceptedAt: input.decision === 'accepted' ? decidedAt : null,
      dismissedAt: input.decision === 'dismissed' ? decidedAt : null,
    })
    .returning();
  return { reviewId: review!.id, findingId: finding!.id };
}

/** Polls `GET /eval-runs/:id` until the run is no longer `running`; returns its last body. */
export async function waitForEvalRun(
  app: TestApp,
  runId: string,
  timeoutMs = 20_000,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  for (;;) {
    const res = await app.inject({ method: 'GET', url: `/eval-runs/${runId}` });
    const body = res.json() as Record<string, unknown>;
    if (res.statusCode !== 200 || body.status !== 'running') return body;
    if (Date.now() - start > timeoutMs) return body;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export const MANUAL_DIFF_TWO_GIT_FILES = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,3 +10,4 @@
 const a = 1;
+const a2 = 2;
 export { a };
 const tail = 0;
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -5,2 +5,3 @@
 const b = 1;
+const b2 = 2;
 export { b };
`;

export const MANUAL_DIFF_TWO_PLAIN_FILES = `--- a/src/c.ts
+++ b/src/c.ts
@@ -1,2 +1,3 @@
 const c = 1;
+const c2 = 2;
 export { c };
--- a/src/d.ts
+++ b/src/d.ts
@@ -7,2 +7,3 @@
 const d = 1;
+const d2 = 2;
 export { d };
`;

/** A valid body for `POST /agents/:id/eval-cases`: one file, one hunk of lines 10-13. */
export function manualCaseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'manual-case',
    expectation_type: 'must_find',
    input_diff: MANUAL_DIFF_TWO_GIT_FILES,
    input_meta: { pr_title: 'Add a2', pr_body: 'Adds a2.' },
    expected_output: {
      file: 'src/a.ts',
      start_line: 11,
      end_line: 11,
      title: 'A new constant',
      severity: 'WARNING',
      category: 'bug',
    },
    ...overrides,
  };
}

/** Answers every structured call with "no findings" and records it in `calls`. */
export class SilentEvalLLM extends MockLLMProvider {
  constructor() {
    super('openai');
  }

  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
    return {
      data: { verdict: 'comment', summary: 'ok', score: 90, findings: [] } as T,
      model: req.model,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.001,
      costBilledUsd: 0,
      costEstimatedUsd: 0.001,
      raw: '{}',
      attempts: 1,
    };
  }
}

/**
 * A case born from an accepted finding, stored as `createCaseFromFinding` stores
 * it: a pull request number and author, and the finding's id.
 */
export async function insertFindingBornCase(
  db: TestDb,
  workspaceId: string,
  agentId: string,
): Promise<typeof t.evalCases.$inferSelect> {
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name: `born-${agentSeq}`, fullName: `acme/born-${agentSeq++}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 701,
      title: 'Add a2',
      author: 'marisa.koch',
      branch: 'feat/a',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Adds a2.',
    })
    .returning();
  const { findingId } = await insertDecidedFinding(db, {
    prId: pr!.id,
    agentId,
    decision: 'accepted',
    file: 'src/a.ts',
    startLine: 11,
    endLine: 11,
  });
  const [row] = await db
    .insert(t.evalCases)
    .values({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: 'must-find-born',
      expectationType: 'must_find',
      expectedOutput: {
        file: 'src/a.ts',
        start_line: 11,
        end_line: 11,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
      },
      inputDiff: MANUAL_DIFF_TWO_GIT_FILES,
      inputFiles: ['src/a.ts', 'src/b.ts'],
      inputMeta: { pr_number: 701, pr_title: 'Add a2', pr_author: 'marisa.koch', pr_body: 'Adds a2.' },
      sourceFindingId: findingId,
    })
    .returning();
  return row!;
}

/**
 * The body `POST /findings/:id/eval-case` needs, read from the draft route. A
 * finding without a draft (it has a case, is undecided, or does not exist) gets a
 * schema-valid manual body, so the route under test answers with its own error.
 */
export async function findingCaseBody(
  app: TestApp,
  findingId: string,
): Promise<Record<string, unknown>> {
  const res = await app.inject({ method: 'GET', url: `/findings/${findingId}/eval-case-draft` });
  const draft = res.statusCode === 200 ? (res.json() as { draft: Record<string, any> | null }).draft : null;
  if (!draft || draft.input_diff === '') return manualCaseBody();
  return {
    name: draft.name,
    input_diff: draft.input_diff,
    input_meta: { pr_title: draft.input_meta.pr_title, pr_body: draft.input_meta.pr_body },
    expected_output: draft.expected_output,
  };
}
