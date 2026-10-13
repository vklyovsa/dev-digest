import { z } from 'zod';
import type {
  EvalCase,
  EvalCaseCreateInput,
  EvalCaseDraftResponse,
  EvalCaseTryInput,
  EvalCaseTryResult,
  EvalCaseUpdateInput,
  EvalCompareSide,
  EvalDashboard,
  EvalRun,
  EvalRunCompare,
  EvalRunDetail,
  EvalSkillCaseTryInput,
  EvalSkillCompareSide,
  EvalSkillRunCompare,
  LLMProvider,
  UnifiedDiff,
} from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import {
  EVAL_ERROR,
  EVAL_INTERRUPTED_ERROR,
  EVAL_RECENT_RUNS_LIMIT,
  EVAL_RUN_LIST_LIMIT,
} from './constants.js';
import {
  buildCaseDraft,
  caseContentChanged,
  caseDiffFiles,
  compareSides,
  expectationInsideDiff,
  expectationTypeOf,
  hasHunk,
  lastResultFor,
  parseCaseDiff,
  toCaseDto,
  toFindingRefDto,
  toRunDetailDto,
  toRunDto,
} from './helpers.js';
import { executeCase, executeEvalRun } from './runner.js';
import type { RunScore } from './scoring.js';
import type {
  EvalAgentRecord,
  EvalSkillRecord,
  EvalDeps,
  EvalFindingOrigin,
  PromptSkill,
  StoredCase,
  StoredExpectationType,
  StoredRun,
} from './types.js';

const VersionPrompt = z.object({ system_prompt: z.string() });

type EvalProvider = Parameters<EvalDeps['llm']>[0];

export class EvalService {
  constructor(private readonly deps: EvalDeps) {}

  /**
   * What the case modal opens with for a finding. Reads only: no row is written
   * and no model is called (AC-16). A finding that already has a case answers
   * with that case and no draft (AC-20).
   */
  async draftFromFinding(workspaceId: string, findingId: string): Promise<EvalCaseDraftResponse> {
    const target = await this.findingTarget(workspaceId, findingId);
    if (target.existing) {
      const { existing } = target;
      const owner = await this.deps.agents.getById(workspaceId, existing.ownerId);
      if (!owner) throw this.ownerMissing();
      const doneRuns = await this.deps.store.listDoneRunsForAgent(
        workspaceId,
        existing.ownerId,
        EVAL_RUN_LIST_LIMIT,
      );
      return {
        agent: { id: owner.id, name: owner.name },
        case: toCaseDto(existing, lastResultFor(existing.id, doneRuns, existing.revision)),
        draft: null,
      };
    }
    const pullDiff = await this.deps.findings.diffForPull(workspaceId, target.origin.pull.id);
    return {
      agent: { id: target.owner.id, name: target.owner.name },
      case: null,
      draft: buildCaseDraft(target.origin, target.expectationType, pullDiff.raw),
    };
  }

  /**
   * One finding, one case: the stored one comes back untouched when it exists,
   * whatever the finding's decision is now. A new case holds the body's values;
   * only the type, the pull request number and the author come from the finding.
   */
  async createCaseFromFinding(
    workspaceId: string,
    findingId: string,
    input: EvalCaseUpdateInput,
  ): Promise<{ case: EvalCase; created: boolean }> {
    const target = await this.findingTarget(workspaceId, findingId);
    if (target.existing) return { case: toCaseDto(target.existing, null), created: false };

    const { origin, expectationType, owner } = target;
    const diff = this.checkCaseInput(input);
    const expected = input.expected_output;
    const stored = await this.deps.store.insertCase(workspaceId, {
      ownerKind: 'agent',
      ownerId: owner.id,
      name: input.name,
      expectationType,
      expectedOutput: {
        file: expected.file,
        startLine: expected.start_line,
        endLine: expected.end_line,
        severity: expected.severity,
        category: expected.category,
        title: expected.title,
      },
      inputDiff: input.input_diff,
      inputFiles: caseDiffFiles(diff),
      inputMeta: {
        prNumber: origin.pull.number,
        prTitle: input.input_meta.pr_title,
        prAuthor: origin.pull.author,
        prBody: input.input_meta.pr_body,
      },
      sourceFindingId: origin.finding.id,
      notes: null,
    });
    if (!stored) {
      throw new AppError(EVAL_ERROR.caseNotStored, 'The eval case could not be stored', 400);
    }
    return { case: toCaseDto(stored.case, null), created: stored.created };
  }

