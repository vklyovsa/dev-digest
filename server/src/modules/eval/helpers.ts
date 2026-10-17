/**
 * Pure helpers of the eval module (side-effect free: no DB, no network, no clock —
 * time arrives as a parameter where it is needed).
 */
import { groundFindings, type ReviewInput } from '@devdigest/reviewer-core';
import type {
  EvalCase,
  EvalCaseDraft,
  EvalCaseOutcome,
  EvalOutcomeFinding,
  EvalRun,
  EvalRunDetail,
  Finding,
  UnifiedDiff,
} from '@devdigest/shared';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import {
  renderSkillBlocks,
  taskLine,
  titleOnlyTaskLine,
  type PromptSkill,
} from '../../domain/reviews/prompt-parts.js';
import { EVAL_CASE_SLUG_MAX } from './constants.js';
import { scoreRun, type CaseTally, type RunScore } from './scoring.js';
import type {
  DoneRunCoverage,
  EvalAgentRecord,
  EvalFindingOrigin,
  StoredCase,
  StoredExpectationType,
  StoredFindingRef,
  StoredInputMeta,
  StoredLastResult,
  StoredOutcome,
  StoredRun,
  StoredRunSummary,
} from './types.js';

export function evalCaseName(type: StoredExpectationType, title: string): string {
  const prefix = type === 'must_find' ? 'must-find-' : 'no-';
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return prefix + slug.slice(0, EVAL_CASE_SLUG_MAX);
}

export function expectationTypeOf(decision: {
  acceptedAt: Date | null;
  dismissedAt: Date | null;
}): StoredExpectationType | null {
  if (decision.acceptedAt) return 'must_find';
  if (decision.dismissedAt) return 'must_not_flag';
  return null;
}

/**
 * The part of a multi-file diff that belongs to exactly `path`.
 *
 * Matches the header line's end (` b/<path>`), not a substring: `sliceDiff` in
 * reviewer-core would also capture `web/src/a.ts` when asked for `src/a.ts`.
 */
export function extractFileDiff(raw: string, path: string): string | null {
  const lines = raw.split('\n');
  const starts: number[] = [];
  lines.forEach((line, index) => {
    if (line.startsWith('diff --git ')) starts.push(index);
  });
  const suffix = ` b/${path}`;
  for (let i = 0; i < starts.length; i += 1) {
    const from = starts[i]!;
    if (!lines[from]!.endsWith(suffix)) continue;
    const text = lines.slice(from, starts[i + 1] ?? lines.length).join('\n');
    return text.endsWith('\n') ? text : `${text}\n`;
  }
  return null;
}

/**
 * A pasted diff as the eval module reads it. `parseUnifiedDiff` folds a text
 * without `diff --git` lines into one file under its last path, so such a text
 * is cut at every `---` / `+++` pair first and each piece is parsed alone.
 */
export function parseCaseDiff(raw: string): UnifiedDiff {
  const lines = raw.split('\n');
  if (lines.some((line) => line.startsWith('diff --git '))) return parseUnifiedDiff(raw);
  const starts: number[] = [];
  lines.forEach((line, index) => {
    if (line.startsWith('--- ') && lines[index + 1]?.startsWith('+++ ')) starts.push(index);
  });
  if (starts.length === 0) return parseUnifiedDiff(raw);
  const files = starts.flatMap((from, i) =>
    parseUnifiedDiff(lines.slice(from, starts[i + 1] ?? lines.length).join('\n')).files,
  );
  return { raw, files };
}

export function caseDiffFiles(diff: UnifiedDiff): string[] {
  return diff.files.map((file) => file.path);
}

export function hasHunk(diff: UnifiedDiff): boolean {
  return diff.files.some((file) => file.hunks.length > 0);
}

/** Whether the engine's own grounding gate would keep a finding at this place of the diff. */
export function expectationInsideDiff(
  fileDiff: UnifiedDiff,
  place: { file: string; startLine: number; endLine: number },
): boolean {
  const probe: Finding = {
    id: 'eval-probe',
    severity: 'WARNING',
    category: 'bug',
    title: 'probe',
    file: place.file,
    start_line: place.startLine,
    end_line: place.endLine,
    rationale: '',
    confidence: 1,
    kind: 'finding',
  };
  return groundFindings([probe], fileDiff).kept.length === 1;
}

/**
 * What the case modal opens with for a finding that has no case yet: the finding's
 * file of the pull request's diff, the pull request text and the finding's values.
 */
