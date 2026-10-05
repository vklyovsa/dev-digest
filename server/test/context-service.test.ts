import { describe, expect, it } from 'vitest';
import { ContextDocumentList, SpecDocument } from '@devdigest/shared';
import { MockRepoDocsReader } from '../src/adapters/mocks.js';
import { NotFoundError } from '../src/platform/errors.js';
import { READ_CONCURRENCY } from '../src/modules/context/constants.js';
import { ContextService } from '../src/modules/context/service.js';
import type {
  ContextStore,
  ContextUsageRow,
  LinkedSkillPath,
} from '../src/modules/context/types.js';

const CLONE = '/clones/acme/api';
const ROOTS = ['specs', 'docs', 'insights'];

class InMemoryContextStore implements ContextStore {
  agents = new Map<string, string[]>();
  skills = new Map<string, string[]>();
  linked: LinkedSkillPath[] = [];
  usageRows: ContextUsageRow[] = [];
  replaced: { owner: string; paths: readonly string[] }[] = [];

  async agentPaths(agentId: string) {
    return [...(this.agents.get(agentId) ?? [])];
  }
  async skillPaths(skillId: string) {
    return [...(this.skills.get(skillId) ?? [])];
  }
  async replaceAgentPaths(agentId: string, paths: readonly string[]) {
    this.replaced.push({ owner: agentId, paths });
    this.agents.set(agentId, [...paths]);
  }
  async replaceSkillPaths(skillId: string, paths: readonly string[]) {
    this.replaced.push({ owner: skillId, paths });
    this.skills.set(skillId, [...paths]);
  }
  async linkedSkillPaths() {
    return [...this.linked];
  }
  async usage() {
    return [...this.usageRows];
  }
}

/** A reader whose listed files cannot be read: they appear in the tree and answer null. */
class UnreadableDocs extends MockRepoDocsReader {
  constructor(
    tree: Record<string, string>,
    private readonly unreadable: string[],
  ) {
    super({ [CLONE]: tree });
  }
  override async readText(clonePath: string, relPath: string) {
    if (this.unreadable.includes(relPath)) {
      this.reads.push({ clonePath, relPath });
      return null;
    }
    return super.readText(clonePath, relPath);
  }
}

function setup(
  over: {
    tree?: Record<string, string>;
    unreadable?: string[];
    clonePath?: string | null;
    repo?: boolean;
    agent?: boolean;
    skill?: boolean;
  } = {},
) {
  const docs = new UnreadableDocs(over.tree ?? {}, over.unreadable ?? []);
  const store = new InMemoryContextStore();
  const clonePath = 'clonePath' in over ? over.clonePath! : CLONE;
  const service = new ContextService({
    store,
    repos: {
      getById: async () => (over.repo === false ? undefined : { id: 'repo-1', clonePath }),
    },
    agents: { getById: async () => (over.agent === false ? undefined : { id: 'agent-1' }) },
    skills: { getById: async () => (over.skill === false ? undefined : { id: 'skill-1' }) },
    docs,
    roots: ROOTS,
  });
  return { service, store, docs };
}

const link = (skillId: string, skillName: string, path: string): LinkedSkillPath => ({
  skillId,
  skillName,
  path,
});

