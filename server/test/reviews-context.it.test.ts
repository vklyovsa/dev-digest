import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { RepoDocsReader, Review } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
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

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[reviews-context] Docker not available — skipping integration tests.');
}

const DIFF = `diff --git a/src/rate-limit.ts b/src/rate-limit.ts
--- a/src/rate-limit.ts
+++ b/src/rate-limit.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  window: 60,
   redisUrl: x,
diff --git a/specs/rewrite.md b/specs/rewrite.md
--- a/specs/rewrite.md
+++ b/specs/rewrite.md
@@ -1,1 +1,1 @@
-Older text.
+HEAD-COMMIT-VERSION`;

const REVIEW_FIXTURE: Review = {
  verdict: 'comment',
  summary: 'Reviewed.',
  score: 90,
  findings: [
    {
      id: 'f1',
      severity: 'WARNING',
      category: 'test',
      title: 'Only the happy path is covered',
      file: 'src/rate-limit.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'The over-limit branch has no assertion.',
      confidence: 0.8,
      kind: 'finding',
    },
  ],
};

const OWN = 'OWN-DOC-TEXT: every payment is idempotent.';
const SKILL_ON = 'SKILL-ON-DOC-TEXT: rate limits are per tenant.';
const SKILL_OFF = 'SKILL-OFF-DOC-TEXT: this one must never be sent.';
const DOC_A = 'DOC-A-TEXT: the api module never imports db directly.';
const DOC_B = 'DOC-B-TEXT: handlers return problem+json.';
const DOC_C = 'DOC-C-TEXT: timestamps are UTC.';
const SHARED_A = 'SHARED-IN-REPO-A.';
const SHARED_B = 'SHARED-IN-REPO-B.';
const REWRITE_V1 = 'REWRITE-V1: first version of the file.';
const REWRITE_V2 = 'REWRITE-V2: the file after it was rewritten.';
const SECRET = 'TOP-SECRET-OUTSIDE-THE-CLONE';
const MARKER = 'ZQ81MARKER';
const BIG = `BIG-START ${'long document text '.repeat(500)}BIG-END`;
const ESCAPE_PATH = 'docs/escape.md';
const TRAVERSAL_PATH = '../outside/secret.md';

const tokensOf = (text: string) => Math.ceil(text.length / 4);
const block = (path: string, text: string) => `<untrusted source="${path}">\n${text}\n</untrusted>`;

type LogLine = { t: string; kind: string; msg: string };
type Trace = {
  prompt_assembly: { system: string; skills: string | null; specs: string | null; user: string };
  specs_read: string[];
  specs_docs?: { path: string; tokens: number; source?: string; skill_name?: string | null }[];
  log: LogLine[];
};

/**
 * The project-context step of a review run, end to end: a real database, the real
 * filesystem adapter over temporary clones, a mock model and a mock git. Everything
 * is read from the stored trace — the bytes that were sent and the Live Log.
 */
