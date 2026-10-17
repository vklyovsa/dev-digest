import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  AgentTrendPoint,
  CasePatch,
  DoneRunCoverage,
  EvalStore,
  NewCase,
  NewRun,
  RunCompletion,
  StoredCase,
  StoredFindingRef,
  StoredOutcome,
  StoredRun,
  StoredRunSummary,
} from './types.js';

type CaseRow = typeof t.evalCases.$inferSelect;
type RunRow = typeof t.evalRuns.$inferSelect;
type StoredRef = NonNullable<CaseRow['expectedOutput']>;
type StoredResult = RunRow['results'][number];

const EMPTY_REF: StoredFindingRef = {
  file: '',
  startLine: 0,
  endLine: 0,
  severity: '',
  category: '',
  title: '',
};

const RUN_SUMMARY_COLUMNS = {
  id: t.evalRuns.id,
  workspaceId: t.evalRuns.workspaceId,
  agentId: t.evalRuns.agentId,
  agentVersion: t.evalRuns.agentVersion,
  skillId: t.evalRuns.skillId,
  skillVersion: t.evalRuns.skillVersion,
  status: t.evalRuns.status,
  error: t.evalRuns.error,
  ranAt: t.evalRuns.ranAt,
  recall: t.evalRuns.recall,
  precision: t.evalRuns.precision,
  citationAccuracy: t.evalRuns.citationAccuracy,
  durationMs: t.evalRuns.durationMs,
  costUsd: t.evalRuns.costUsd,
  casesTotal: t.evalRuns.casesTotal,
  casesPassed: t.evalRuns.casesPassed,
  casesFailed: t.evalRuns.casesFailed,
  casesErrored: t.evalRuns.casesErrored,
  findingsTotal: t.evalRuns.findingsTotal,
  findingsGrounded: t.evalRuns.findingsGrounded,
  provider: t.evalRuns.provider,
  model: t.evalRuns.model,
  skills: t.evalRuns.skills,
  caseIds: t.evalRuns.caseIds,
} as const;

function refFromRow(ref: StoredRef | null): StoredFindingRef {
  if (!ref) return EMPTY_REF;
  return {
    file: ref.file,
    startLine: ref.start_line,
    endLine: ref.end_line,
    severity: ref.severity,
    category: ref.category,
    title: ref.title,
  };
}

function refToRow(ref: StoredFindingRef): StoredRef {
  return {
    file: ref.file,
    start_line: ref.startLine,
    end_line: ref.endLine,
    severity: ref.severity,
    category: ref.category,
    title: ref.title,
  };
}

function caseFromRow(row: CaseRow): StoredCase {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    ownerKind: row.ownerKind,
    ownerId: row.ownerId,
    name: row.name,
    expectationType: row.expectationType,
    expectedOutput: refFromRow(row.expectedOutput),
    inputDiff: row.inputDiff ?? '',
    inputFiles: row.inputFiles ?? [],
    inputMeta: row.inputMeta
      ? {
          prNumber: row.inputMeta.pr_number,
          prTitle: row.inputMeta.pr_title,
          prAuthor: row.inputMeta.pr_author,
          prBody: row.inputMeta.pr_body,
        }
      : { prNumber: 0, prTitle: '', prAuthor: '', prBody: null },
    sourceFindingId: row.sourceFindingId,
    notes: row.notes,
    revision: row.revision,
    createdAt: row.createdAt,
  };
}

function outcomeFromRow(result: StoredResult): StoredOutcome {
  return {
    caseId: result.case_id,
    caseName: result.case_name,
    caseRevision: result.case_revision ?? 1,
    expectationType: result.expectation_type,
    status: result.status,
    matched: result.matched,
    findings: result.findings.map((finding) => refFromRow(finding)),
    error: result.error,
    produced: result.produced,
  };
}

function outcomeToRow(outcome: StoredOutcome): StoredResult {
  return {
    case_id: outcome.caseId,
    case_name: outcome.caseName,
    case_revision: outcome.caseRevision,
    expectation_type: outcome.expectationType,
    status: outcome.status,
    matched: outcome.matched,
    produced: outcome.produced,
    findings: outcome.findings.map(refToRow),
    error: outcome.error,
  };
}

