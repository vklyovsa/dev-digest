import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export interface RunHead {
  id: string;
  prId: string;
  ranAt: Date;
  prNumber: number | null;
  prTitle: string | null;
}

export interface ChildRun {
  runId: string;
  agentId: string | null;
  agentName: string | null;
  provider: string | null;
  model: string | null;
  status: string | null;
  error: string | null;
  durationMs: number | null;
  costUsd: number | null;
  score: number | null;
}

export interface AgentEstimateRow {
  agentId: string;
  durationMs: number | null;
  costUsd: number | null;
}

/** Data access for `multi_agent_runs`; children are written only by the reviews module. */
export class MultiAgentRepository {
  constructor(private db: Db) {}

  async pullInWorkspace(workspaceId: string, prId: string): Promise<{ id: string } | undefined> {
    const [row] = await this.db
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.id, prId), eq(t.pullRequests.workspaceId, workspaceId)));
    return row;
  }

  async countAgents(workspaceId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), inArray(t.agents.id, ids)));
    return rows.length;
  }

  async repoInWorkspace(workspaceId: string, repoId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.repos.id })
      .from(t.repos)
      .where(and(eq(t.repos.id, repoId), eq(t.repos.workspaceId, workspaceId)));
    return !!row;
  }

  async insertRun(workspaceId: string, prId: string): Promise<string> {
    const [row] = await this.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId })
      .returning({ id: t.multiAgentRuns.id });
    return row!.id;
  }

  async getRunHead(workspaceId: string, id: string): Promise<RunHead | undefined> {
    const [row] = await this.db
      .select({
        id: t.multiAgentRuns.id,
        prId: t.multiAgentRuns.prId,
        ranAt: t.multiAgentRuns.ranAt,
        prNumber: t.pullRequests.number,
        prTitle: t.pullRequests.title,
      })
      .from(t.multiAgentRuns)
      .leftJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
      .where(and(eq(t.multiAgentRuns.id, id), eq(t.multiAgentRuns.workspaceId, workspaceId)));
    return row;
  }

  async children(multiAgentRunId: string): Promise<ChildRun[]> {
    const rows = await this.db
      .select({
        runId: t.agentRuns.id,
        agentId: t.agentRuns.agentId,
        agentName: t.agents.name,
        provider: t.agentRuns.provider,
        model: t.agentRuns.model,
        status: t.agentRuns.status,
        error: t.agentRuns.error,
        durationMs: t.agentRuns.durationMs,
        costUsd: t.agentRuns.costUsd,
        score: t.agentRuns.score,
      })
      .from(t.agentRuns)
      .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
      .where(eq(t.agentRuns.multiAgentRunId, multiAgentRunId));
    return rows;
  }

  async latestRunId(workspaceId: string, repoId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: t.multiAgentRuns.id })
      .from(t.multiAgentRuns)
      .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
      .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.pullRequests.repoId, repoId)))
      .orderBy(desc(t.multiAgentRuns.ranAt))
      .limit(1);
    return row?.id ?? null;
  }

  /** Every agent of the workspace with the numbers of its newest `done` run (null when none). */
  async estimates(workspaceId: string): Promise<AgentEstimateRow[]> {
    const latestDone = this.db
      .selectDistinctOn([t.agentRuns.agentId], {
        agentId: t.agentRuns.agentId,
        durationMs: t.agentRuns.durationMs,
        costUsd: t.agentRuns.costUsd,
      })
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.status, 'done')))
      .orderBy(t.agentRuns.agentId, desc(t.agentRuns.ranAt))
      .as('latest_done');
    const rows = await this.db
      .select({
        agentId: t.agents.id,
        durationMs: latestDone.durationMs,
        costUsd: latestDone.costUsd,
      })
      .from(t.agents)
      .leftJoin(latestDone, eq(latestDone.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId));
    return rows;
  }
}
