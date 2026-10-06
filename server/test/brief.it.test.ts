import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  PrBriefResponse,
  type LLMProvider,
  type PrBriefAnswer,
  type PrBriefRecord,
  type StructuredRequest,
  type StructuredResult,
} from '@devdigest/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  MockGitHubClient,
  MockLLMProvider,
  MockRepoDocsReader,
  MockSecretsProvider,
  type MockLLMOptions,
} from '../src/adapters/mocks.js';
import type { BlastResult, IndexState, RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () =>
  loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    PROJECT_CONTEXT_ROOTS: 'specs,docs,insights',
  } as NodeJS.ProcessEnv);

const CLONE = '/clones/acme/brief';
const LOGIN = 'src/auth/login.ts';
const SESSION = 'src/api/session.ts';
const GHOST = 'src/invented/ghost.ts';
const INTENT_SENTENCE = 'Throttle login attempts per account.';
const DEFAULT_MODEL = 'minimax/minimax-m2.5';

const PATCH = ['@@ -10,3 +10,5 @@ function login() {', ' ctx();', '-old();', '+fresh();', '+more();', ' end();'].join(
  '\n',
);

const ANSWER: PrBriefAnswer = {
  summary: 'Adds login throttling.',
  risks: [
    {
      kind: 'security',
      title: 'Lockout bypass',
      explanation: 'The counter resets on restart.',
      severity: 'high',
      file_refs: [LOGIN, SESSION, GHOST],
    },
    {
      kind: 'compatibility',
      title: 'Invented only',
      explanation: 'Points at a file that is not there.',
      severity: 'low',
      file_refs: [GHOST],
    },
  ],
  review_focus: [
    { file: LOGIN, line: 11, reason: 'Check the counter reset.' },
    { file: GHOST, line: 1, reason: 'Not a file of the PR.' },
  ],
};

const BLAST_WITH_CALLER: BlastResult = {
  changedSymbols: [{ file: LOGIN, name: 'login', kind: 'function' }],
  callers: [{ file: SESSION, symbol: 'handler', viaSymbol: 'login', line: 12, rank: 0.8 }],
  impactedEndpoints: [],
  factsByFile: {},
  degraded: false,
};

const BLAST_EMPTY: BlastResult = {
  changedSymbols: [],
  callers: [],
  impactedEndpoints: [],
  factsByFile: {},
  degraded: false,
};

const INDEX_STATE: IndexState = {
  repoId: 'ignored',
  status: 'full',
  filesIndexed: 3,
  filesSkipped: 0,
  durationMs: 1,
  lastIndexedSha: 'idx123',
  indexerVersion: 2,
  updatedAt: new Date(0),
};

const TREE: Record<string, string> = {
  'specs/auth.md': 'DOC-AUTH-MARKER the auth spec.',
  'specs/empty.md': '',
  'docs/limits.md': 'DOC-LIMITS-MARKER the limits.',
  'docs/disabled.md': 'DOC-DISABLED-MARKER from a disabled skill.',
  'docs/unattached.md': 'DOC-UNATTACHED-MARKER nobody attached it.',
};

interface FileFixture {
  path: string;
  additions?: number;
  deletions?: number;
  patch?: string | null;
}

const DEFAULT_FILES: FileFixture[] = [
  { path: LOGIN, additions: 3, deletions: 1, patch: PATCH },
  { path: 'docs/notes.md', additions: 2, deletions: 0, patch: null },
];

/** Same as `MockLLMProvider`, plus a switch to fail and one to override the reported cost. */
class ScriptedLLM extends MockLLMProvider {
  failWith: Error | undefined;
  costUsd: number | null | undefined;

  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    if (this.failWith) {
      this.calls.push({ method: 'completeStructured', req });
      throw this.failWith;
    }
    const result = await super.completeStructured(req);
    return this.costUsd === undefined ? result : { ...result, costUsd: this.costUsd };
  }
}