type SummaryRow = Omit<RunRow, 'results'>;

function summaryFromRow(row: SummaryRow): StoredRunSummary {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    agentId: row.agentId,
    agentVersion: row.agentVersion,
    skillId: row.skillId,
    skillVersion: row.skillVersion,
    status: row.status,
    startedAt: row.ranAt,
    durationMs: row.durationMs,
    recall: row.recall,
    precision: row.precision,
    citationAccuracy: row.citationAccuracy,
    casesTotal: row.casesTotal,
    casesPassed: row.casesPassed,
    casesFailed: row.casesFailed,
    casesErrored: row.casesErrored,
    findingsTotal: row.findingsTotal,
    findingsGrounded: row.findingsGrounded,
    costUsd: row.costUsd,
    provider: row.provider,
    model: row.model,
    skills: row.skills,
    caseIds: row.caseIds,
    error: row.error,
  };
}

function runFromRow(row: RunRow): StoredRun {
  return { ...summaryFromRow(row), results: row.results.map(outcomeFromRow) };
}

/**
 * Cases and runs of the eval pipeline. Every method that takes a workspace id
 * filters by it; row types stop at this file.
 */
export class EvalRepository implements EvalStore {
  constructor(private db: Db) {}

  // ---- cases ---------------------------------------------------------------