export function buildCaseDraft(
  origin: EvalFindingOrigin,
  type: StoredExpectationType,
  pullDiffRaw: string,
): EvalCaseDraft {
  const { finding, pull } = origin;
  const fileDiff = extractFileDiff(pullDiffRaw, finding.file);
  const place = { file: finding.file, startLine: finding.startLine, endLine: finding.endLine };
  const problem =
    fileDiff === null
      ? ('file_not_in_diff' as const)
      : expectationInsideDiff(parseUnifiedDiff(fileDiff), place)
        ? null
        : ('lines_outside_diff' as const);
  return {
    expectation_type: type,
    name: evalCaseName(type, finding.title),
    input_diff: fileDiff ?? '',
    input_meta: {
      pr_number: pull.number,
      pr_title: pull.title,
      pr_author: pull.author,
      pr_body: pull.body,
    },
    expected_output: {
      file: finding.file,
      start_line: finding.startLine,
      end_line: finding.endLine,
      severity: finding.severity,
      category: finding.category,
      title: finding.title,
    },
    problem,
  };
}

/** Whether an update changes what a run would score: the six values of AC-15, compared strictly. */
export function caseContentChanged(
  stored: StoredCase,
  next: {
    inputDiff: string;
    prTitle: string;
    prBody: string | null;
    file: string;
    startLine: number;
    endLine: number;
  },
): boolean {
  return (
    stored.inputDiff !== next.inputDiff ||
    stored.inputMeta.prTitle !== next.prTitle ||
    stored.inputMeta.prBody !== next.prBody ||
    stored.expectedOutput.file !== next.file ||
    stored.expectedOutput.startLine !== next.startLine ||
    stored.expectedOutput.endLine !== next.endLine
  );
}

/** The ONE place that reads the pull request's number, title and author of a stored case. */
export function caseTaskLine(meta: StoredInputMeta): string {
  if (meta.prNumber === null || meta.prAuthor === null) return titleOnlyTaskLine(meta.prTitle);
  return taskLine({ number: meta.prNumber, title: meta.prTitle, author: meta.prAuthor });
}

export type CaseReviewInput = Pick<
  ReviewInput,
  'systemPrompt' | 'model' | 'strategy' | 'skills' | 'diff' | 'prDescription' | 'task'
>;

/**
 * What the engine receives for one case. Reads the frozen diff and PR text only;
 * never the case's name, expectation type or expected output (AC-35), and never
 * a repo skeleton, callers, project context, intent or memory (AC-33).
 */
export function buildCaseReviewInput(
  agent: EvalAgentRecord,
  skills: PromptSkill[],
  c: Pick<StoredCase, 'inputDiff' | 'inputMeta'>,
): CaseReviewInput {
  const skillBlocks = renderSkillBlocks(skills);
  const body = c.inputMeta.prBody;
  return {
    systemPrompt: agent.systemPrompt,
    model: agent.model,
    strategy: agent.strategy,
    ...(skillBlocks.length > 0 ? { skills: skillBlocks } : {}),
    diff: parseCaseDiff(c.inputDiff),
    ...(body ? { prDescription: body } : {}),
    task: caseTaskLine(c.inputMeta),
  };
}

export function toFindingRefDto(ref: StoredFindingRef): EvalOutcomeFinding {
  return {
    file: ref.file,
    start_line: ref.startLine,
    end_line: ref.endLine,
    severity: ref.severity,
    category: ref.category,
    title: ref.title,
  };
}

export function toCaseDto(c: StoredCase, lastResult: StoredLastResult | null): EvalCase {
  return {
    id: c.id,
    owner_kind: c.ownerKind,
    owner_id: c.ownerId,
    name: c.name,
    expectation_type: c.expectationType,
    expected_output: toFindingRefDto(c.expectedOutput),
    input_diff: c.inputDiff,
    input_files: c.inputFiles,
    input_meta: {
      pr_number: c.inputMeta.prNumber,
      pr_title: c.inputMeta.prTitle,
      pr_author: c.inputMeta.prAuthor,
      pr_body: c.inputMeta.prBody,
    },
    source_finding_id: c.sourceFindingId,
    notes: c.notes,
    revision: c.revision,
    created_at: c.createdAt.toISOString(),
    last_result: lastResult
      ? {
          run_id: lastResult.runId,
          status: lastResult.status,
          matched: lastResult.matched,
          error: lastResult.error,
        }
      : null,
  };
}

