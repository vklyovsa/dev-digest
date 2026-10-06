import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ContextStore, ContextUsageRow, LinkedSkillPath } from './types.js';

/**
 * Project Context data access: the ordered path lists attached to agents and to
 * skills. No document text is stored here, only the path and its position.
 */
export class ContextRepository implements ContextStore {
  constructor(private db: Db) {}

  async agentPaths(agentId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.agentContextDocs.path })
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.agentId, agentId))
      .orderBy(asc(t.agentContextDocs.position));
    return rows.map((r) => r.path);
  }

  async skillPaths(skillId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.skillContextDocs.path })
      .from(t.skillContextDocs)
      .where(eq(t.skillContextDocs.skillId, skillId))
      .orderBy(asc(t.skillContextDocs.position));
    return rows.map((r) => r.path);
  }

  /** Replace the whole list: delete and insert (position = index) in one transaction. */
  async replaceAgentPaths(agentId: string, paths: readonly string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.agentContextDocs).where(eq(t.agentContextDocs.agentId, agentId));
      if (paths.length === 0) return;
      await tx
        .insert(t.agentContextDocs)
        .values(paths.map((path, position) => ({ agentId, path, position })));
    });
  }

  async replaceSkillPaths(skillId: string, paths: readonly string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.skillContextDocs).where(eq(t.skillContextDocs.skillId, skillId));
      if (paths.length === 0) return;
      await tx
        .insert(t.skillContextDocs)
        .values(paths.map((path, position) => ({ skillId, path, position })));
    });
  }

  /**
   * Documents of the skills linked to an agent: ENABLED skills only, in
   * `agent_skills.order`, then the skill id, then the document's position.
   */
  async linkedSkillPaths(agentId: string): Promise<LinkedSkillPath[]> {
    return this.db
      .select({
        skillId: t.skills.id,
        skillName: t.skills.name,
        path: t.skillContextDocs.path,
      })
      .from(t.agentSkills)
      .innerJoin(t.skills, and(eq(t.agentSkills.skillId, t.skills.id), eq(t.skills.enabled, true)))
      .innerJoin(t.skillContextDocs, eq(t.skillContextDocs.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order), asc(t.skills.id), asc(t.skillContextDocs.position));
  }

  /**
   * Every (path, agent) pair in the workspace: attached directly, or through a
   * linked, enabled skill. Two queries for the whole list, never one per document.
   */
  async usage(workspaceId: string): Promise<ContextUsageRow[]> {
    const [direct, viaSkills] = await Promise.all([
      this.db
        .select({ path: t.agentContextDocs.path, agentId: t.agentContextDocs.agentId })
        .from(t.agentContextDocs)
        .innerJoin(t.agents, eq(t.agentContextDocs.agentId, t.agents.id))
        .where(eq(t.agents.workspaceId, workspaceId)),
      this.db
        .select({ path: t.skillContextDocs.path, agentId: t.agentSkills.agentId })
        .from(t.skillContextDocs)
        .innerJoin(
          t.skills,
          and(eq(t.skillContextDocs.skillId, t.skills.id), eq(t.skills.enabled, true)),
        )
        .innerJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skills.id))
        .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
        .where(eq(t.agents.workspaceId, workspaceId)),
    ]);
    return [...direct, ...viaSkills];
  }
}
