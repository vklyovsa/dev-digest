import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { COUNTED_STATUSES, LATENCY_STATUS } from './constants.js';
import type {
  AgentPerformanceStore,
  AgentRef,
  DecisionAggregate,
  ModelCost,
  PerfRange,
  RunAggregate,
  SeriesCount,
} from './types.js';

export class AgentPerformanceRepository implements AgentPerformanceStore {
  constructor(private db: Db) {}

  private countedRuns(workspaceId: string, range: PerfRange, agentId?: string) {
    return and(
      eq(t.agentRuns.workspaceId, workspaceId),
      gte(t.agentRuns.ranAt, range.from),
      lt(t.agentRuns.ranAt, range.to),
      inArray(t.agentRuns.status, [...COUNTED_STATUSES]),
      agentId ? eq(t.agentRuns.agentId, agentId) : undefined,
    );
  }

  async listAgents(workspaceId: string): Promise<AgentRef[]> {
    return this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId));
  }

  async getAgent(workspaceId: string, id: string): Promise<AgentRef | undefined> {
    const [row] = await this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)));
    return row;
  }

  async runAggregates(
    workspaceId: string,
    range: PerfRange,
    agentId?: string,
  ): Promise<RunAggregate[]> {
    const rows = await this.db
      .select({
        agentId: t.agentRuns.agentId,
        runs: sql<string>`count(*)`,
        pricedRuns: sql<string>`count(${t.agentRuns.costUsd})`,
        doneRuns: sql<string>`count(*) filter (where ${t.agentRuns.status} = ${LATENCY_STATUS})`,
        totalCostUsd: sql<number | null>`sum(${t.agentRuns.costUsd})`,
        billedUsd: sql<string>`coalesce(sum(${t.agentRuns.costBilledUsd}), 0)`,
        estimatedUsd: sql<string>`coalesce(sum(${t.agentRuns.costEstimatedUsd}), 0)`,
        unknownUsd: sql<string>`coalesce(sum(${t.agentRuns.costUsd}) filter (where ${t.agentRuns.costBilledUsd} is null and ${t.agentRuns.costEstimatedUsd} is null), 0)`,
        avgLatencyMs: sql<
          string | null
        >`avg(${t.agentRuns.durationMs}) filter (where ${t.agentRuns.status} = ${LATENCY_STATUS})`,
        lastRunAt: sql<Date | null>`max(${t.agentRuns.ranAt})`,
      })
      .from(t.agentRuns)
      .where(this.countedRuns(workspaceId, range, agentId))
      .groupBy(t.agentRuns.agentId);
    return rows.map((r) => ({
      agentId: r.agentId,
      runs: Number(r.runs),
      pricedRuns: Number(r.pricedRuns),
      doneRuns: Number(r.doneRuns),
      totalCostUsd: r.totalCostUsd === null ? null : Number(r.totalCostUsd),
      billedUsd: Number(r.billedUsd),
      estimatedUsd: Number(r.estimatedUsd),
      unknownUsd: Number(r.unknownUsd),
      avgLatencyMs: r.avgLatencyMs === null ? null : Number(r.avgLatencyMs),
      lastRunAt: r.lastRunAt === null ? null : new Date(r.lastRunAt),
    }));
  }

  async decisionAggregates(
    workspaceId: string,
    range: PerfRange,
    agentId?: string,
  ): Promise<DecisionAggregate[]> {
    const rows = await this.db
      .select({
        agentId: t.agentRuns.agentId,
        accepted: sql<string>`count(*) filter (where ${t.findings.acceptedAt} is not null)`,
        dismissed: sql<string>`count(*) filter (where ${t.findings.dismissedAt} is not null)`,
      })
      .from(t.agentRuns)
      .innerJoin(
        t.reviews,
        and(eq(t.reviews.runId, t.agentRuns.id), eq(t.reviews.workspaceId, workspaceId)),
      )
      .innerJoin(t.findings, eq(t.findings.reviewId, t.reviews.id))
      .where(this.countedRuns(workspaceId, range, agentId))
      .groupBy(t.agentRuns.agentId);
    return rows.map((r) => ({
      agentId: r.agentId,
      accepted: Number(r.accepted),
      dismissed: Number(r.dismissed),
    }));
  }

  async costByModel(workspaceId: string, range: PerfRange): Promise<ModelCost[]> {
    const rows = await this.db
      .select({
        model: t.agentRuns.model,
        costUsd: sql<number>`sum(${t.agentRuns.costUsd})`,
        billedUsd: sql<string>`coalesce(sum(${t.agentRuns.costBilledUsd}), 0)`,
        estimatedUsd: sql<string>`coalesce(sum(${t.agentRuns.costEstimatedUsd}), 0)`,
        unknownUsd: sql<string>`coalesce(sum(${t.agentRuns.costUsd}) filter (where ${t.agentRuns.costBilledUsd} is null and ${t.agentRuns.costEstimatedUsd} is null), 0)`,
      })
      .from(t.agentRuns)
      .where(and(this.countedRuns(workspaceId, range), isNotNull(t.agentRuns.costUsd)))
      .groupBy(t.agentRuns.model);
    return rows.map((r) => ({
      model: r.model,
      costUsd: Number(r.costUsd),
      billedUsd: Number(r.billedUsd),
      estimatedUsd: Number(r.estimatedUsd),
      unknownUsd: Number(r.unknownUsd),
    }));
  }

  async runsSeries(
    workspaceId: string,
    range: PerfRange,
    bucketMs: number,
  ): Promise<SeriesCount[]> {
    const fromMs = range.from.getTime();
    const bucket = sql<number>`floor((extract(epoch from ${t.agentRuns.ranAt}) * 1000 - ${fromMs}::double precision) / ${bucketMs}::double precision)::int`;
    const rows = await this.db
      .select({ bucket, runs: sql<string>`count(*)` })
      .from(t.agentRuns)
      .where(this.countedRuns(workspaceId, range))
      .groupBy(sql`1`);
    return rows.map((r) => ({ bucket: Number(r.bucket), runs: Number(r.runs) }));
  }
}