/** The ONE mapper from a stored per-case outcome to the wire shape; drops `produced`. */
export function toOutcomeDto(outcome: StoredOutcome): EvalCaseOutcome {
  return {
    case_id: outcome.caseId,
    case_name: outcome.caseName,
    case_revision: outcome.caseRevision,
    expectation_type: outcome.expectationType,
    status: outcome.status,
    matched: outcome.matched,
    findings: outcome.findings.map(toFindingRefDto),
    error: outcome.error,
  };
}

export function toRunDto(run: StoredRunSummary): EvalRun {
  return {
    id: run.id,
    agent_id: run.agentId,
    agent_version: run.agentVersion,
    skill_id: run.skillId,
    skill_version: run.skillVersion,
    status: run.status,
    started_at: run.startedAt.toISOString(),
    duration_ms: run.durationMs,
    recall: run.recall,
    precision: run.precision,
    citation_accuracy: run.citationAccuracy,
    cases_total: run.casesTotal,
    cases_passed: run.casesPassed,
    cases_failed: run.casesFailed,
    cases_errored: run.casesErrored,
    findings_total: run.findingsTotal,
    findings_grounded: run.findingsGrounded,
    cost_usd: run.costUsd,
    provider: run.provider,
    model: run.model,
    skills: run.skills,
    case_ids: run.caseIds,
    error: run.error,
  };
}

export function toRunDetailDto(run: StoredRun): EvalRunDetail {
  return { ...toRunDto(run), results: run.results.map(toOutcomeDto) };
}

/** The stored outcome of a case as the scoring reads it; a kept finding is a grounded one. */
export function tallyOf(outcome: StoredOutcome): CaseTally {
  return {
    expectationType: outcome.expectationType,
    status: outcome.status,
    matched: outcome.matched,
    grounded: outcome.findings.length,
    produced: outcome.produced,
  };
}

/**
 * The outcome of the newest done run that covered the case, or null — also null
 * when that outcome was scored against another revision of the case (AC-18).
 */
export function lastResultFor(
  caseId: string,
  doneRunsNewestFirst: DoneRunCoverage[],
  revision: number,
): StoredLastResult | null {
  const run = doneRunsNewestFirst.find((candidate) => candidate.caseIds.includes(caseId));
  if (!run) return null;
  const outcome = run.results.find((result) => result.caseId === caseId);
  if (!outcome || outcome.caseRevision !== revision) return null;
  return {
    runId: run.id,
    status: outcome.status,
    matched: outcome.matched,
    error: outcome.error,
  };
}

export interface CompareSidesResult {
  base: RunScore;
  head: RunScore;
  casesOnlyInBase: string[];
  casesOnlyInHead: string[];
  casesEdited: string[];
}

/**
 * Two runs scored over the cases that have a pass or a fail outcome in both.
 * The names listed per side are the cases that side scored but the other did not.
 * A case scored in both under different revisions is left out of both and listed
 * in `casesEdited` by the newer run's name.
 */
export function compareSides(
  base: Pick<StoredRun, 'results'>,
  head: Pick<StoredRun, 'results'>,
): CompareSidesResult {
  const scored = (run: Pick<StoredRun, 'results'>) =>
    run.results.filter((outcome) => outcome.status !== 'error');
  const baseScored = scored(base);
  const headScored = scored(head);
  const baseIds = new Set(baseScored.map((outcome) => outcome.caseId));
  const headIds = new Set(headScored.map((outcome) => outcome.caseId));
  const baseRevisions = new Map(baseScored.map((o) => [o.caseId, o.caseRevision]));
  const editedIds = new Set(
    headScored
      .filter((o) => baseIds.has(o.caseId) && baseRevisions.get(o.caseId) !== o.caseRevision)
      .map((o) => o.caseId),
  );
  const isComparable = (outcome: StoredOutcome) =>
    baseIds.has(outcome.caseId) && headIds.has(outcome.caseId) && !editedIds.has(outcome.caseId);

  return {
    base: scoreRun(baseScored.filter(isComparable).map(tallyOf)),
    head: scoreRun(headScored.filter(isComparable).map(tallyOf)),
    casesOnlyInBase: baseScored.filter((o) => !headIds.has(o.caseId)).map((o) => o.caseName),
    casesOnlyInHead: headScored.filter((o) => !baseIds.has(o.caseId)).map((o) => o.caseName),
    casesEdited: headScored.filter((o) => editedIds.has(o.caseId)).map((o) => o.caseName),
  };
}