describe('ContextService.resolveForRun', () => {
  it('keeps the agent first, then skill by skill, and a repeated path at its first place only', async () => {
    const { service, store } = setup({
      tree: { 'specs/a.md': 'alpha', 'docs/b.md': 'beta', 'insights/c.md': 'gamma' },
    });
    store.agents.set('agent-1', ['specs/a.md']);
    store.linked = [
      link('s1', 'first', 'docs/b.md'),
      link('s1', 'first', 'specs/a.md'),
      link('s2', 'second', 'insights/c.md'),
    ];

    const out = await service.resolveForRun('ws-1', 'repo-1', 'agent-1');

    expect(out.documents.map((d) => d.path)).toEqual(['specs/a.md', 'docs/b.md', 'insights/c.md']);
    expect(out.documents.map((d) => [d.source, d.skillName])).toEqual([
      ['agent', null],
      ['skill', 'first'],
      ['skill', 'second'],
    ]);
    expect(out.documents.map((d) => d.text)).toEqual(['alpha', 'beta', 'gamma']);
    expect(out.skipped).toEqual([]);
  });

  it('follows the order of the agent attachment list', async () => {
    const { service, store } = setup({ tree: { 'specs/a.md': 'alpha', 'docs/b.md': 'beta' } });
    store.agents.set('agent-1', ['docs/b.md', 'specs/a.md']);

    const out = await service.resolveForRun('ws-1', 'repo-1', 'agent-1');

    expect(out.documents.map((d) => d.path)).toEqual(['docs/b.md', 'specs/a.md']);
  });

  it('skips a missing path, an unreadable file and an empty one, each with its reason', async () => {
    const { service, store, docs } = setup({
      tree: {
        'specs/ok.md': 'twelve chars',
        'docs/locked.md': 'text the reader cannot return',
        'docs/blank.md': '',
      },
      unreadable: ['docs/locked.md'],
    });
    store.agents.set('agent-1', [
      'docs/gone.md',
      'specs/ok.md',
      'docs/locked.md',
      'docs/blank.md',
    ]);

    const out = await service.resolveForRun('ws-1', 'repo-1', 'agent-1');

    expect(out.documents).toEqual([
      { path: 'specs/ok.md', text: 'twelve chars', tokens: 3, source: 'agent', skillName: null },
    ]);
    expect(out.skipped).toEqual([
      { path: 'docs/gone.md', reason: 'not found in this repository' },
      { path: 'docs/locked.md', reason: 'unreadable' },
      { path: 'docs/blank.md', reason: 'empty' },
    ]);
    expect(docs.reads.map((r) => r.relPath)).not.toContain('docs/gone.md');
  });

  it('never reads a path that is not in the document list, whatever the path says', async () => {
    const { service, store, docs } = setup({
      tree: { 'src/secret.md': 'not a document', 'specs/a.md': 'alpha' },
    });
    store.agents.set('agent-1', ['src/secret.md', '../outside.md', 'specs/a.md']);

    const out = await service.resolveForRun('ws-1', 'repo-1', 'agent-1');

    expect(out.documents.map((d) => d.path)).toEqual(['specs/a.md']);
    expect(out.skipped.map((s) => s.path)).toEqual(['src/secret.md', '../outside.md']);
    expect(docs.reads.map((r) => r.relPath)).toEqual(['specs/a.md']);
  });

  it('does not walk the clone when nothing is attached', async () => {
    const { service, docs } = setup({ tree: { 'specs/a.md': 'alpha' } });

    const out = await service.resolveForRun('ws-1', 'repo-1', 'agent-1');

    expect(out).toEqual({ documents: [], skipped: [] });
    expect(docs.lists).toEqual([]);
    expect(docs.reads).toEqual([]);
  });

  it('skips every attached path of a repository without a clone', async () => {
    const { service, store, docs } = setup({ clonePath: null, tree: { 'specs/a.md': 'alpha' } });
    store.agents.set('agent-1', ['specs/a.md']);

    const out = await service.resolveForRun('ws-1', 'repo-1', 'agent-1');

    expect(out.documents).toEqual([]);
    expect(out.skipped).toEqual([{ path: 'specs/a.md', reason: 'not found in this repository' }]);
    expect(docs.lists).toEqual([]);
  });

  it('answers NotFound for a missing agent or repository', async () => {
    await expect(
      setup({ agent: false }).service.resolveForRun('ws-1', 'repo-1', 'agent-1'),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      setup({ repo: false }).service.resolveForRun('ws-1', 'repo-1', 'agent-1'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ContextService.resolveForWorkspace', () => {
  it('returns the documents attached by any agent, in document-list order, each once', async () => {
    const { service, store } = setup({
      tree: { 'specs/a.md': 'alpha', 'docs/b.md': 'beta', 'insights/c.md': 'unattached' },
    });
    store.usageRows = [
      { path: 'docs/b.md', agentId: 'agent-2' },
      { path: 'specs/a.md', agentId: 'agent-1' },
      { path: 'specs/a.md', agentId: 'agent-2' },
    ];

    const out = await service.resolveForWorkspace('ws-1', 'repo-1');

    expect(out).toEqual([
      { path: 'specs/a.md', text: 'alpha' },
      { path: 'docs/b.md', text: 'beta' },
    ]);
  });

  it('leaves out a path absent from the tree, an unreadable file and an empty one', async () => {
    const { service, store, docs } = setup({
      tree: {
        'specs/ok.md': 'twelve chars',
        'docs/locked.md': 'text the reader cannot return',
        'docs/blank.md': '',
        'src/secret.md': 'outside every root',
      },
      unreadable: ['docs/locked.md'],
    });
    store.usageRows = [
      { path: 'docs/gone.md', agentId: 'agent-1' },
      { path: 'specs/ok.md', agentId: 'agent-1' },
      { path: 'docs/locked.md', agentId: 'agent-1' },
      { path: 'docs/blank.md', agentId: 'agent-1' },
      { path: 'src/secret.md', agentId: 'agent-1' },
      { path: '../outside.md', agentId: 'agent-1' },
    ];

    const out = await service.resolveForWorkspace('ws-1', 'repo-1');

    expect(out).toEqual([{ path: 'specs/ok.md', text: 'twelve chars' }]);
    const read = docs.reads.map((r) => r.relPath);
    expect(read).not.toContain('docs/gone.md');
    expect(read).not.toContain('src/secret.md');
    expect(read).not.toContain('../outside.md');
  });

  it('lists nothing and reads nothing when no document is attached', async () => {
    const { service, docs } = setup({ tree: { 'specs/a.md': 'alpha' } });

    expect(await service.resolveForWorkspace('ws-1', 'repo-1')).toEqual([]);
    expect(docs.lists).toEqual([]);
    expect(docs.reads).toEqual([]);
  });

  it('returns nothing for a repository without a clone', async () => {
    const { service, store, docs } = setup({ clonePath: null, tree: { 'specs/a.md': 'alpha' } });
    store.usageRows = [{ path: 'specs/a.md', agentId: 'agent-1' }];

    expect(await service.resolveForWorkspace('ws-1', 'repo-1')).toEqual([]);
    expect(docs.lists).toEqual([]);
  });

  it('answers NotFound for a repository outside the workspace', async () => {
    await expect(
      setup({ repo: false }).service.resolveForWorkspace('ws-1', 'repo-1'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ContextService.listDocuments', () => {
  it('lists nothing and walks nothing for a repository without a clone', async () => {
    const { service, docs } = setup({ clonePath: null, tree: { 'specs/a.md': 'alpha' } });

    const out = await service.listDocuments('ws-1', 'repo-1');

    expect(out).toEqual({ roots: ROOTS, documents: [] });
    expect(docs.lists).toEqual([]);
  });

  it('lists nothing when the clone directory holds no document', async () => {
    const { service } = setup({ tree: {} });

    expect(await service.listDocuments('ws-1', 'repo-1')).toEqual({ roots: ROOTS, documents: [] });
  });

  it('types and orders the documents, counts tokens and agents, and carries no text', async () => {
    const { service, store } = setup({
      tree: {
        'insights/late.md': 'x'.repeat(8),
        'docs/guide.md': 'x'.repeat(10),
        'specs/one.md': 'x'.repeat(9),
        'specs/locked.md': 'unreadable text',
        'src/notes.md': 'outside every root',
        'docs/readme.txt': 'not markdown',
      },
      unreadable: ['specs/locked.md'],
    });
    store.usageRows = [
      { path: 'specs/one.md', agentId: 'a1' },
      { path: 'specs/one.md', agentId: 'a1' },
      { path: 'specs/one.md', agentId: 'a2' },
      { path: 'docs/guide.md', agentId: 'a1' },
    ];

    const out = await service.listDocuments('ws-1', 'repo-1');

    expect(out.roots).toEqual(ROOTS);
    expect(out.documents).toEqual([
      { path: 'specs/locked.md', type: 'specs', tokens: 0, agent_count: 0 },
      { path: 'specs/one.md', type: 'specs', tokens: 3, agent_count: 2 },
      { path: 'docs/guide.md', type: 'docs', tokens: 3, agent_count: 1 },
      { path: 'insights/late.md', type: 'insights', tokens: 2, agent_count: 0 },
    ]);
    expect(out.documents.every((doc) => !('content' in doc))).toBe(true);
    expect(() => ContextDocumentList.parse(out)).not.toThrow();
  });

  it('reads at most READ_CONCURRENCY files at the same time', async () => {
    let inFlight = 0;
    let peak = 0;
    const tree = Object.fromEntries(
      Array.from({ length: READ_CONCURRENCY * 3 }, (_, i) => [`docs/n-${i}.md`, 'x']),
    );
    const { service, docs } = setup({ tree });
    docs.readText = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return 'x';
    };

    const out = await service.listDocuments('ws-1', 'repo-1');

    expect(out.documents).toHaveLength(READ_CONCURRENCY * 3);
    expect(peak).toBe(READ_CONCURRENCY);
  });

  it('answers NotFound for a repository outside the workspace', async () => {
    await expect(
      setup({ repo: false }).service.listDocuments('ws-1', 'repo-1'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ContextService.getDocument', () => {
  const tree = { 'docs/guide.md': 'twelve chars', 'src/notes.md': 'outside every root' };

  it('returns the path, type, tokens and the whole text of a listed document', async () => {
    const { service } = setup({ tree });

    const out = await service.getDocument('ws-1', 'repo-1', 'docs/guide.md');

    expect(out).toEqual({
      path: 'docs/guide.md',
      type: 'docs',
      tokens: 3,
      content: 'twelve chars',
    });
    expect(() => SpecDocument.parse(out)).not.toThrow();
  });

  it.each(['src/notes.md', '../etc/passwd', '/etc/passwd', '', 'docs/missing.md'])(
    'answers NotFound for %j before any file is read',
    async (path) => {
      const { service, docs } = setup({ tree });

      await expect(service.getDocument('ws-1', 'repo-1', path)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect(docs.reads).toEqual([]);
    },
  );

  it('answers NotFound when a listed file cannot be read', async () => {
    const { service } = setup({ tree, unreadable: ['docs/guide.md'] });

    await expect(service.getDocument('ws-1', 'repo-1', 'docs/guide.md')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('answers NotFound for a repository without a clone', async () => {
    const { service } = setup({ tree, clonePath: null });

    await expect(service.getDocument('ws-1', 'repo-1', 'docs/guide.md')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('ContextService attachments', () => {
  it('returns an agent paths in stored order and its inherited documents with their skills', async () => {
    const { service, store } = setup();
    store.agents.set('agent-1', ['docs/b.md', 'specs/a.md']);
    store.linked = [
      link('s1', 'first', 'insights/c.md'),
      link('s1', 'first', 'specs/a.md'),
      link('s2', 'second', 'docs/d.md'),
    ];

    const out = await service.getAgentContext('ws-1', 'agent-1');

    expect(out.paths).toEqual(['docs/b.md', 'specs/a.md']);
    expect(out.inherited).toEqual([
      { path: 'insights/c.md', skill_id: 's1', skill_name: 'first' },
      { path: 'docs/d.md', skill_id: 's2', skill_name: 'second' },
    ]);
  });

  it('replaces the whole agent list and answers with the stored one', async () => {
    const { service, store } = setup();
    store.agents.set('agent-1', ['specs/a.md', 'docs/b.md', 'insights/c.md']);

    const out = await service.setAgentContext('ws-1', 'agent-1', ['docs/b.md']);

    expect(store.replaced).toEqual([{ owner: 'agent-1', paths: ['docs/b.md'] }]);
    expect(out).toEqual({ paths: ['docs/b.md'], inherited: [] });
  });

  it('keeps the skill list free of an inherited key', async () => {
    const { service } = setup();

    await service.setSkillContext('ws-1', 'skill-1', ['specs/a.md', 'docs/b.md']);
    const out = await service.getSkillContext('ws-1', 'skill-1');

    expect(out).toEqual({ paths: ['specs/a.md', 'docs/b.md'] });
  });

  it('answers NotFound, and stores nothing, for an owner outside the workspace', async () => {
    const noAgent = setup({ agent: false });
    await expect(noAgent.service.getAgentContext('ws-1', 'agent-1')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      noAgent.service.setAgentContext('ws-1', 'agent-1', ['specs/a.md']),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(noAgent.store.replaced).toEqual([]);

    const noSkill = setup({ skill: false });
    await expect(noSkill.service.getSkillContext('ws-1', 'skill-1')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      noSkill.service.setSkillContext('ws-1', 'skill-1', ['specs/a.md']),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(noSkill.store.replaced).toEqual([]);
  });
});
