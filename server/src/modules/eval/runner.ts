import { reviewPullRequest } from '@devdigest/reviewer-core';
import type { Finding, LLMProvider } from '@devdigest/shared';
import { buildCaseReviewInput } from './helpers.js';
import { errorTally, scoreCase, scoreRun, type CaseTally, type LineRange } from './scoring.js';
import type {
  EvalAgentRecord,
  EvalDeps,
  PromptSkill,
  StoredCase,
  StoredExpectationType,
  StoredFindingRef,
  StoredInputMeta,
  StoredOutcome,
  StoredRun,
} from './types.js';

const ERROR_MESSAGE_MAX = 500;

export interface EvalRunJob {
  run: StoredRun;
  agent: EvalAgentRecord;
  skills: PromptSkill[];
  llm: LLMProvider;
  cases: StoredCase[];
}

function rangeOf(ref: { file: string; startLine: number; endLine: number }): LineRange {
  return { file: ref.file, startLine: ref.startLine, endLine: ref.endLine };
}

function refOfFinding(finding: Finding): StoredFindingRef {
  return {
    file: finding.file,
    startLine: finding.start_line,
    endLine: finding.end_line,
    severity: finding.severity,
    category: finding.category,
    title: finding.title,
  };
}

function outcomeOf(c: StoredCase, tally: CaseTally, findings: StoredFindingRef[], error: string | null): StoredOutcome {
  return {
    caseId: c.id,
    caseName: c.name,
    caseRevision: c.revision,
    expectationType: c.expectationType,
    status: tally.status,
    matched: tally.matched,
    findings,
    error,
    produced: tally.produced,
  };
}

export interface CaseExecutionJob {
  agent: EvalAgentRecord;
  skills: PromptSkill[];
  llm: LLMProvider;
  sessionId: string;
}

export interface CaseContent {
  inputDiff: string;
  inputMeta: StoredInputMeta;
  expectationType: StoredExpectationType;
  expectation: LineRange;
}

export interface CaseExecution {
  tally: CaseTally;
  findings: StoredFindingRef[];
  error: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  durationMs: number;
}

/**
 * One engine review of one case content, scored in code. Never throws: a failing
 * review is an `error` tally with the message cut to `ERROR_MESSAGE_MAX`.
 */
export async function executeCase(job: CaseExecutionJob, content: CaseContent): Promise<CaseExecution> {
  const startedAt = Date.now();
  try {
    const result = await reviewPullRequest({
      ...buildCaseReviewInput(job.agent, job.skills, content),
      llm: job.llm,
      sessionId: job.sessionId,
    });
    const kept = result.review.findings;
    const tally = scoreCase({
      expectationType: content.expectationType,
      expectation: content.expectation,
      kept: kept.map((f) => rangeOf({ file: f.file, startLine: f.start_line, endLine: f.end_line })),
      dropped: result.dropped.map((d) =>
        rangeOf({ file: d.finding.file, startLine: d.finding.start_line, endLine: d.finding.end_line }),
      ),
    });
    return {
      tally,
      findings: kept.map(refOfFinding),
      error: null,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, ERROR_MESSAGE_MAX);
    return {
      tally: errorTally(content.expectationType),
      findings: [],
      error: message,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: null,
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * Runs every case of the job one after another as one engine review each, scores
 * them in code and settles the run row in one update. A failing case becomes an
 * `error` outcome; it never stops the others. Writes no review, finding, agent
 * run or trace row.
 */
export async function executeEvalRun(deps: EvalDeps, job: EvalRunJob): Promise<void> {
  const { run, agent, skills, llm, cases } = job;
  const startedAt = Date.now();
  const outcomes: StoredOutcome[] = [];
  const tallies: CaseTally[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd: number | null = 0;

  for (const c of cases) {
    const execution = await executeCase(
      { agent, skills, llm, sessionId: `eval:${run.id}` },
      {
        inputDiff: c.inputDiff,
        inputMeta: c.inputMeta,
        expectationType: c.expectationType,
        expectation: rangeOf(c.expectedOutput),
      },
    );
    if (execution.error === null) {
      tokensIn += execution.tokensIn;
      tokensOut += execution.tokensOut;
      costUsd = costUsd === null || execution.costUsd === null ? null : costUsd + execution.costUsd;
    }
    tallies.push(execution.tally);
    outcomes.push(outcomeOf(c, execution.tally, execution.findings, execution.error));
  }

  const score = scoreRun(tallies);
  const durationMs = Date.now() - startedAt;
  await deps.store.completeRun(run.id, {
    status: 'done',
    error: null,
    recall: score.recall,
    precision: score.precision,
    citationAccuracy: score.citationAccuracy,
    casesTotal: score.casesTotal,
    casesPassed: score.casesPassed,
    casesFailed: score.casesFailed,
    casesErrored: score.casesErrored,
    findingsTotal: score.findingsTotal,
    findingsGrounded: score.findingsGrounded,
    durationMs,
    costUsd,
    results: outcomes,
  });

  deps.log.info(
    {
      runId: run.id,
      agentId: agent.id,
      agentVersion: run.agentVersion,
      ...(run.skillId ? { skillId: run.skillId, skillVersion: run.skillVersion } : {}),
      casesTotal: score.casesTotal,
      casesPassed: score.casesPassed,
      casesFailed: score.casesFailed,
      casesErrored: score.casesErrored,
      recall: score.recall,
      precision: score.precision,
      citationAccuracy: score.citationAccuracy,
      tokensIn,
      tokensOut,
      costUsd,
      durationMs,
    },
    'eval run settled',
  );
}