  async createCase(
    workspaceId: string,
    agentId: string,
    input: EvalCaseCreateInput,
  ): Promise<EvalCase> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return this.insertManualCase(workspaceId, { kind: 'agent', id: agent.id }, input);
  }

  async createSkillCase(
    workspaceId: string,
    skillId: string,
    input: EvalCaseCreateInput,
  ): Promise<EvalCase> {
    const skill = await this.skillOr404(workspaceId, skillId);
    return this.insertManualCase(workspaceId, { kind: 'skill', id: skill.id }, input);
  }

  private async insertManualCase(
    workspaceId: string,
    owner: { kind: 'agent' | 'skill'; id: string },
    input: EvalCaseCreateInput,
  ): Promise<EvalCase> {
    const diff = this.checkCaseInput(input);
    const expected = input.expected_output;

    const stored = await this.deps.store.insertCase(workspaceId, {
      ownerKind: owner.kind,
      ownerId: owner.id,
      name: input.name,
      expectationType: input.expectation_type,
      expectedOutput: {
        file: expected.file,
        startLine: expected.start_line,
        endLine: expected.end_line,
        severity: expected.severity,
        category: expected.category,
        title: expected.title,
      },
      inputDiff: input.input_diff,
      inputFiles: caseDiffFiles(diff),
      inputMeta: {
        prNumber: null,
        prTitle: input.input_meta.pr_title,
        prAuthor: null,
        prBody: input.input_meta.pr_body,
      },
      sourceFindingId: null,
      notes: null,
    });
    if (!stored) {
      throw new AppError(EVAL_ERROR.caseNotStored, 'The eval case could not be stored', 400);
    }
    return toCaseDto(stored.case, null);
  }

  async updateCase(
    workspaceId: string,
    caseId: string,
    input: EvalCaseUpdateInput,
  ): Promise<EvalCase> {
    const stored = await this.deps.store.getCase(workspaceId, caseId);
    if (!stored) throw new NotFoundError('Eval case not found');

    const isSkill = stored.ownerKind === 'skill';
    const running = isSkill
      ? await this.deps.store.findRunningSkillRun(workspaceId, stored.ownerId)
      : await this.deps.store.findRunningRun(workspaceId, stored.ownerId);
    if (running) throw this.runInProgress(running.id, stored.ownerKind);

    const diff = this.checkCaseInput(input);
    const expected = input.expected_output;
    const updated = await this.deps.store.updateCase(workspaceId, caseId, {
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: caseDiffFiles(diff),
      inputMeta: {
        prNumber: stored.inputMeta.prNumber,
        prTitle: input.input_meta.pr_title,
        prAuthor: stored.inputMeta.prAuthor,
        prBody: input.input_meta.pr_body,
      },
      expectedOutput: {
        file: expected.file,
        startLine: expected.start_line,
        endLine: expected.end_line,
        severity: expected.severity,
        category: expected.category,
        title: expected.title,
      },
      bumpRevision: caseContentChanged(stored, {
        inputDiff: input.input_diff,
        prTitle: input.input_meta.pr_title,
        prBody: input.input_meta.pr_body,
        file: expected.file,
        startLine: expected.start_line,
        endLine: expected.end_line,
      }),
    });
    if (!updated) throw new NotFoundError('Eval case not found');

    const doneRuns = isSkill
      ? await this.deps.store.listDoneRunsForSkill(workspaceId, updated.ownerId, EVAL_RUN_LIST_LIMIT)
      : await this.deps.store.listDoneRunsForAgent(workspaceId, updated.ownerId, EVAL_RUN_LIST_LIMIT);
    return toCaseDto(updated, lastResultFor(updated.id, doneRuns, updated.revision));
  }

  async listCases(workspaceId: string, agentId: string): Promise<EvalCase[]> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const [cases, doneRuns] = await Promise.all([
      this.deps.store.listCasesForAgent(workspaceId, agentId),
      this.deps.store.listDoneRunsForAgent(workspaceId, agentId, EVAL_RUN_LIST_LIMIT),
    ]);
    return cases.map((stored) => toCaseDto(stored, lastResultFor(stored.id, doneRuns, stored.revision)));
  }

  async listSkillCases(workspaceId: string, skillId: string): Promise<EvalCase[]> {
    await this.skillOr404(workspaceId, skillId);
    const [cases, doneRuns] = await Promise.all([
      this.deps.store.listCasesForSkill(workspaceId, skillId),
      this.deps.store.listDoneRunsForSkill(workspaceId, skillId, EVAL_RUN_LIST_LIMIT),
    ]);
    return cases.map((stored) => toCaseDto(stored, lastResultFor(stored.id, doneRuns, stored.revision)));
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<void> {
    const deleted = await this.deps.store.deleteCase(workspaceId, caseId);
    if (!deleted) throw new NotFoundError('Eval case not found');
  }

  /**
   * Stores the run as `running` and answers at once; the cases execute in the
   * background. The agent's `enabled` flag is deliberately not read (EC-26).
   */
  async startRun(workspaceId: string, agentId: string): Promise<EvalRun> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const cases = await this.deps.store.listCasesForAgent(workspaceId, agentId);
    if (cases.length === 0) {
      throw new AppError(EVAL_ERROR.noCases, 'This agent has no eval cases to run', 400);
    }

    const running = await this.deps.store.findRunningRun(workspaceId, agentId);
    if (running) throw this.runInProgress(running.id);

    const llm = await this.providerOf(agent);

    const skills = await this.deps.skills.linkedEnabled(agent.id);
    const run = await this.deps.store.insertRunningRun(workspaceId, {
      agentId: agent.id,
      agentVersion: agent.version,
      skillId: null,
      skillVersion: null,
      provider: agent.provider,
      model: agent.model,
      skills: skills.map((skill) => skill.name),
      caseIds: cases.map((c) => c.id),
      casesTotal: cases.length,
    });
    if (!run) {
      const other = await this.deps.store.findRunningRun(workspaceId, agentId);
      throw this.runInProgress(other?.id);
    }

    this.deps.log.info(
      {
        runId: run.id,
        agentId: agent.id,
        agentVersion: run.agentVersion,
        casesTotal: run.casesTotal,
        provider: run.provider,
        model: run.model,
      },
      'eval run started',
    );
    void executeEvalRun(this.deps, { run, agent, skills, llm, cases }).catch((err: unknown) => {
      this.deps.log.warn(
        { runId: run.id, agentId: agent.id, err: err instanceof Error ? err.message : String(err) },
        'eval run could not be settled',
      );
    });
    return toRunDto(run);
  }

  /**
   * A run of the skill's case set, hosted by an agent. The skill row is read once,
   * so every case gets that body; neither `enabled` flag is read (AC-11) and the
   * host's linked skills are not part of the call (AC-12).
   */
  async startSkillRun(workspaceId: string, skillId: string, hostAgentId: string): Promise<EvalRun> {
    const skill = await this.skillOr404(workspaceId, skillId);
    const host = await this.hostOrRefuse(workspaceId, hostAgentId);

    const cases = await this.deps.store.listCasesForSkill(workspaceId, skill.id);
    if (cases.length === 0) {
      throw new AppError(EVAL_ERROR.noCases, 'This skill has no eval cases to run', 400);
    }

    const running = await this.deps.store.findRunningSkillRun(workspaceId, skill.id);
    if (running) throw this.runInProgress(running.id, 'skill');

    const llm = await this.providerOf(host);
    const run = await this.deps.store.insertRunningRun(workspaceId, {
      agentId: host.id,
      agentVersion: host.version,
      skillId: skill.id,
      skillVersion: skill.version,
      provider: host.provider,
      model: host.model,
      skills: [skill.name],
      caseIds: cases.map((c) => c.id),
      casesTotal: cases.length,
    });
    if (!run) {
      const other = await this.deps.store.findRunningSkillRun(workspaceId, skill.id);
      throw this.runInProgress(other?.id, 'skill');
    }

    this.deps.log.info(
      {
        runId: run.id,
        agentId: host.id,
        agentVersion: run.agentVersion,
        skillId: skill.id,
        skillVersion: skill.version,
        casesTotal: run.casesTotal,
        provider: run.provider,
        model: run.model,
      },
      'eval run started',
    );
    void executeEvalRun(this.deps, {
      run,
      agent: host,
      skills: [this.promptSkillOf(skill)],
      llm,
      cases,
    }).catch((err: unknown) => {
      this.deps.log.warn(
        { runId: run.id, agentId: host.id, err: err instanceof Error ? err.message : String(err) },
        'eval run could not be settled',
      );
    });
    return toRunDto(run);
  }

  async listSkillRuns(workspaceId: string, skillId: string): Promise<EvalRun[]> {
    await this.skillOr404(workspaceId, skillId);
    const runs = await this.deps.store.listRunsForSkill(workspaceId, skillId, EVAL_RUN_LIST_LIMIT);
    return runs.map(toRunDto);
  }

  async listRuns(workspaceId: string, agentId: string): Promise<EvalRun[]> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const runs = await this.deps.store.listRunsForAgent(workspaceId, agentId, EVAL_RUN_LIST_LIMIT);
    return runs.map(toRunDto);
  }

  async getRun(workspaceId: string, runId: string): Promise<EvalRunDetail> {
    const run = await this.deps.store.getRun(workspaceId, runId);
    if (!run) throw new NotFoundError('Eval run not found');
    return toRunDetailDto(run);
  }

  /**
   * Two finished runs of one agent, scored over the cases both scored (AC-70…72).
   * The older run is `base` whatever the order of the query.
   */
  async compareRuns(
    workspaceId: string,
    agentId: string,
    baseId: string,
    headId: string,
  ): Promise<EvalRunCompare> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const fetched = await Promise.all(
      [baseId, headId].map((id) => this.deps.store.getRun(workspaceId, id)),
    );
    const runs: StoredRun[] = [];
    for (const run of fetched) {
      if (!run || run.agentId !== agentId || run.skillId !== null || run.status !== 'done') {
        throw this.notComparable();
      }
      runs.push(run);
    }
    runs.sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime() || a.id.localeCompare(b.id),
    );
    const [older, newer] = runs as [StoredRun, StoredRun];

    const [olderPrompt, newerPrompt] = await Promise.all([
      this.promptOf(agentId, older),
      this.promptOf(agentId, newer),
    ]);
    const sides = compareSides(older, newer);
    return {
      base: this.compareSide(older, olderPrompt, sides.base),
      head: this.compareSide(newer, newerPrompt, sides.head),
      cases_only_in_base: sides.casesOnlyInBase,
      cases_only_in_head: sides.casesOnlyInHead,
      cases_edited: sides.casesEdited,
    };
  }

  /**
   * Two finished runs of one skill, scored over the cases both scored (AC-30…31).
   * The older run is `base` whatever the order of the query.
   */
  async compareSkillRuns(
    workspaceId: string,
    skillId: string,
    baseId: string,
    headId: string,
  ): Promise<EvalSkillRunCompare> {
    await this.skillOr404(workspaceId, skillId);

    const fetched = await Promise.all(
      [baseId, headId].map((id) => this.deps.store.getRun(workspaceId, id)),
    );
    const runs: StoredRun[] = [];
    for (const run of fetched) {
      if (!run || run.skillId !== skillId || run.status !== 'done' || run.skillVersion === null) {
        throw this.notComparable();
      }
      runs.push(run);
    }
    runs.sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime() || a.id.localeCompare(b.id),
    );
    const [older, newer] = runs as [StoredRun, StoredRun];

    const [olderBody, newerBody] = await Promise.all([
      this.skillBodyOf(skillId, older),
      this.skillBodyOf(skillId, newer),
    ]);
    const sides = compareSides(older, newer);
    return {
      base: this.skillCompareSide(older, olderBody, sides.base),
      head: this.skillCompareSide(newer, newerBody, sides.head),
      cases_only_in_base: sides.casesOnlyInBase,
      cases_only_in_head: sides.casesOnlyInHead,
      cases_edited: sides.casesEdited,
    };
  }

  async dashboard(workspaceId: string): Promise<EvalDashboard> {
    const [agents, latest, recent, caseCounts, running, trends] = await Promise.all([
      this.deps.agents.list(workspaceId),
      this.deps.store.latestDoneRunPerAgent(workspaceId),
      this.deps.store.recentDoneRuns(workspaceId, EVAL_RECENT_RUNS_LIMIT),
      this.deps.store.caseCountsByAgent(workspaceId),
      this.deps.store.runningAgentIds(workspaceId),
      this.deps.store.trendPerAgent(workspaceId, EVAL_RUN_LIST_LIMIT),
    ]);
    const countByAgent = new Map(caseCounts.map((row) => [row.agentId, row.count]));
    const runningIds = new Set(running);
    const trendByAgent = new Map<string, EvalDashboard['agents'][number]['trend']>();
    for (const point of trends) {
      const list = trendByAgent.get(point.agentId) ?? [];
      list.push({
        recall: point.recall,
        precision: point.precision,
        citation_accuracy: point.citationAccuracy,
      });
      trendByAgent.set(point.agentId, list);
    }
    const latestByAgent = new Map(latest.map((run) => [run.agentId, run]));
    const nameById = new Map(agents.map((agent) => [agent.id, agent.name]));
    return {
      agents: agents.map((agent) => {
        const run = latestByAgent.get(agent.id);
        return {
          agent_id: agent.id,
          name: agent.name,
          model: agent.model,
          latest_run: run ? toRunDto(run) : null,
          case_count: countByAgent.get(agent.id) ?? 0,
          run_in_progress: runningIds.has(agent.id),
          trend: trendByAgent.get(agent.id) ?? [],
        };
      }),
      recent_runs: recent.map((run) => ({
        ...toRunDto(run),
        agent_name: nameById.get(run.agentId) ?? '',
      })),
    };
  }

  /**
   * One case content run through the engine, answered and forgotten: no store
   * call, no run row, and no check for a run in progress (AC-42, AC-48).
   */
  async tryCase(
    workspaceId: string,
    agentId: string,
    input: EvalCaseTryInput,
  ): Promise<EvalCaseTryResult> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    this.checkCaseInput(input);
    const llm = await this.providerOf(agent);
    const skills = await this.deps.skills.linkedEnabled(agent.id);
    return this.runTry(agent, skills, llm, input, `eval-try:${agent.id}`, {});
  }

  /**
   * The same try for a skill: the host agent carries the prompt and the model,
   * the skill is the only skill in the call. Nothing is stored (AC-27, AC-29).
   */
  async trySkillCase(
    workspaceId: string,
    skillId: string,
    input: EvalSkillCaseTryInput,
  ): Promise<EvalCaseTryResult> {
    const skill = await this.skillOr404(workspaceId, skillId);
    const host = await this.hostOrRefuse(workspaceId, input.host_agent_id);
    this.checkCaseInput(input);
    const llm = await this.providerOf(host);
    return this.runTry(host, [this.promptSkillOf(skill)], llm, input, `eval-try:skill:${skill.id}`, {
      skillId: skill.id,
      skillVersion: skill.version,
    });
  }

  private async runTry(
    agent: EvalAgentRecord,
    skills: PromptSkill[],
    llm: LLMProvider,
    input: EvalCaseTryInput,
    sessionId: string,
    logExtra: Record<string, unknown>,
  ): Promise<EvalCaseTryResult> {
    const expected = input.expected_output;
    const execution = await executeCase(
      { agent, skills, llm, sessionId },
      {
        inputDiff: input.input_diff,
        inputMeta: {
          prNumber: input.input_meta.pr_number,
          prTitle: input.input_meta.pr_title,
          prAuthor: input.input_meta.pr_author,
          prBody: input.input_meta.pr_body,
        },
        expectationType: input.expectation_type,
        expectation: { file: expected.file, startLine: expected.start_line, endLine: expected.end_line },
      },
    );
    const { tally } = execution;
    this.deps.log.info(
      {
        agentId: agent.id,
        agentVersion: agent.version,
        ...logExtra,
        status: tally.status,
        matched: tally.matched,
        findingsProduced: tally.produced,
        findingsGrounded: execution.findings.length,
        tokensIn: execution.tokensIn,
        tokensOut: execution.tokensOut,
        costUsd: execution.costUsd,
        durationMs: execution.durationMs,
      },
      'eval case tried',
    );
    return {
      status: tally.status,
      matched: tally.matched,
      findings: execution.findings.map(toFindingRefDto),
      error: execution.error,
      duration_ms: execution.durationMs,
      cost_usd: execution.error === null ? execution.costUsd : null,
    };
  }

  /** Boot reaper: a run left `running` by a dead process can never finish. */
  reapInterruptedRuns(): Promise<number> {
    return this.deps.store.failRunningRuns(EVAL_INTERRUPTED_ERROR);
  }

  /** The diff and expectation checks shared by create and update (AC-6, AC-7, AC-12). */
  private checkCaseInput(input: {
    input_diff: string;
    expected_output: { file: string; start_line: number; end_line: number };
  }): UnifiedDiff {
    const diff = parseCaseDiff(input.input_diff);
    if (!hasHunk(diff)) {
      throw new AppError(
        EVAL_ERROR.diffInvalid,
        'The text is not a unified diff: it needs ---/+++ file lines and an @@ hunk',
        400,
      );
    }
    const expected = input.expected_output;
    const place = { file: expected.file, startLine: expected.start_line, endLine: expected.end_line };
    if (!expectationInsideDiff(diff, place)) {
      throw new AppError(
        EVAL_ERROR.expectationOutsideDiff,
        `${expected.file}:${expected.start_line}-${expected.end_line} is outside the changed lines of the diff`,
        400,
      );
    }
    return diff;
  }

  /** The check order that the draft and the save from a finding share. */
  private async findingTarget(
    workspaceId: string,
    findingId: string,
  ): Promise<
    | { existing: StoredCase }
    | {
        existing: null;
        origin: EvalFindingOrigin;
        expectationType: StoredExpectationType;
        owner: EvalAgentRecord;
      }
  > {
    const origin = await this.deps.findings.findingOrigin(workspaceId, findingId);
    if (!origin) throw new NotFoundError('Finding not found');

    const existing = await this.deps.store.findCaseBySourceFinding(workspaceId, findingId);
    if (existing) return { existing };

    const expectationType = expectationTypeOf(origin.finding);
    if (!expectationType) {
      throw new AppError(
        EVAL_ERROR.findingUndecided,
        'Accept or dismiss the finding first',
        400,
      );
    }

    const owner = origin.agentId
      ? await this.deps.agents.getById(workspaceId, origin.agentId)
      : undefined;
    if (!owner) throw this.ownerMissing();
    return { existing: null, origin, expectationType, owner };
  }

  private ownerMissing(): AppError {
    return new AppError(
      EVAL_ERROR.ownerMissing,
      'The agent that produced this finding no longer exists',
      400,
    );
  }

  private notComparable(): AppError {
    return new AppError(
      EVAL_ERROR.runsNotComparable,
      'These runs cannot be compared',
      400,
    );
  }

  private async promptOf(agentId: string, run: StoredRun): Promise<string> {
    const snapshot = await this.deps.agents.getVersion(agentId, run.agentVersion);
    const parsed = VersionPrompt.safeParse(snapshot?.configJson);
    if (!parsed.success) throw this.notComparable();
    return parsed.data.system_prompt;
  }

  private compareSide(run: StoredRun, systemPrompt: string, score: RunScore): EvalCompareSide {
    return {
      run_id: run.id,
      agent_version: run.agentVersion,
      system_prompt: systemPrompt,
      provider: run.provider,
      model: run.model,
      skills: run.skills,
      started_at: run.startedAt.toISOString(),
      recall: score.recall,
      precision: score.precision,
      citation_accuracy: score.citationAccuracy,
      cost_usd: run.costUsd,
      cases_total: score.casesTotal,
      cases_passed: score.casesPassed,
    };
  }

  private async skillBodyOf(skillId: string, run: StoredRun): Promise<string> {
    if (run.skillVersion === null) throw this.notComparable();
    const snapshot = await this.deps.skills.getVersion(skillId, run.skillVersion);
    if (!snapshot) throw this.notComparable();
    return snapshot.body;
  }

  private skillCompareSide(run: StoredRun, skillBody: string, score: RunScore): EvalSkillCompareSide {
    return {
      run_id: run.id,
      skill_version: run.skillVersion ?? 0,
      skill_body: skillBody,
      agent_id: run.agentId,
      agent_version: run.agentVersion,
      provider: run.provider,
      model: run.model,
      started_at: run.startedAt.toISOString(),
      recall: score.recall,
      precision: score.precision,
      citation_accuracy: score.citationAccuracy,
      cost_usd: run.costUsd,
      cases_total: score.casesTotal,
      cases_passed: score.casesPassed,
    };
  }

  private async providerOf(agent: EvalAgentRecord): Promise<LLMProvider> {
    try {
      return await this.deps.llm(agent.provider as EvalProvider);
    } catch {
      throw new AppError(
        EVAL_ERROR.providerUnavailable,
        `The ${agent.provider} provider is not configured`,
        400,
      );
    }
  }

  private async hostOrRefuse(workspaceId: string, hostAgentId: string): Promise<EvalAgentRecord> {
    const host = await this.deps.agents.getById(workspaceId, hostAgentId);
    if (!host) {
      throw new AppError(
        EVAL_ERROR.hostAgentMissing,
        'The host agent does not exist in this workspace',
        400,
      );
    }
    return host;
  }

  private promptSkillOf(skill: EvalSkillRecord): PromptSkill {
    return { id: skill.id, name: skill.name, type: skill.type, source: skill.source, body: skill.body };
  }

  private async skillOr404(workspaceId: string, skillId: string): Promise<EvalSkillRecord> {
    const skill = await this.deps.skills.getById(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  }

  private runInProgress(runId: string | undefined, ownerKind: 'agent' | 'skill' = 'agent'): AppError {
    return new AppError(
      EVAL_ERROR.runInProgress,
      `An eval run of this ${ownerKind} is already in progress`,
      400,
      runId ? { run_id: runId } : undefined,
    );
  }
}
