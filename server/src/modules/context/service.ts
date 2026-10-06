import type { ContextAttachments, ContextDocumentList, SpecDocument } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import {
  READ_CONCURRENCY,
  SKIP_EMPTY,
  SKIP_NOT_FOUND,
  SKIP_UNREADABLE,
} from './constants.js';
import {
  classifyDocuments,
  countAgentsByPath,
  docTokens,
  mapInBatches,
  mergeAttachments,
  type ClassifiedDocument,
  type MergedAttachment,
} from './helpers.js';
import type {
  ContextDeps,
  ContextOwnerReader,
  RunContext,
  RunContextDocument,
  RunContextSkip,
  WorkspaceDocument,
} from './types.js';

/**
 * Project Context use cases: the document list of a repository's clone, one
 * document, the attachment lists of agents and skills, and the documents a run
 * puts in its prompt. Every lookup is by workspace; nothing here calls a model.
 */
export class ContextService {
  constructor(private readonly deps: ContextDeps) {}

  async listDocuments(workspaceId: string, repoId: string): Promise<ContextDocumentList> {
    const { store, docs, roots } = this.deps;
    const repo = await this.requireRepo(workspaceId, repoId);
    const clonePath = repo.clonePath;
    if (clonePath === null) return { roots: [...roots], documents: [] };

    const listed = await this.classified(clonePath);
    const [tokens, usage] = await Promise.all([
      mapInBatches(listed, READ_CONCURRENCY, async (doc) => {
        const text = await docs.readText(clonePath, doc.path);
        return text === null ? 0 : docTokens(text);
      }),
      store.usage(workspaceId),
    ]);
    const agents = countAgentsByPath(usage);

    return {
      roots: [...roots],
      documents: listed.map((doc, index) => ({
        path: doc.path,
        type: doc.type,
        tokens: tokens[index] ?? 0,
        agent_count: agents.get(doc.path) ?? 0,
      })),
    };
  }

  async getDocument(workspaceId: string, repoId: string, path: string): Promise<SpecDocument> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const clonePath = repo.clonePath;
    if (clonePath === null) throw new NotFoundError('Document not found');

    const entry = (await this.classified(clonePath)).find((doc) => doc.path === path);
    if (!entry) throw new NotFoundError('Document not found');

    const content = await this.deps.docs.readText(clonePath, entry.path);
    if (content === null) throw new NotFoundError('Document not found');
    return { path: entry.path, type: entry.type, tokens: docTokens(content), content };
  }

  async getAgentContext(workspaceId: string, agentId: string): Promise<ContextAttachments> {
    await this.requireOwner(this.deps.agents, workspaceId, agentId, 'Agent');
    return this.agentContext(agentId);
  }

  async setAgentContext(
    workspaceId: string,
    agentId: string,
    paths: readonly string[],
  ): Promise<ContextAttachments> {
    await this.requireOwner(this.deps.agents, workspaceId, agentId, 'Agent');
    await this.deps.store.replaceAgentPaths(agentId, paths);
    return this.agentContext(agentId);
  }

  async getSkillContext(workspaceId: string, skillId: string): Promise<ContextAttachments> {
    await this.requireOwner(this.deps.skills, workspaceId, skillId, 'Skill');
    return { paths: await this.deps.store.skillPaths(skillId) };
  }

  async setSkillContext(
    workspaceId: string,
    skillId: string,
    paths: readonly string[],
  ): Promise<ContextAttachments> {
    await this.requireOwner(this.deps.skills, workspaceId, skillId, 'Skill');
    await this.deps.store.replaceSkillPaths(skillId, paths);
    return { paths: await this.deps.store.skillPaths(skillId) };
  }

  /**
   * The documents of one run, read from the working tree of the reviewed
   * repository's clone as it stands now. An attached path that the repository's
   * document list does not hold, or whose file is unreadable or empty, is skipped
   * with its reason; the run goes on without it.
   */
  async resolveForRun(workspaceId: string, repoId: string, agentId: string): Promise<RunContext> {
    const repo = await this.requireRepo(workspaceId, repoId);
    await this.requireOwner(this.deps.agents, workspaceId, agentId, 'Agent');

    const merged = await this.mergedFor(agentId);
    if (merged.length === 0) return { documents: [], skipped: [] };

    const clonePath = repo.clonePath;
    const listed = new Set(
      clonePath === null ? [] : (await this.classified(clonePath)).map((doc) => doc.path),
    );
    const texts = await mapInBatches(merged, READ_CONCURRENCY, async (entry) =>
      clonePath !== null && listed.has(entry.path)
        ? this.deps.docs.readText(clonePath, entry.path)
        : undefined,
    );

    const documents: RunContextDocument[] = [];
    const skipped: RunContextSkip[] = [];
    merged.forEach((entry, index) => {
      const text = texts[index];
      if (text === undefined) skipped.push({ path: entry.path, reason: SKIP_NOT_FOUND });
      else if (text === null) skipped.push({ path: entry.path, reason: SKIP_UNREADABLE });
      else if (text.length === 0) skipped.push({ path: entry.path, reason: SKIP_EMPTY });
      else {
        documents.push({
          path: entry.path,
          text,
          tokens: docTokens(text),
          source: entry.source,
          skillName: entry.skillName,
        });
      }
    });
    return { documents, skipped };
  }

  async resolveForWorkspace(workspaceId: string, repoId: string): Promise<WorkspaceDocument[]> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const clonePath = repo.clonePath;
    if (clonePath === null) return [];

    const attached = new Set((await this.deps.store.usage(workspaceId)).map((row) => row.path));
    if (attached.size === 0) return [];

    const listed = (await this.classified(clonePath)).filter((doc) => attached.has(doc.path));
    const texts = await mapInBatches(listed, READ_CONCURRENCY, (doc) =>
      this.deps.docs.readText(clonePath, doc.path),
    );

    const documents: WorkspaceDocument[] = [];
    listed.forEach((doc, index) => {
      const text = texts[index];
      if (text) documents.push({ path: doc.path, text });
    });
    return documents;
  }

  private async agentContext(agentId: string): Promise<ContextAttachments> {
    const [paths, linked] = await Promise.all([
      this.deps.store.agentPaths(agentId),
      this.deps.store.linkedSkillPaths(agentId),
    ]);
    const inherited = mergeAttachments(paths, linked).flatMap((entry) =>
      entry.source === 'skill'
        ? [{ path: entry.path, skill_id: entry.skillId, skill_name: entry.skillName }]
        : [],
    );
    return { paths, inherited };
  }

  private async mergedFor(agentId: string): Promise<MergedAttachment[]> {
    const [own, linked] = await Promise.all([
      this.deps.store.agentPaths(agentId),
      this.deps.store.linkedSkillPaths(agentId),
    ]);
    return mergeAttachments(own, linked);
  }

  private async classified(clonePath: string): Promise<ClassifiedDocument[]> {
    return classifyDocuments(await this.deps.docs.listMarkdown(clonePath), this.deps.roots);
  }

  private async requireRepo(workspaceId: string, repoId: string) {
    const repo = await this.deps.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');
    return repo;
  }

  private async requireOwner(
    reader: ContextOwnerReader,
    workspaceId: string,
    id: string,
    label: string,
  ): Promise<void> {
    if (!(await reader.getById(workspaceId, id))) throw new NotFoundError(`${label} not found`);
  }
}