  async findCaseBySourceFinding(
    workspaceId: string,
    findingId: string,
  ): Promise<StoredCase | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.sourceFindingId, findingId)),
      );
    return row ? caseFromRow(row) : undefined;
  }

  /** Two clicks yield one row: the partial unique index on `source_finding_id` refuses the second. */
  async insertCase(
    workspaceId: string,
    values: NewCase,
  ): Promise<{ case: StoredCase; created: boolean } | undefined> {
    const [inserted] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        expectationType: values.expectationType,
        expectedOutput: refToRow(values.expectedOutput),
        inputDiff: values.inputDiff,
        inputFiles: values.inputFiles,
        inputMeta: {
          pr_number: values.inputMeta.prNumber,
          pr_title: values.inputMeta.prTitle,
          pr_author: values.inputMeta.prAuthor,
          pr_body: values.inputMeta.prBody,
        },
        sourceFindingId: values.sourceFindingId,
        notes: values.notes,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return { case: caseFromRow(inserted), created: true };

    const existing = values.sourceFindingId
      ? await this.findCaseBySourceFinding(workspaceId, values.sourceFindingId)
      : undefined;
    return existing ? { case: existing, created: false } : undefined;
  }

  async listCasesForAgent(workspaceId: string, agentId: string): Promise<StoredCase[]> {
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
        ),
      )
      .orderBy(asc(t.evalCases.createdAt), asc(t.evalCases.id));
    return rows.map(caseFromRow);
  }

  async listCasesForSkill(workspaceId: string, skillId: string): Promise<StoredCase[]> {
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'skill'),
          eq(t.evalCases.ownerId, skillId),
        ),
      )
      .orderBy(asc(t.evalCases.createdAt), asc(t.evalCases.id));
    return rows.map(caseFromRow);
  }

  async getCase(workspaceId: string, caseId: string): Promise<StoredCase | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)));
    return row ? caseFromRow(row) : undefined;
  }

  /** Never writes the type, owner, source finding or creation time; the revision is bumped in SQL. */
  async updateCase(
    workspaceId: string,
    caseId: string,
    patch: CasePatch,
  ): Promise<StoredCase | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        name: patch.name,
        inputDiff: patch.inputDiff,
        inputFiles: patch.inputFiles,
        inputMeta: {
          pr_number: patch.inputMeta.prNumber,
          pr_title: patch.inputMeta.prTitle,
          pr_author: patch.inputMeta.prAuthor,
          pr_body: patch.inputMeta.prBody,
        },
        expectedOutput: refToRow(patch.expectedOutput),
        ...(patch.bumpRevision ? { revision: sql`${t.evalCases.revision} + 1` } : {}),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning();
    return row ? caseFromRow(row) : undefined;
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ---- runs ----------------------------------------------------------------

  async listDoneRunsForAgent(
    workspaceId: string,
    agentId: string,
    limit: number,
  ): Promise<DoneRunCoverage[]> {
    const rows = await this.db
      .select({
        id: t.evalRuns.id,
        caseIds: t.evalRuns.caseIds,
        results: t.evalRuns.results,
      })
      .from(t.evalRuns)
      .where(
        and(
          eq(t.evalRuns.workspaceId, workspaceId),
          eq(t.evalRuns.agentId, agentId),
          isNull(t.evalRuns.skillId),
          eq(t.evalRuns.status, 'done'),
        ),
      )
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      caseIds: row.caseIds,
      results: row.results.map(outcomeFromRow),
    }));
  }

  async listDoneRunsForSkill(
    workspaceId: string,
    skillId: string,
    limit: number,
  ): Promise<DoneRunCoverage[]> {
    const rows = await this.db
      .select({
        id: t.evalRuns.id,
        caseIds: t.evalRuns.caseIds,
        results: t.evalRuns.results,
      })
      .from(t.evalRuns)
      .where(
        and(
          eq(t.evalRuns.workspaceId, workspaceId),
          eq(t.evalRuns.skillId, skillId),
          eq(t.evalRuns.status, 'done'),
        ),
      )
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      caseIds: row.caseIds,
      results: row.results.map(outcomeFromRow),
    }));
  }

  /** `null` when the agent (or the skill) already has a running run: a partial unique index refuses a second. */
  async insertRunningRun(workspaceId: string, values: NewRun): Promise<StoredRun | null> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        workspaceId,
        agentId: values.agentId,
        agentVersion: values.agentVersion,
        skillId: values.skillId,
        skillVersion: values.skillVersion,
        status: 'running',
        provider: values.provider,
        model: values.model,
        skills: values.skills,
        caseIds: values.caseIds,
        casesTotal: values.casesTotal,
      })
      .onConflictDoNothing()
      .returning();
    return row ? runFromRow(row) : null;
  }

  async findRunningRun(
    workspaceId: string,
    agentId: string,
  ): Promise<StoredRunSummary | undefined> {
    const [row] = await this.db
      .select(RUN_SUMMARY_COLUMNS)
      .from(t.evalRuns)
      .where(
        and(
          eq(t.evalRuns.workspaceId, workspaceId),
          eq(t.evalRuns.agentId, agentId),
          isNull(t.evalRuns.skillId),
          eq(t.evalRuns.status, 'running'),
        ),
      );
    return row ? summaryFromRow(row) : undefined;
  }

  async findRunningSkillRun(
    workspaceId: string,
    skillId: string,
  ): Promise<StoredRunSummary | undefined> {
    const [row] = await this.db
      .select(RUN_SUMMARY_COLUMNS)
      .from(t.evalRuns)
      .where(
        and(
          eq(t.evalRuns.workspaceId, workspaceId),
          eq(t.evalRuns.skillId, skillId),
          eq(t.evalRuns.status, 'running'),
        ),
      );
    return row ? summaryFromRow(row) : undefined;
  }

  /** One update, so a reader never sees a `done` run without its outcomes. */
  async completeRun(runId: string, patch: RunCompletion): Promise<void> {
    await this.db
      .update(t.evalRuns)
      .set({
        status: patch.status,
        error: patch.error,
        recall: patch.recall,
        precision: patch.precision,
        citationAccuracy: patch.citationAccuracy,
        casesTotal: patch.casesTotal,
        casesPassed: patch.casesPassed,
        casesFailed: patch.casesFailed,
        casesErrored: patch.casesErrored,
        findingsTotal: patch.findingsTotal,
        findingsGrounded: patch.findingsGrounded,
        durationMs: patch.durationMs,
        costUsd: patch.costUsd,
        results: patch.results.map(outcomeToRow),
      })
      .where(eq(t.evalRuns.id, runId));
  }

  async listRunsForAgent(
    workspaceId: string,
    agentId: string,
    limit: number,
  ): Promise<StoredRunSummary[]> {
    const rows = await this.db
      .select(RUN_SUMMARY_COLUMNS)
      .from(t.evalRuns)
      .where(
        and(
          eq(t.evalRuns.workspaceId, workspaceId),
          eq(t.evalRuns.agentId, agentId),
          isNull(t.evalRuns.skillId),
        ),
      )
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
    return rows.map(summaryFromRow);
  }

  async listRunsForSkill(
    workspaceId: string,
    skillId: string,
    limit: number,
  ): Promise<StoredRunSummary[]> {
    const rows = await this.db
      .select(RUN_SUMMARY_COLUMNS)
      .from(t.evalRuns)
      .where(and(eq(t.evalRuns.workspaceId, workspaceId), eq(t.evalRuns.skillId, skillId)))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
    return rows.map(summaryFromRow);
  }

  async getRun(workspaceId: string, runId: string): Promise<StoredRun | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalRuns)
      .where(and(eq(t.evalRuns.workspaceId, workspaceId), eq(t.evalRuns.id, runId)));
    return row ? runFromRow(row) : undefined;
  }

  /** Boot reaper: every run left `running` by a dead process. Not workspace-scoped, like the review reaper. */
  async failRunningRuns(error: string): Promise<number> {
    const rows = await this.db
      .update(t.evalRuns)
      .set({ status: 'failed', error })
      .where(eq(t.evalRuns.status, 'running'))
      .returning({ id: t.evalRuns.id });
    return rows.length;
  }

  async latestDoneRunPerAgent(workspaceId: string): Promise<StoredRunSummary[]> {
    const rows = await this.db
      .selectDistinctOn([t.evalRuns.agentId], RUN_SUMMARY_COLUMNS)
      .from(t.evalRuns)
      .where(
        and(
          eq(t.evalRuns.workspaceId, workspaceId),
          eq(t.evalRuns.status, 'done'),
          isNull(t.evalRuns.skillId),
        ),
      )
      .orderBy(t.evalRuns.agentId, desc(t.evalRuns.ranAt));
    return rows.map(summaryFromRow);
  }

  async recentDoneRuns(workspaceId: string, limit: number): Promise<StoredRunSummary[]> {
    const rows = await this.db
      .select(RUN_SUMMARY_COLUMNS)
      .from(t.evalRuns)
      .where(
        and(
          eq(t.evalRuns.workspaceId, workspaceId),
          eq(t.evalRuns.status, 'done'),
          isNull(t.evalRuns.skillId),
        ),
      )
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
    return rows.map(summaryFromRow);
  }

  async caseCountsByAgent(workspaceId: string): Promise<{ agentId: string; count: number }[]> {
    const rows = await this.db
      .select({ agentId: t.evalCases.ownerId, count: count() })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'agent')))
      .groupBy(t.evalCases.ownerId);
    return rows.map((row) => ({ agentId: row.agentId, count: Number(row.count) }));
  }

  async runningAgentIds(workspaceId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ agentId: t.evalRuns.agentId })
      .from(t.evalRuns)
      .where(
        and(
          eq(t.evalRuns.workspaceId, workspaceId),
          eq(t.evalRuns.status, 'running'),
          isNull(t.evalRuns.skillId),
        ),
      );
    return rows.map((row) => row.agentId);
  }

  async trendPerAgent(workspaceId: string, perAgent: number): Promise<AgentTrendPoint[]> {
    const ranked = this.db
      .select({
        agentId: t.evalRuns.agentId,
        ranAt: t.evalRuns.ranAt,
        recall: t.evalRuns.recall,
        precision: t.evalRuns.precision,
        citationAccuracy: t.evalRuns.citationAccuracy,
        rn: sql<number>`row_number() over (partition by ${t.evalRuns.agentId} order by ${t.evalRuns.ranAt} desc)`.as(
          'rn',
        ),
      })
      .from(t.evalRuns)
      .where(
        and(
          eq(t.evalRuns.workspaceId, workspaceId),
          eq(t.evalRuns.status, 'done'),
          isNull(t.evalRuns.skillId),
        ),
      )
      .as('ranked');
    const rows = await this.db
      .select({
        agentId: ranked.agentId,
        recall: ranked.recall,
        precision: ranked.precision,
        citationAccuracy: ranked.citationAccuracy,
      })
      .from(ranked)
      .where(sql`${ranked.rn} <= ${perAgent}`)
      .orderBy(asc(ranked.agentId), asc(ranked.ranAt));
    return rows;
  }
}