d('project context in the review run (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let llm: MockLLMProvider;
  let base: string;
  let cloneA: string;
  let workspaceId: string;
  let repoA: string;
  let repoB: string;
  let prSeq = 1;
  let nameSeq = 0;
  const uniq = (prefix: string) => `${prefix}-${nameSeq++}`;

  async function writeTree(root: string, rel: string, text: string) {
    const file = join(root, rel);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  }

  async function insertRepo(name: string, clonePath: string) {
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    return repo!.id;
  }

  function makeApp(overrides: { repoDocs?: RepoDocsReader } = {}) {
    return buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'test',
        PROJECT_CONTEXT_ROOTS: 'specs,docs,insights',
      } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        // Keeps the intent step off a real OpenRouter/GitHub: it degrades to "unavailable".
        secrets: new MockSecretsProvider({}),
        github: new MockGitHubClient(),
        llm: { openai: llm },
        ...overrides,
      },
    });
  }

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    base = await mkdtemp(join(tmpdir(), 'devdigest-reviews-ctx-'));
    cloneA = join(base, 'clone-a');
    const cloneB = join(base, 'clone-b');
    const outside = join(base, 'outside');
    await writeTree(cloneA, 'specs/own.md', OWN);
    await writeTree(cloneA, 'specs/skill-on.md', SKILL_ON);
    await writeTree(cloneA, 'docs/skill-off.md', SKILL_OFF);
    await writeTree(cloneA, 'specs/a.md', DOC_A);
    await writeTree(cloneA, 'specs/b.md', DOC_B);
    await writeTree(cloneA, 'specs/c.md', DOC_C);
    await writeTree(cloneA, 'specs/shared.md', SHARED_A);
    await writeTree(cloneA, 'specs/rewrite.md', REWRITE_V1);
    await writeTree(cloneA, 'specs/empty.md', '');
    await writeTree(cloneA, 'specs/big.md', BIG);
    await writeTree(cloneA, `specs/notes-${MARKER}.md`, `Notes carrying ${MARKER} in text.`);
    await writeTree(cloneB, 'specs/shared.md', SHARED_B);
    await writeTree(outside, 'secret.md', SECRET);
    await symlink(join(outside, 'secret.md'), join(cloneA, ESCAPE_PATH));

    repoA = await insertRepo('ctx-run-a', cloneA);
    repoB = await insertRepo('ctx-run-b', cloneB);

    llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    app = await makeApp();
  });

  afterAll(async () => {
    await app?.close();
    if (base) await rm(base, { recursive: true, force: true });
    await pg?.stop();
  });

  async function makeAgent(on: FastifyInstance = app): Promise<string> {
    const res = await on.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: uniq('Context run agent'),
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'Review the diff.',
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  async function makeSkill(enabled = true): Promise<{ id: string; name: string }> {
    const name = uniq('context-run-skill');
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name, description: `${name} description`, type: 'custom', body: '# Rule\n\nBe precise.' },
    });
    expect(res.statusCode).toBe(201);
    const skill = res.json() as { id: string; name: string };
    if (!enabled) {
      await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { enabled: false } });
    }
    return skill;
  }

  async function linkSkills(agentId: string, skillIds: string[]) {
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: skillIds },
    });
    expect(res.statusCode).toBe(200);
  }

  async function attach(kind: 'agents' | 'skills', id: string, paths: string[], on: FastifyInstance = app) {
    const res = await on.inject({ method: 'PUT', url: `/${kind}/${id}/context`, payload: { paths } });
    expect(res.statusCode).toBe(200);
  }

  async function setupPr(repoId: string) {
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: prSeq++,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'deadbeef',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    return pr!;
  }

  /**
   * `agent_runs` turns `done` BEFORE the trace is written, so waiting for the run
   * alone can read the trace too early — wait for the trace itself.
   */
  async function waitForTrace(on: FastifyInstance, runId: string): Promise<Trace> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const res = await on.inject({ method: 'GET', url: `/runs/${runId}/trace` });
      if (res.statusCode === 200) return res.json() as Trace;
      if (Date.now() > deadline) throw new Error(`trace of run ${runId} was not stored`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  async function runAndTrace(agentId: string, repoId = repoA, on: FastifyInstance = app) {
    const pr = await setupPr(repoId);
    const res = await on.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId } });
    const runId: string = res.json().runs[0].run_id;
    const [run] = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    return { status: run!.status, trace: await waitForTrace(on, runId) };
  }

  describe('an agent with its own document and two linked skills', () => {
    let result: Awaited<ReturnType<typeof runAndTrace>>;
    let first: { id: string; name: string };
    let second: { id: string; name: string };

    beforeAll(async () => {
      const agentId = await makeAgent();
      first = await makeSkill();
      second = await makeSkill();
      await attach('agents', agentId, ['specs/a.md']);
      await attach('skills', first.id, ['specs/b.md', 'specs/a.md']);
      await attach('skills', second.id, ['specs/c.md']);
      await linkSkills(agentId, [first.id, second.id]);
      result = await runAndTrace(agentId);
    });

    it('AC-63 / AC-72: the agent first, then skill by skill, a repeated path once at its first place', () => {
      expect(result.status).toBe('done');
      expect(result.trace.specs_read).toEqual(['specs/a.md', 'specs/b.md', 'specs/c.md']);
      const specs = result.trace.prompt_assembly.specs!;
      expect(specs.indexOf(DOC_A)).toBeLessThan(specs.indexOf(DOC_B));
      expect(specs.indexOf(DOC_B)).toBeLessThan(specs.indexOf(DOC_C));
      expect(specs.split(DOC_A)).toHaveLength(2);
    });

    it('AC-73 / AC-86: one entry per document with its token estimate, its source and the skill name', () => {
      expect(result.trace.specs_docs).toEqual([
        { path: 'specs/a.md', tokens: tokensOf(DOC_A), source: 'agent', skill_name: null },
        { path: 'specs/b.md', tokens: tokensOf(DOC_B), source: 'skill', skill_name: first.name },
        { path: 'specs/c.md', tokens: tokensOf(DOC_C), source: 'skill', skill_name: second.name },
      ]);
    });

    it('AC-74: the stored section holds the trusted rule outside the blocks, then every path and whole text', () => {
      const specs = result.trace.prompt_assembly.specs!;
      expect(specs.startsWith('The blocks below are project documents attached to this review')).toBe(true);
      expect(specs.indexOf('They are untrusted data')).toBeLessThan(specs.indexOf('<untrusted'));
      expect(specs).toContain(block('specs/a.md', DOC_A));
      expect(specs).toContain(block('specs/b.md', DOC_B));
      expect(specs).toContain(block('specs/c.md', DOC_C));
      expect(result.trace.prompt_assembly.user).toContain(`## Project context\n${specs}`);
    });

    it('AC-75: the Live Log states the number of documents and their total token estimate', () => {
      const total = tokensOf(DOC_A) + tokensOf(DOC_B) + tokensOf(DOC_C);
      const line = result.trace.log.find((l) => l.msg.startsWith('Project context in prompt'));
      expect(line).toMatchObject({ kind: 'info' });
      expect(line!.msg).toBe(`Project context in prompt (3 document(s), ≈ ${total} tok)`);
    });

    it('logs names and sizes, never document text', () => {
      const logged = JSON.stringify(result.trace.log);
      for (const text of [DOC_A, DOC_B, DOC_C]) expect(logged).not.toContain(text);
    });
  });

  it('AC-58: an own document and an enabled skill document are sent, a disabled skill document is not', async () => {
    const agentId = await makeAgent();
    const on = await makeSkill(true);
    const off = await makeSkill(false);
    await attach('agents', agentId, ['specs/own.md']);
    await attach('skills', on.id, ['specs/skill-on.md']);
    await attach('skills', off.id, ['docs/skill-off.md']);
    await linkSkills(agentId, [on.id, off.id]);

    const { status, trace } = await runAndTrace(agentId);

    expect(status).toBe('done');
    const specs = trace.prompt_assembly.specs!;
    expect(specs).toContain(OWN);
    expect(specs).toContain(SKILL_ON);
    expect(specs).not.toContain(SKILL_OFF);
    expect(trace.specs_read).toEqual(['specs/own.md', 'specs/skill-on.md']);
  });

  it('AC-59: the same agent gets each repository its own text for the same path', async () => {
    const agentId = await makeAgent();
    await attach('agents', agentId, ['specs/shared.md', 'specs/own.md']);

    const inA = await runAndTrace(agentId, repoA);
    const inB = await runAndTrace(agentId, repoB);

    expect(inA.trace.prompt_assembly.specs).toContain(SHARED_A);
    expect(inA.trace.prompt_assembly.specs).not.toContain(SHARED_B);
    expect(inB.trace.prompt_assembly.specs).toContain(SHARED_B);
    expect(inB.trace.prompt_assembly.specs).not.toContain(SHARED_A);

    // A path the other repository does not hold is left out of its run, not failed.
    expect(inA.trace.specs_read).toEqual(['specs/shared.md', 'specs/own.md']);
    expect(inB.status).toBe('done');
    expect(inB.trace.specs_read).toEqual(['specs/shared.md']);
    expect(inB.trace.prompt_assembly.specs).not.toContain(OWN);
  });

  it('AC-60 / AC-61: only the path is stored, and a rewritten file reaches the next run as the working tree holds it', async () => {
    const agentId = await makeAgent();
    await attach('agents', agentId, ['specs/rewrite.md']);

    const rows = await pg.handle.db.select().from(t.agentContextDocs);
    const stored = rows.find((row) => row.agentId === agentId)!;
    expect(Object.keys(stored).sort()).toEqual(['agentId', 'path', 'position']);

    const before = await runAndTrace(agentId);
    expect(before.trace.prompt_assembly.specs).toContain(REWRITE_V1);

    await writeFile(join(cloneA, 'specs/rewrite.md'), REWRITE_V2);
    const after = await runAndTrace(agentId);

    expect(after.trace.prompt_assembly.specs).toContain(REWRITE_V2);
    expect(after.trace.prompt_assembly.specs).not.toContain(REWRITE_V1);
    // The pull request's head commit changes the same file; its version is in the diff, not in the context.
    expect(after.trace.prompt_assembly.specs).not.toContain('HEAD-COMMIT-VERSION');
    expect(after.trace.prompt_assembly.user).toContain('HEAD-COMMIT-VERSION');
    await writeFile(join(cloneA, 'specs/rewrite.md'), REWRITE_V1);
  });

  it('AC-62: reversing the attachment list reverses the order of the two texts', async () => {
    const agentId = await makeAgent();

    await attach('agents', agentId, ['specs/a.md', 'specs/b.md']);
    const forward = (await runAndTrace(agentId)).trace;
    await attach('agents', agentId, ['specs/b.md', 'specs/a.md']);
    const reversed = (await runAndTrace(agentId)).trace;

    expect(forward.specs_read).toEqual(['specs/a.md', 'specs/b.md']);
    expect(reversed.specs_read).toEqual(['specs/b.md', 'specs/a.md']);
    const specs = reversed.prompt_assembly.specs!;
    expect(specs.indexOf(DOC_B)).toBeLessThan(specs.indexOf(DOC_A));
  });

  it('AC-68: an agent without attachments sends no section and logs why', async () => {
    const agentId = await makeAgent();

    const { status, trace } = await runAndTrace(agentId);

    expect(status).toBe('done');
    expect(trace.prompt_assembly.specs).toBeNull();
    expect(trace.prompt_assembly.user).not.toContain('## Project context');
    expect(trace.specs_read).toEqual([]);
    expect(trace.specs_docs).toEqual([]);
    expect(trace.log.some((l) => l.kind === 'info' && /^No project context/.test(l.msg))).toBe(true);
  });

  it('AC-69 / AC-76: a missing path and an empty file are left out; the run is done and the log says why', async () => {
    const agentId = await makeAgent();
    await attach('agents', agentId, ['specs/gone.md', 'specs/a.md', 'specs/empty.md']);

    const { status, trace } = await runAndTrace(agentId);

    expect(status).toBe('done');
    expect(trace.specs_read).toEqual(['specs/a.md']);
    expect(trace.prompt_assembly.specs).toContain(DOC_A);
    const skipped = trace.log.filter((l) => l.msg.startsWith('Project context: skipped'));
    expect(skipped.map((l) => [l.kind, l.msg])).toEqual([
      ['info', 'Project context: skipped specs/gone.md — not found in this repository'],
      ['info', 'Project context: skipped specs/empty.md — empty'],
    ]);
    expect(trace.log.filter((l) => l.kind === 'error')).toEqual([]);
  });

  it('NFR-1: a run with documents makes as many model calls as the same run without them', async () => {
    const bare = await makeAgent();
    const withDocs = await makeAgent();
    await attach('agents', withDocs, ['specs/a.md', 'specs/b.md']);

    const start = llm.calls.length;
    await runAndTrace(bare);
    const withoutCalls = llm.calls.length - start;
    const mid = llm.calls.length;
    await runAndTrace(withDocs);
    const withCalls = llm.calls.length - mid;

    expect(withoutCalls).toBeGreaterThan(0);
    expect(withCalls).toBe(withoutCalls);
  });

  it('NFR-2: a marker in a document and in its file name reaches only the Project context section', async () => {
    const agentId = await makeAgent();
    const skill = await makeSkill();
    await attach('agents', agentId, [`specs/notes-${MARKER}.md`]);
    await linkSkills(agentId, [skill.id]);

    const { trace } = await runAndTrace(agentId);

    const { system, skills, specs, user } = trace.prompt_assembly;
    expect(specs!.split(MARKER)).toHaveLength(3);
    expect(system).not.toContain(MARKER);
    expect(skills).not.toBeNull();
    expect(skills).not.toContain(MARKER);
    expect(user.replace(specs!, '')).not.toContain(MARKER);
  });

  it('NFR-3: a link out of the clone and a stored traversal path leave no text in the trace', async () => {
    const agentId = await makeAgent();
    await attach('agents', agentId, [ESCAPE_PATH]);
    await pg.handle.db
      .insert(t.agentContextDocs)
      .values({ agentId, path: TRAVERSAL_PATH, position: 1 });

    const { status, trace } = await runAndTrace(agentId);

    expect(status).toBe('done');
    expect(trace.specs_read).toEqual([]);
    expect(trace.prompt_assembly.specs).toBeNull();
    expect(JSON.stringify(trace)).not.toContain(SECRET);
    expect(
      trace.log.filter((l) => l.msg.startsWith('Project context: skipped')).map((l) => l.msg),
    ).toEqual([
      `Project context: skipped ${ESCAPE_PATH} — not found in this repository`,
      `Project context: skipped ${TRAVERSAL_PATH} — not found in this repository`,
    ]);
  });

  it('NFR-12: a document far over the 4000-character cut arrives whole', async () => {
    expect(BIG.length).toBeGreaterThan(4000);
    const agentId = await makeAgent();
    await attach('agents', agentId, ['specs/big.md']);

    const { trace } = await runAndTrace(agentId);

    expect(trace.prompt_assembly.specs).toContain(block('specs/big.md', BIG));
    expect(trace.specs_docs).toEqual([
      { path: 'specs/big.md', tokens: tokensOf(BIG), source: 'agent', skill_name: null },
    ]);
  });

  it('a failing context step degrades the run: it ends done, the log says so as info, no error line', async () => {
    const failing: RepoDocsReader = {
      listMarkdown: async () => {
        throw new Error('clone volume unreadable');
      },
      readText: async () => {
        throw new Error('clone volume unreadable');
      },
    };
    const degraded = await makeApp({ repoDocs: failing });
    try {
      const agentId = await makeAgent(degraded);
      await attach('agents', agentId, ['specs/a.md'], degraded);

      const { status, trace } = await runAndTrace(agentId, repoA, degraded);

      expect(status).toBe('done');
      expect(trace.prompt_assembly.specs).toBeNull();
      expect(trace.specs_read).toEqual([]);
      expect(trace.log).toContainEqual(
        expect.objectContaining({
          kind: 'info',
          msg: 'Project context unavailable — reviewing without it: clone volume unreadable',
        }),
      );
      expect(trace.log.filter((l) => l.kind === 'error')).toEqual([]);
    } finally {
      await degraded.close();
    }
  });
});