function briefOf(res: LightMyRequestResponse): PrBriefRecord {
  const { brief } = PrBriefResponse.parse(res.json());
  if (!brief) throw new Error('expected a stored brief');
  return brief;
}

function structuredCalls(llm: MockLLMProvider): StructuredRequest<unknown>[] {
  return llm.calls
    .filter((call) => call.method === 'completeStructured')
    .map((call) => call.req as StructuredRequest<unknown>);
}

function userOf(req: StructuredRequest<unknown>): string {
  return req.messages.find((message) => message.role === 'user')!.content;
}

d('PR Brief routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let workspaceId: string;
  let seq = 0;

  let blastResult: BlastResult = BLAST_WITH_CALLER;
  let githubCalls = 0;
  const getBlastRadius = vi.fn(async (_repoId: string, _files: string[]) => blastResult);
  const repoIntel = {
    getBlastRadius,
    getIndexState: async () => INDEX_STATE,
  } as unknown as RepoIntel;

  const github = new Proxy(new MockGitHubClient(), {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        githubCalls++;
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  const repoDocs = new MockRepoDocsReader({ [CLONE]: TREE });
  // Without it the container reads the developer's real ~/.devdigest/secrets.json.
  const secrets = new MockSecretsProvider();

  const defaultOpts: MockLLMOptions = {};
  const otherOpts: MockLLMOptions = {};
  const defaultLlm = new ScriptedLLM('openai', defaultOpts);
  const otherLlm = new ScriptedLLM('openai', otherOpts);

  const overridesFor = (llm: Partial<Record<'openai' | 'anthropic' | 'openrouter', LLMProvider>>) => ({
    repoIntel,
    github,
    repoDocs,
    secrets,
    llm,
  });

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: overridesFor({ openrouter: defaultLlm, openai: otherLlm }),
    });
  });

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  beforeEach(async () => {
    const { db } = pg.handle;
    defaultOpts.structured = ANSWER;
    otherOpts.structured = ANSWER;
    for (const llm of [defaultLlm, otherLlm]) {
      llm.calls = [];
      llm.failWith = undefined;
      llm.costUsd = undefined;
    }
    blastResult = BLAST_WITH_CALLER;
    getBlastRadius.mockClear();
    githubCalls = 0;
    repoDocs.lists = [];
    repoDocs.reads = [];
    await db.delete(t.agentContextDocs);
    await db.delete(t.skillContextDocs);
    await db
      .delete(t.settings)
      .where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, 'feature_models')));
  });

  async function insertPr(
    opts: { files?: FileFixture[]; headSha?: string; workspace?: string } = {},
  ): Promise<string> {
    const { db } = pg.handle;
    const ws = opts.workspace ?? workspaceId;
    const name = `brief-${seq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}`, clonePath: CLONE })
      .returning();
    const files = opts.files ?? DEFAULT_FILES;
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 500 + seq,
        title: 'Throttle logins',
        body: 'Adds a limiter in front of the login handler.',
        author: 'marisa.koch',
        branch: 'feat/throttle',
        base: 'main',
        headSha: opts.headSha ?? 'a1b2c3d4',
        additions: 5,
        deletions: 1,
        filesCount: files.length,
        status: 'open',
      })
      .returning();
    await db.insert(t.prFiles).values(
      files.map((file) => ({
        prId: pr!.id,
        path: file.path,
        additions: file.additions ?? 1,
        deletions: file.deletions ?? 0,
        patch: file.patch ?? null,
      })),
    );
    return pr!.id;
  }

  async function insertIntent(prId: string) {
    await pg.handle.db.insert(t.prIntent).values({
      prId,
      intent: INTENT_SENTENCE,
      inScope: ['login throttling'],
      outOfScope: ['signup'],
      riskAreas: ['auth'],
      confidence: 'high',
      headSha: 'a1b2c3d4',
    });
  }

  const rowsOf = (prId: string) =>
    pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));

  const post = (prId: string) => app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
  const get = (prId: string) => app.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
  const put = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url, payload });

  const touched = () => ({
    models: defaultLlm.calls.length + otherLlm.calls.length,
    github: githubCalls,
    blast: getBlastRadius.mock.calls.length,
    lists: repoDocs.lists.length,
    reads: repoDocs.reads.length,
  });

  let names = 0;
  const uniq = (prefix: string) => `${prefix}-${names++}`;

  async function makeAgent(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: uniq('Brief agent'),
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'Review the diff.',
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  async function makeSkill(enabled: boolean): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: uniq('brief-skill'),
        description: 'Skill with documents.',
        type: 'custom',
        body: '# Rule\n\nBe precise.',
      },
    });
    expect(res.statusCode).toBe(201);
    const id: string = res.json().id;
    if (!enabled) expect((await put(`/skills/${id}`, { enabled: false })).statusCode).toBe(200);
    return id;
  }

  async function linkSkills(agentId: string, skillIds: string[]) {
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: skillIds },
    });
    expect(res.statusCode).toBe(200);
  }

  describe('POST /pulls/:id/brief', () => {
    it('answers with a brief that satisfies the contract, carries the intent and the map it read, and drops invented paths', async () => {
      const prId = await insertPr();
      await insertIntent(prId);

      const res = await post(prId);

      expect(res.statusCode).toBe(200);
      const brief = briefOf(res);
      expect(brief.summary).toBe(ANSWER.summary);
      expect(brief.intent?.intent).toBe(INTENT_SENTENCE);
      expect(brief.blast?.downstream.flatMap((impact) => impact.callers.map((c) => c.file))).toEqual([
        SESSION,
      ]);
      expect(brief.risks.risks).toHaveLength(1);
      expect(brief.risks.risks[0]!.file_refs).toEqual([LOGIN, SESSION]);
      expect(brief.review_focus).toEqual([
        { file: LOGIN, line: 11, reason: 'Check the counter reset.' },
      ]);

      const [row] = await rowsOf(prId);
      expect(JSON.stringify(res.json())).not.toContain(GHOST);
      expect(JSON.stringify(row!.json)).not.toContain(GHOST);
    });

    it('generates from the other facts when no intent is stored and no symbol changed', async () => {
      blastResult = BLAST_EMPTY;
      const prId = await insertPr();

      const res = await post(prId);

      expect(res.statusCode).toBe(200);
      const brief = briefOf(res);
      expect(brief.intent).toBeNull();
      expect(brief.blast).toBeNull();
      expect(defaultLlm.calls).toHaveLength(1);
      const [req] = structuredCalls(defaultLlm);
      const user = userOf(req!);
      expect(user).not.toContain('## Intent');
      expect(user).not.toContain('## Blast radius');
      expect(user).toContain('## Diff statistics');
      expect(user).toContain('## PR title');
    });

    it('replaces the stored brief on every generation with a new model call, in one row', async () => {
      const prId = await insertPr({ headSha: 'head-1' });

      const first = await post(prId);
      expect(briefOf(first).summary).toBe(ANSWER.summary);
      defaultOpts.structured = { ...ANSWER, summary: 'Second answer.' };
      const second = await post(prId);

      expect(structuredCalls(defaultLlm)).toHaveLength(2);
      expect(briefOf(second).summary).toBe('Second answer.');
      const rows = await rowsOf(prId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.json).toMatchObject({ summary: 'Second answer.', head_sha: 'head-1' });
      expect(briefOf(await get(prId)).summary).toBe('Second answer.');
    });

    it('answers 502 and leaves the stored brief as it was when the provider throws or answers off-schema', async () => {
      const prId = await insertPr();
      expect((await post(prId)).statusCode).toBe(200);
      const before = await rowsOf(prId);

      defaultLlm.failWith = new Error('provider exploded');
      const thrown = await post(prId);
      expect(thrown.statusCode).toBe(502);
      expect(thrown.json().error.code).toBe('external_service_error');

      defaultLlm.failWith = undefined;
      defaultOpts.structured = { ...ANSWER, summary: '   ' };
      const offSchema = await post(prId);
      expect(offSchema.statusCode).toBe(502);

      expect(await rowsOf(prId)).toEqual(before);
      expect(briefOf(await get(prId)).summary).toBe(ANSWER.summary);
    });

    it('leaves no row behind when the first generation of a pull request fails', async () => {
      const prId = await insertPr();

      defaultLlm.failWith = new Error('provider exploded');
      expect((await post(prId)).statusCode).toBe(502);
      defaultLlm.failWith = undefined;
      defaultOpts.structured = { ...ANSWER, summary: '' };
      expect((await post(prId)).statusCode).toBe(502);

      expect(await rowsOf(prId)).toHaveLength(0);
      expect(PrBriefResponse.parse((await get(prId)).json())).toEqual({ brief: null });
    });

    it('puts the documents attached to an agent or to an enabled linked skill in the input, and only those', async () => {
      const prId = await insertPr();
      const agentA = await makeAgent();
      const agentB = await makeAgent();
      const skillOn = await makeSkill(true);
      const skillOff = await makeSkill(false);
      await linkSkills(agentB, [skillOn, skillOff]);
      expect(
        (await put(`/agents/${agentA}/context`, { paths: ['docs/limits.md', 'specs/missing.md'] })).statusCode,
      ).toBe(200);
      expect(
        (await put(`/skills/${skillOn}/context`, { paths: ['specs/auth.md', 'specs/empty.md'] })).statusCode,
      ).toBe(200);
      expect((await put(`/skills/${skillOff}/context`, { paths: ['docs/disabled.md'] })).statusCode).toBe(
        200,
      );

      const res = await post(prId);

      expect(res.statusCode).toBe(200);
      expect(briefOf(res).documents_read).toEqual(['specs/auth.md', 'docs/limits.md']);
      const [req] = structuredCalls(defaultLlm);
      const user = userOf(req!);
      expect(user).toContain('DOC-AUTH-MARKER');
      expect(user).toContain('DOC-LIMITS-MARKER');
      expect(user.indexOf('path: specs/auth.md')).toBeLessThan(user.indexOf('path: docs/limits.md'));
      const everything = req!.messages.map((message) => message.content).join('\n');
      for (const absent of ['DOC-DISABLED-MARKER', 'DOC-UNATTACHED-MARKER', 'specs/missing.md', 'specs/empty.md']) {
        expect(everything).not.toContain(absent);
      }
      const read = repoDocs.reads.map((entry) => entry.relPath);
      for (const path of ['specs/missing.md', 'docs/disabled.md', 'docs/unattached.md']) {
        expect(read).not.toContain(path);
      }
    });

    it('sends the call to the workspace Risk Brief model, or to the registry default', async () => {
      const prId = await insertPr();

      const unset = await post(prId);
      expect(structuredCalls(defaultLlm).map((req) => req.model)).toEqual([DEFAULT_MODEL]);
      expect(otherLlm.calls).toHaveLength(0);
      expect(briefOf(unset)).toMatchObject({ provider: 'openrouter', model: DEFAULT_MODEL });

      const saved = await put('/settings', {
        feature_models: { risk_brief: { provider: 'openai', model: 'gpt-4.1-mini' } },
      });
      expect(saved.statusCode).toBe(200);
      const chosen = await post(prId);

      expect(structuredCalls(otherLlm).map((req) => req.model)).toEqual(['gpt-4.1-mini']);
      expect(structuredCalls(defaultLlm)).toHaveLength(1);
      expect(briefOf(chosen)).toMatchObject({ provider: 'openai', model: 'gpt-4.1-mini' });
    });

    it('answers 400 brief_model_unavailable, naming the Settings pages, when the resolved provider has no key', async () => {
      const keyless = await buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: overridesFor({ openai: otherLlm }),
      });
      try {
        const prId = await insertPr();

        const res = await keyless.inject({ method: 'POST', url: `/pulls/${prId}/brief` });

        expect(res.statusCode).toBe(400);
        const { error } = res.json();
        expect(error.code).toBe('brief_model_unavailable');
        expect(error.message).toContain('Settings → API Keys');
        expect(error.message).toContain('Settings → Models');
        expect(defaultLlm.calls).toHaveLength(0);
        expect(otherLlm.calls).toHaveLength(0);
        expect(touched()).toEqual({ models: 0, github: 0, blast: 0, lists: 0, reads: 0 });
        expect(await rowsOf(prId)).toHaveLength(0);
      } finally {
        await keyless.close();
      }
    });

    it('stores and returns the provider, model, tokens and cost of the call, and a null cost when it has no price', async () => {
      const prId = await insertPr();

      const priced = await post(prId);
      expect(briefOf(priced)).toMatchObject({
        provider: 'openrouter',
        model: DEFAULT_MODEL,
        tokens_in: 100,
        tokens_out: 50,
        cost_usd: 0.001,
      });
      expect((await rowsOf(prId))[0]!.json).toMatchObject({
        provider: 'openrouter',
        model: DEFAULT_MODEL,
        tokens_in: 100,
        tokens_out: 50,
        cost_usd: 0.001,
      });

      defaultLlm.costUsd = null;
      const unpriced = await post(prId);
      expect(briefOf(unpriced).cost_usd).toBeNull();
      expect((await rowsOf(prId))[0]!.json).toMatchObject({ cost_usd: null });
    });
  });

  describe('GET /pulls/:id/brief', () => {
    it('returns the stored brief, null for no row and null for a row that is not a brief — without a model, GitHub or the clone', async () => {
      const stored = await insertPr();
      expect((await post(stored)).statusCode).toBe(200);
      const none = await insertPr();
      const broken = await insertPr();
      await pg.handle.db.insert(t.prBrief).values({ prId: broken, json: {} });
      const before = touched();

      const withRow = await get(stored);
      const withoutRow = await get(none);
      const withBrokenRow = await get(broken);

      expect(briefOf(withRow).summary).toBe(ANSWER.summary);
      expect(PrBriefResponse.parse(withoutRow.json())).toEqual({ brief: null });
      expect(PrBriefResponse.parse(withBrokenRow.json())).toEqual({ brief: null });
      expect(touched()).toEqual(before);
    });

    it('marks a brief stale once the pull request head moved', async () => {
      const prId = await insertPr({ headSha: 'head-a' });

      const fresh = briefOf(await post(prId));
      expect(fresh.stale).toBe(false);
      expect(fresh.head_sha).toBe('head-a');
      expect(briefOf(await get(prId)).stale).toBe(false);

      await pg.handle.db.update(t.pullRequests).set({ headSha: 'head-b' }).where(eq(t.pullRequests.id, prId));

      const stale = briefOf(await get(prId));
      expect(stale.stale).toBe(true);
      expect(stale.head_sha).toBe('head-a');
    });
  });

  describe('both routes', () => {
    it.each(['GET', 'POST'] as const)(
      '%s answers 404 for a pull request that is not in the workspace and 422 for a malformed id',
      async (method) => {
        const [other] = await pg.handle.db
          .insert(t.workspaces)
          .values({ name: `other-${seq++}` })
          .returning();
        const foreign = await insertPr({ workspace: other!.id });

        for (const id of [randomUUID(), foreign]) {
          const res = await app.inject({ method, url: `/pulls/${id}/brief` });
          expect(res.statusCode).toBe(404);
          expect(res.json().error.code).toBe('not_found');
        }
        const malformed = await app.inject({ method, url: '/pulls/not-a-uuid/brief' });
        expect(malformed.statusCode).toBe(422);

        expect(touched().models).toBe(0);
      },
    );
  });
});
