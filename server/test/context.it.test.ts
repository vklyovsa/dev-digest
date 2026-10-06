import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { ContextDocumentList } from '@devdigest/shared';
import type { FastifyInstance } from 'fastify';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[context] Docker not available — skipping integration tests.');
}

const ALPHA = '# Alpha\n\n- one\n- two\n';
const NESTED = 'Deep spec text.';
const GUIDE = '## Guide\n\nSteps for the reader, long enough to need several tokens.';
const WEB_DOCS = 'Docs of one package.';
const INSIGHT = 'An insight.';
const SECRET = 'TOP-SECRET-OUTSIDE-THE-CLONE';
const SOURCE_NOTES = 'NOTES-OUTSIDE-EVERY-ROOT';

const tokensOf = (text: string) => Math.ceil(text.length / 4);

type ListedDoc = { path: string; type: string; tokens: number; agent_count: number };

/**
 * The Project Context routes over a real database and a real adapter: a temporary
 * clone on disk holds the documents, the links that must never be followed and the
 * files that must never be listed.
 */
d('Project Context routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let llm: MockLLMProvider;
  let base: string;
  let workspaceId: string;
  let repoId: string;
  let noCloneRepoId: string;
  let goneCloneRepoId: string;
  let bigRepoId: string;
  let foreign: { repoId: string; agentId: string; skillId: string };

  async function writeTree(root: string, rel: string, text: string) {
    const file = join(root, rel);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  }

  async function insertRepo(ws: string, name: string, clonePath: string | null) {
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    return repo!.id;
  }

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const { db } = pg.handle;
    const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;

    base = await mkdtemp(join(tmpdir(), 'devdigest-ctx-it-'));
    const clone = join(base, 'clone');
    const outside = join(base, 'outside');
    await writeTree(clone, 'specs/a.md', ALPHA);
    await writeTree(clone, 'specs/nested/deep/x.md', NESTED);
    await writeTree(clone, 'docs/guide/b.md', GUIDE);
    await writeTree(clone, 'docs/empty.md', '');
    await writeTree(clone, 'docs/notes.txt', 'not markdown');
    await writeTree(clone, 'insights/c.md', INSIGHT);
    await writeTree(clone, 'packages/web/docs/d.md', WEB_DOCS);
    await writeTree(clone, 'src/notes.md', SOURCE_NOTES);
    await writeTree(clone, 'README.md', 'Root readme.');
    await writeTree(clone, '.devdigest/specs/hidden.md', 'hidden');
    await writeTree(clone, '.github/docs/ci.md', 'ci');
    await writeTree(outside, 'secret.md', SECRET);
    await writeTree(outside, 'leak.md', SECRET);
    await symlink(join(outside, 'secret.md'), join(clone, 'docs', 'escape.md'));
    await symlink(outside, join(clone, 'docs', 'linkdir'), 'dir');

    const big = join(base, 'big');
    await Promise.all(
      Array.from({ length: 300 }, (_, i) =>
        writeTree(big, `docs/gen/n-${String(i).padStart(3, '0')}.md`, `# Doc ${i}\n`),
      ),
    );

    repoId = await insertRepo(workspaceId, 'api', clone);
    noCloneRepoId = await insertRepo(workspaceId, 'no-clone', null);
    goneCloneRepoId = await insertRepo(workspaceId, 'gone-clone', join(base, 'does-not-exist'));
    bigRepoId = await insertRepo(workspaceId, 'big', big);

    const [other] = await db.insert(t.workspaces).values({ name: 'other' }).returning();
    const [foreignAgent] = await db
      .insert(t.agents)
      .values({
        workspaceId: other!.id,
        name: 'Foreign agent',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'Review the diff.',
      })
      .returning();
    const [foreignSkill] = await db
      .insert(t.skills)
      .values({
        workspaceId: other!.id,
        name: 'Foreign skill',
        description: 'Not yours.',
        type: 'custom',
        source: 'manual',
        body: '# Foreign',
      })
      .returning();
    foreign = {
      repoId: await insertRepo(other!.id, 'foreign', clone),
      agentId: foreignAgent!.id,
      skillId: foreignSkill!.id,
    };

    llm = new MockLLMProvider('openai');
    app = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'test',
        PROJECT_CONTEXT_ROOTS: 'specs,docs,insights',
      } as NodeJS.ProcessEnv),
      db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: { openai: llm, anthropic: llm, openrouter: llm },
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    if (base) await rm(base, { recursive: true, force: true });
    await pg?.stop();
  });

  beforeEach(async () => {
    await pg.handle.db.delete(t.agentContextDocs);
    await pg.handle.db.delete(t.skillContextDocs);
  });

  const get = (url: string) => app.inject({ method: 'GET', url });
  const put = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'PUT', url, payload });
  const docUrl = (id: string, path: string) =>
    `/repos/${id}/context/document?path=${encodeURIComponent(path)}`;

  let seq = 0;
  const uniq = (prefix: string) => `${prefix}-${seq++}`;

  async function makeAgent(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: uniq('Context agent'),
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'Review the diff.',
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  async function makeSkill(enabled = true): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: uniq('context-skill'),
        description: 'Skill with documents.',
        type: 'custom',
        body: '# Rule\n\nBe precise.',
      },
    });
    expect(res.statusCode).toBe(201);
    const id: string = res.json().id;
    if (!enabled) await put(`/skills/${id}`, { enabled: false });
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

  async function listed(id = repoId): Promise<ListedDoc[]> {
    const res = await get(`/repos/${id}/context`);
    expect(res.statusCode).toBe(200);
    return res.json().documents;
  }

  async function agentCounts(): Promise<Record<string, number>> {
    return Object.fromEntries((await listed()).map((doc) => [doc.path, doc.agent_count]));
  }

  async function runRows() {
    const { db } = pg.handle;
    const [runs] = await db.select({ n: sql<number>`count(*)::int` }).from(t.agentRuns);
    const [traces] = await db.select({ n: sql<number>`count(*)::int` }).from(t.runTraces);
    return { runs: runs!.n, traces: traces!.n };
  }

  async function storedAgentPaths(agentId: string): Promise<string[]> {
    const rows = await pg.handle.db
      .select()
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.agentId, agentId));
    return rows.map((row) => row.path);
  }

  async function storedSkillPaths(skillId: string): Promise<string[]> {
    const rows = await pg.handle.db
      .select()
      .from(t.skillContextDocs)
      .where(eq(t.skillContextDocs.skillId, skillId));
    return rows.map((row) => row.path);
  }

  async function seedForeignAttachments() {
    const { db } = pg.handle;
    await db
      .insert(t.agentContextDocs)
      .values({ agentId: foreign.agentId, path: 'specs/a.md', position: 0 });
    await db
      .insert(t.skillContextDocs)
      .values({ skillId: foreign.skillId, path: 'specs/a.md', position: 0 });
  }

  describe('GET /repos/:id/context', () => {
    it('lists every Markdown file under a root at any depth, typed and ordered, with no text', async () => {
      const res = await get(`/repos/${repoId}/context`);
      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.roots).toEqual(['specs', 'docs', 'insights']);
      expect((body.documents as ListedDoc[]).map((doc) => [doc.path, doc.type])).toEqual([
        ['specs/a.md', 'specs'],
        ['specs/nested/deep/x.md', 'specs'],
        ['docs/empty.md', 'docs'],
        ['docs/guide/b.md', 'docs'],
        ['packages/web/docs/d.md', 'docs'],
        ['insights/c.md', 'insights'],
      ]);
      expect(() => ContextDocumentList.parse(body)).not.toThrow();

      for (const doc of body.documents) expect('content' in doc).toBe(false);
      expect(res.body).not.toContain(SECRET);
      expect(res.body).not.toContain(SOURCE_NOTES);
    });

    it('gives each document the character count over four, rounded up, and 0 for an empty one', async () => {
      const byPath = Object.fromEntries((await listed()).map((doc) => [doc.path, doc.tokens]));

      expect(byPath['specs/a.md']).toBe(tokensOf(ALPHA));
      expect(byPath['docs/guide/b.md']).toBe(tokensOf(GUIDE));
      expect(byPath['docs/empty.md']).toBe(0);
    });

    it('leaves out a .md link that leaves the clone and a directory link that leaves it', async () => {
      const paths = (await listed()).map((doc) => doc.path);

      expect(paths).not.toContain('docs/escape.md');
      expect(paths.some((path) => path.startsWith('docs/linkdir/'))).toBe(false);
    });

    it('answers 200 with an empty list when the repository has no clone or its directory is gone', async () => {
      for (const id of [noCloneRepoId, goneCloneRepoId]) {
        const res = await get(`/repos/${id}/context`);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ roots: ['specs', 'docs', 'insights'], documents: [] });
        expect((await get(docUrl(id, 'specs/a.md'))).statusCode).toBe(404);
      }
    });

    it('returns a clone of three hundred documents whole, in one response', async () => {
      const res = await get(`/repos/${bigRepoId}/context`);

      expect(res.statusCode).toBe(200);
      const documents = res.json().documents as ListedDoc[];
      expect(documents).toHaveLength(300);
      expect(documents.every((doc) => doc.type === 'docs' && !('content' in doc))).toBe(true);
    });
  });

  describe('GET /repos/:id/context/document', () => {
    it('returns the path, type, tokens and the exact text of a listed document', async () => {
      const res = await get(docUrl(repoId, 'docs/guide/b.md'));

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        path: 'docs/guide/b.md',
        type: 'docs',
        tokens: tokensOf(GUIDE),
        content: GUIDE,
      });
      expect((await get(docUrl(repoId, 'specs/nested/deep/x.md'))).json().content).toBe(NESTED);
      expect((await get(docUrl(repoId, 'docs/empty.md'))).json()).toMatchObject({
        tokens: 0,
        content: '',
      });
    });

    it.each([
      ['a traversal path', '../outside/secret.md'],
      ['a traversal path inside a root', 'docs/../src/notes.md'],
      ['an absolute path', '/etc/passwd'],
      ['a source file outside the roots', 'src/notes.md'],
      ['a .md file outside the roots', 'README.md'],
      ['a file in a dot-directory', '.devdigest/specs/hidden.md'],
      ['a .md link that resolves outside the clone', 'docs/escape.md'],
      ['a file behind a directory link', 'docs/linkdir/leak.md'],
      ['a file that is not Markdown', 'docs/notes.txt'],
      ['a path that does not exist', 'docs/missing.md'],
      ['an empty path', ''],
    ])('answers 404 and no file content for %s', async (_label, path) => {
      const res = await get(docUrl(repoId, path));

      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain(SECRET);
      expect(res.body).not.toContain(SOURCE_NOTES);
    });

    it('answers 422 when no path is given', async () => {
      expect((await get(`/repos/${repoId}/context/document`)).statusCode).toBe(422);
    });
  });

  describe('workspace scoping', () => {
    it('answers 404 on all six routes for an unknown id and for another workspace', async () => {
      await seedForeignAttachments();
      const unknown = randomUUID();
      const targets = [
        { repo: unknown, agent: unknown, skill: unknown },
        { repo: foreign.repoId, agent: foreign.agentId, skill: foreign.skillId },
      ];

      for (const id of targets) {
        const statuses = [
          (await get(`/repos/${id.repo}/context`)).statusCode,
          (await get(docUrl(id.repo, 'specs/a.md'))).statusCode,
          (await get(`/agents/${id.agent}/context`)).statusCode,
          (await put(`/agents/${id.agent}/context`, { paths: ['docs/guide/b.md'] })).statusCode,
          (await get(`/skills/${id.skill}/context`)).statusCode,
          (await put(`/skills/${id.skill}/context`, { paths: ['docs/guide/b.md'] })).statusCode,
        ];
        expect(statuses).toEqual([404, 404, 404, 404, 404, 404]);
      }

      expect(await storedAgentPaths(foreign.agentId)).toEqual(['specs/a.md']);
      expect(await storedSkillPaths(foreign.skillId)).toEqual(['specs/a.md']);
    });

    it('answers 422 for an id that is not a uuid', async () => {
      expect((await get('/repos/not-a-uuid/context')).statusCode).toBe(422);
      expect((await get('/agents/not-a-uuid/context')).statusCode).toBe(422);
      expect((await get('/skills/not-a-uuid/context')).statusCode).toBe(422);
    });
  });

  describe('agent attachments', () => {
    it('starts empty and returns the stored paths in the order they were sent', async () => {
      const agentId = await makeAgent();
      expect((await get(`/agents/${agentId}/context`)).json()).toEqual({
        paths: [],
        inherited: [],
      });

      const sent = ['insights/c.md', 'specs/a.md', 'docs/guide/b.md'];
      const res = await put(`/agents/${agentId}/context`, { paths: sent });

      expect(res.statusCode).toBe(200);
      expect(res.json().paths).toEqual(sent);
      expect((await get(`/agents/${agentId}/context`)).json().paths).toEqual(sent);
    });

    it('replaces the whole list: three paths, then one, leaves the one', async () => {
      const agentId = await makeAgent();
      await put(`/agents/${agentId}/context`, {
        paths: ['specs/a.md', 'docs/guide/b.md', 'insights/c.md'],
      });

      await put(`/agents/${agentId}/context`, { paths: ['docs/guide/b.md'] });

      expect((await get(`/agents/${agentId}/context`)).json().paths).toEqual(['docs/guide/b.md']);
      await put(`/agents/${agentId}/context`, { paths: [] });
      expect((await get(`/agents/${agentId}/context`)).json().paths).toEqual([]);
    });

    it('keeps a path that is not in the repository list, for the page to mark', async () => {
      const agentId = await makeAgent();

      await put(`/agents/${agentId}/context`, { paths: ['docs/gone.md'] });

      expect((await get(`/agents/${agentId}/context`)).json().paths).toEqual(['docs/gone.md']);
    });

    const MALFORMED: [string, string[]][] = [
      ['an empty entry', ['']],
      ['an absolute path', ['/abs.md']],
      ['a .. segment', ['../x.md']],
      ['a .. segment inside a path', ['docs/../x.md']],
      ['a backslash', ['docs\\x.md']],
      ['a NUL character', ['docs/a\u0000b.md']],
      ['a malformed entry after a good one', ['specs/a.md', '']],
      ['a repeated path', ['specs/a.md', 'docs/guide/b.md', 'specs/a.md']],
    ];

    it.each(MALFORMED)('answers 422 for %s and keeps the earlier list', async (_label, paths) => {
      const agentId = await makeAgent();
      const earlier = ['docs/guide/b.md', 'specs/a.md'];
      await put(`/agents/${agentId}/context`, { paths: earlier });

      const res = await put(`/agents/${agentId}/context`, { paths });

      expect(res.statusCode).toBe(422);
      expect((await get(`/agents/${agentId}/context`)).json().paths).toEqual(earlier);
    });

    it('leaves the agent version and its version history unchanged', async () => {
      const agentId = await makeAgent();
      const before = (await get(`/agents/${agentId}`)).json();
      const versionsBefore = (await get(`/agents/${agentId}/versions`)).json();

      await put(`/agents/${agentId}/context`, { paths: ['specs/a.md', 'docs/guide/b.md'] });

      const after = (await get(`/agents/${agentId}`)).json();
      expect(after.version).toBe(before.version);
      expect((await get(`/agents/${agentId}/versions`)).json()).toHaveLength(versionsBefore.length);
    });

    it('lists the documents of linked, enabled skills as inherited, in the skill order', async () => {
      const agentId = await makeAgent();
      const first = await makeSkill();
      const second = await makeSkill();
      const disabled = await makeSkill(false);
      await put(`/skills/${first}/context`, { paths: ['docs/guide/b.md', 'specs/a.md'] });
      await put(`/skills/${second}/context`, { paths: ['insights/c.md'] });
      await put(`/skills/${disabled}/context`, { paths: ['docs/empty.md'] });
      await put(`/agents/${agentId}/context`, { paths: ['specs/a.md'] });
      await linkSkills(agentId, [first, second, disabled]);

      const body = (await get(`/agents/${agentId}/context`)).json();

      expect(body.paths).toEqual(['specs/a.md']);
      expect(body.inherited).toEqual([
        { path: 'docs/guide/b.md', skill_id: first, skill_name: expect.any(String) },
        { path: 'insights/c.md', skill_id: second, skill_name: expect.any(String) },
      ]);

      await linkSkills(agentId, [second, first, disabled]);
      const reordered = (await get(`/agents/${agentId}/context`)).json();
      expect(reordered.inherited.map((doc: { path: string }) => doc.path)).toEqual([
        'insights/c.md',
        'docs/guide/b.md',
      ]);
    });
  });

  describe('skill attachments', () => {
    it('starts empty, stores the list sent and returns it in the same order', async () => {
      const skillId = await makeSkill();
      expect((await get(`/skills/${skillId}/context`)).json()).toEqual({ paths: [] });

      const sent = ['docs/guide/b.md', 'insights/c.md', 'specs/a.md'];
      const res = await put(`/skills/${skillId}/context`, { paths: sent });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ paths: sent });
      expect((await get(`/skills/${skillId}/context`)).json()).toEqual({ paths: sent });

      await put(`/skills/${skillId}/context`, { paths: ['specs/a.md'] });
      expect((await get(`/skills/${skillId}/context`)).json()).toEqual({ paths: ['specs/a.md'] });
    });

    it.each([
      ['an empty entry', ['']],
      ['an absolute path', ['/abs.md']],
      ['a .. segment', ['../x.md']],
      ['a backslash', ['docs\\x.md']],
      ['a NUL character', ['docs/a\u0000b.md']],
      ['a repeated path', ['specs/a.md', 'specs/a.md']],
    ])('answers 422 for %s and keeps the earlier list', async (_label, paths) => {
      const skillId = await makeSkill();
      await put(`/skills/${skillId}/context`, { paths: ['docs/guide/b.md'] });

      const res = await put(`/skills/${skillId}/context`, { paths });

      expect(res.statusCode).toBe(422);
      expect((await get(`/skills/${skillId}/context`)).json().paths).toEqual(['docs/guide/b.md']);
    });

    it('leaves the skill body and version, and its version history, unchanged', async () => {
      const skillId = await makeSkill();
      const before = (await get(`/skills/${skillId}`)).json();
      const versionsBefore = (await get(`/skills/${skillId}/versions`)).json();

      await put(`/skills/${skillId}/context`, { paths: ['specs/a.md'] });

      const after = (await get(`/skills/${skillId}`)).json();
      expect(after.body).toBe(before.body);
      expect(after.version).toBe(before.version);
      expect((await get(`/skills/${skillId}/versions`)).json()).toHaveLength(versionsBefore.length);
    });
  });

  describe('agent_count', () => {
    it('counts distinct agents of the workspace: direct, through an enabled skill, never twice', async () => {
      await seedForeignAttachments();
      const shared = await makeSkill();
      const off = await makeSkill(false);
      await put(`/skills/${shared}/context`, { paths: ['specs/a.md', 'docs/guide/b.md'] });
      await put(`/skills/${off}/context`, { paths: ['insights/c.md'] });

      const direct = await makeAgent();
      await put(`/agents/${direct}/context`, { paths: ['specs/a.md'] });
      await linkSkills(direct, [shared]);
      const inheriting = await makeAgent();
      await linkSkills(inheriting, [shared, off]);

      const counts = await agentCounts();

      expect(counts['specs/a.md']).toBe(2);
      expect(counts['docs/guide/b.md']).toBe(2);
      expect(counts['insights/c.md']).toBe(0);
      expect(counts['specs/nested/deep/x.md']).toBe(0);
    });

    it('stops counting an agent once it is deleted', async () => {
      const agentId = await makeAgent();
      await put(`/agents/${agentId}/context`, { paths: ['specs/a.md', 'insights/c.md'] });
      expect((await agentCounts())['specs/a.md']).toBe(1);

      const res = await app.inject({ method: 'DELETE', url: `/agents/${agentId}` });

      expect(res.statusCode).toBeLessThan(300);
      expect(await storedAgentPaths(agentId)).toEqual([]);
      expect((await agentCounts())['specs/a.md']).toBe(0);
    });

    it('stops counting a skill, and what it gave its agents, once it is deleted', async () => {
      const skillId = await makeSkill();
      await put(`/skills/${skillId}/context`, { paths: ['docs/guide/b.md'] });
      const agentId = await makeAgent();
      await linkSkills(agentId, [skillId]);
      expect((await agentCounts())['docs/guide/b.md']).toBe(1);

      const res = await app.inject({ method: 'DELETE', url: `/skills/${skillId}` });

      expect(res.statusCode).toBeLessThan(300);
      expect(await storedSkillPaths(skillId)).toEqual([]);
      expect((await agentCounts())['docs/guide/b.md']).toBe(0);
    });
  });

  describe('cost', () => {
    it('makes no model call and adds no agent_runs or run_traces row', async () => {
      const before = await runRows();
      const agentId = await makeAgent();
      const skillId = await makeSkill();

      await get(`/repos/${repoId}/context`);
      await get(docUrl(repoId, 'docs/guide/b.md'));
      await put(`/agents/${agentId}/context`, { paths: ['specs/a.md'] });
      await get(`/agents/${agentId}/context`);
      await put(`/skills/${skillId}/context`, { paths: ['docs/guide/b.md'] });
      await get(`/skills/${skillId}/context`);
      const resync = await app.inject({ method: 'POST', url: `/repos/${noCloneRepoId}/resync` });
      expect(resync.statusCode).toBe(202);
      await app.container.jobs.onIdle();

      expect(await runRows()).toEqual(before);
      expect(llm.calls).toEqual([]);
    });
  });
});
