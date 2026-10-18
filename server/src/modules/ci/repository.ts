import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { RunTrace } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { INSTALLATION_RUN_WINDOW } from './constants.js';
import type {
  CiStore,
  GhaInstallation,
  MemoryRecord,
  NewFailedRun,
  NewIngestedRun,
  StoredCiRun,
  StoredInstallation,
} from './types.js';

type InstallationRow = typeof t.ciInstallations.$inferSelect;

const traceRunUrl = sql`${t.runTraces.trace}->'ci'->>'run_url'`;

function traceInt(key: string): SQL<number | null> {
  return sql<number | null>`(${t.runTraces.trace}->'ci'->>${key})::int`;
}

export class CiRepository implements CiStore {
  constructor(private db: Db) {}

  async findInstallationForRepo(
    workspaceId: string,
    repo: string,
  ): Promise<{ id: string; agentId: string } | undefined> {
    const [row] = await this.db
      .select({ id: t.ciInstallations.id, agentId: t.ciInstallations.agentId })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.repo, repo)))
      .limit(1);
    return row;
  }

  async upsertInstallation(agentId: string, repo: string): Promise<StoredInstallation> {
    const [existing] = await this.db
      .select()
      .from(t.ciInstallations)
      .where(and(eq(t.ciInstallations.agentId, agentId), eq(t.ciInstallations.repo, repo)))
      .limit(1);
    let row: InstallationRow;
    if (existing) {
      const [updated] = await this.db
        .update(t.ciInstallations)
        .set({ installedAt: sql`now()` })
        .where(eq(t.ciInstallations.id, existing.id))
        .returning();
      row = updated!;
    } else {
      const [inserted] = await this.db
        .insert(t.ciInstallations)
        .values({ agentId, repo, targetType: 'gha' })
        .returning();
      row = inserted!;
    }
    const [withLatest] = await this.withLatest([row]);
    return withLatest!;
  }

  async listInstallationsForAgent(agentId: string): Promise<StoredInstallation[]> {
    const rows = await this.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId))
      .orderBy(desc(t.ciInstallations.installedAt));
    return this.withLatest(rows);
  }

  private async withLatest(rows: InstallationRow[]): Promise<StoredInstallation[]> {
    if (rows.length === 0) return [];
    const runs = await this.db
      .select({
        installationId: t.ciRuns.ciInstallationId,
        status: t.ciRuns.status,
        ranAt: t.ciRuns.ranAt,
        hasTrace: sql<boolean>`${t.runTraces.runId} is not null`,
        manifestVersion: traceInt('manifest_version'),
      })
      .from(t.ciRuns)
      .leftJoin(t.runTraces, sql`${traceRunUrl} = ${t.ciRuns.githubUrl}`)
      .where(inArray(t.ciRuns.ciInstallationId, rows.map((r) => r.id)))
      .orderBy(sql`${t.ciRuns.ranAt} desc nulls last`)
      .limit(INSTALLATION_RUN_WINDOW);

    return rows.map((r) => {
      const mine = runs.filter((x) => x.installationId === r.id);
      const latest = mine[0];
      const ingested = mine.find((x) => x.hasTrace);
      return {
        id: r.id,
        agentId: r.agentId,
        repo: r.repo,
        targetType: r.targetType,
        installedAt: r.installedAt,
        latestRunStatus: latest?.status ?? null,
        latestRunAt: latest?.ranAt ?? null,
        manifestVersion: ingested?.manifestVersion ?? null,
      };
    });
  }

  async globalMemory(workspaceId: string): Promise<MemoryRecord[]> {
    return this.db
      .select({ kind: t.memory.kind, scope: t.memory.scope, content: t.memory.content })
      .from(t.memory)
      .where(and(eq(t.memory.workspaceId, workspaceId), eq(t.memory.scope, 'global')))
      .orderBy(t.memory.createdAt);
  }

  async listGhaInstallations(workspaceId: string): Promise<GhaInstallation[]> {
    return this.db
      .select({
        id: t.ciInstallations.id,
        agentId: t.ciInstallations.agentId,
        repo: t.ciInstallations.repo,
        agentName: t.agents.name,
      })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.targetType, 'gha')));
  }

  async ciRunExists(githubUrl: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.ciRuns.id })
      .from(t.ciRuns)
      .where(eq(t.ciRuns.githubUrl, githubUrl))
      .limit(1);
    return Boolean(row);
  }

  async insertFailedRun(run: NewFailedRun): Promise<void> {
    await this.db.insert(t.ciRuns).values({
      ciInstallationId: run.installationId,
      prNumber: run.prNumber,
      ranAt: run.ranAt,
      status: 'failed',
      findingsCount: null,
      costUsd: null,
      githubUrl: run.githubUrl,
      source: 'gha',
    });
  }

  async insertIngestedRun(input: NewIngestedRun): Promise<void> {
    const { artifact, run } = input;
    const ranAt = new Date(run.startedAt);
    const prNumber = artifact.pr_number ?? run.prNumber;
    const trace: RunTrace = {
      config: {
        agent: artifact.agent,
        version: artifact.manifest_version?.toString() ?? null,
        provider: 'openrouter',
        model: artifact.model,
        pr: prNumber,
        source: 'ci',
      },
      stats: {
        duration_ms: artifact.duration_ms ?? 0,
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: artifact.cost_usd,
        findings: artifact.findings_count,
        grounding: '',
      },
      prompt_assembly: { system: '', user: '' },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      log: [],
      ci: {
        repo: input.repo,
        repository_id: input.repositoryId,
        pr_number: prNumber ?? 0,
        head_sha: artifact.head_sha,
        run_url: run.htmlUrl,
        manifest_version: artifact.manifest_version,
        model: artifact.model,
        runner_version: artifact.version ?? null,
        verdict: artifact.verdict,
        critical: artifact.critical ?? 0,
        warning: artifact.warning ?? 0,
        suggestion: artifact.suggestion ?? 0,
      },
    };

    await this.db.transaction(async (tx) => {
      const [agentRun] = await tx
        .insert(t.agentRuns)
        .values({
          workspaceId: input.workspaceId,
          agentId: input.agentId,
          prId: null,
          ranAt,
          provider: 'openrouter',
          model: artifact.model,
          durationMs: artifact.duration_ms ?? null,
          costUsd: artifact.cost_usd,
          status: 'done',
          source: 'ci',
          findingsCount: artifact.findings_count,
          blockers: artifact.blockers,
        })
        .returning({ id: t.agentRuns.id });
      await tx.insert(t.runTraces).values({ runId: agentRun!.id, trace });
      await tx.insert(t.ciRuns).values({
        ciInstallationId: input.installationId,
        prNumber,
        ranAt,
        status: artifact.findings_count > 0 ? 'succeeded' : 'no_findings',
        findingsCount: artifact.findings_count,
        costUsd: artifact.cost_usd,
        githubUrl: run.htmlUrl,
        source: 'gha',
      });
    });
  }

  async listRuns(
    workspaceId: string,
    agentId: string | undefined,
    limit: number,
  ): Promise<StoredCiRun[]> {
    const scope = or(
      eq(t.agents.workspaceId, workspaceId),
      eq(t.agentRuns.workspaceId, workspaceId),
    );
    const byAgent = agentId
      ? or(eq(t.ciInstallations.agentId, agentId), eq(t.agentRuns.agentId, agentId))
      : undefined;

    const rows = await this.db
      .select({
        id: t.ciRuns.id,
        installationId: t.ciRuns.ciInstallationId,
        prNumber: t.ciRuns.prNumber,
        ranAt: t.ciRuns.ranAt,
        status: t.ciRuns.status,
        findingsCount: t.ciRuns.findingsCount,
        costUsd: t.ciRuns.costUsd,
        githubUrl: t.ciRuns.githubUrl,
        source: t.ciRuns.source,
        installationAgentId: t.ciInstallations.agentId,
        runAgentId: t.agentRuns.agentId,
        agentName: t.agents.name,
        installationRepo: t.ciInstallations.repo,
        traceRepo: sql<string | null>`${t.runTraces.trace}->'ci'->>'repo'`,
        durationMs: t.agentRuns.durationMs,
        verdict: sql<string | null>`${t.runTraces.trace}->'ci'->>'verdict'`,
        critical: traceInt('critical'),
        warning: traceInt('warning'),
        suggestion: traceInt('suggestion'),
      })
      .from(t.ciRuns)
      .leftJoin(t.ciInstallations, eq(t.ciInstallations.id, t.ciRuns.ciInstallationId))
      .leftJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .leftJoin(t.runTraces, sql`${traceRunUrl} = ${t.ciRuns.githubUrl}`)
      .leftJoin(t.agentRuns, eq(t.agentRuns.id, t.runTraces.runId))
      .where(and(scope, byAgent))
      .orderBy(sql`${t.ciRuns.ranAt} desc nulls last`)
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      installationId: r.installationId,
      prNumber: r.prNumber,
      ranAt: r.ranAt,
      status: r.status,
      findingsCount: r.findingsCount,
      costUsd: r.costUsd,
      githubUrl: r.githubUrl,
      source: r.source,
      agentId: r.installationAgentId ?? r.runAgentId,
      agentName: r.agentName,
      repo: r.installationRepo ?? r.traceRepo ?? '',
      durationMs: r.durationMs,
      verdict: r.verdict,
      critical: r.critical,
      warning: r.warning,
      suggestion: r.suggestion,
    }));
  }
}
