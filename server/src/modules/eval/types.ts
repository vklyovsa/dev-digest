import type { LLMProvider, ReviewStrategy, UnifiedDiff } from '@devdigest/shared';
import type { PromptSkill } from '../../domain/reviews/prompt-parts.js';

export type { PromptSkill };

export type StoredExpectationType = 'must_find' | 'must_not_flag';
export type StoredOutcomeStatus = 'pass' | 'fail' | 'error';

export interface StoredFindingRef {
  file: string;
  startLine: number;
  endLine: number;
  severity: string;
  category: string;
  title: string;
}

export interface StoredInputMeta {
  prNumber: number | null;
  prTitle: string;
  prAuthor: string | null;
  prBody: string | null;
}

export interface StoredCase {
  id: string;
  workspaceId: string;
  ownerKind: 'skill' | 'agent';
  ownerId: string;
  name: string;
  expectationType: StoredExpectationType;
  expectedOutput: StoredFindingRef;
  inputDiff: string;
  inputFiles: string[];
  inputMeta: StoredInputMeta;
  sourceFindingId: string | null;
  notes: string | null;
  revision: number;
  createdAt: Date;
}

export type NewCase = Omit<StoredCase, 'id' | 'workspaceId' | 'createdAt' | 'revision'>;

export interface CasePatch {
  name: string;
  inputDiff: string;
  inputFiles: string[];
  inputMeta: StoredInputMeta;
  expectedOutput: StoredFindingRef;
  bumpRevision: boolean;
}

/** The wire outcome in camelCase, plus `produced` (kept + dropped) which only the scoring needs. */
export interface StoredOutcome {
  caseId: string;
  caseName: string;
  caseRevision: number;
  expectationType: StoredExpectationType;
  status: StoredOutcomeStatus;
  matched: number;
  findings: StoredFindingRef[];
  error: string | null;
  produced: number;
}

export interface StoredLastResult {
  runId: string;
  status: StoredOutcomeStatus;
  matched: number;
  error: string | null;
}

export interface StoredRunSummary {
  id: string;
  workspaceId: string;
  agentId: string;
  agentVersion: number;
  skillId: string | null;
  skillVersion: number | null;
  status: 'running' | 'done' | 'failed';
  startedAt: Date;
  durationMs: number | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  casesTotal: number;
  casesPassed: number;
  casesFailed: number;
  casesErrored: number;
  findingsTotal: number;
  findingsGrounded: number;
  costUsd: number | null;
  provider: string;
  model: string;
  skills: string[];
  caseIds: string[];
  error: string | null;
}

export interface StoredRun extends StoredRunSummary {
  results: StoredOutcome[];
}

export interface NewRun {
  agentId: string;
  agentVersion: number;
  skillId: string | null;
  skillVersion: number | null;
  provider: string;
  model: string;
  skills: string[];
  caseIds: string[];
  casesTotal: number;
}

export interface RunCompletion {
  status: 'done' | 'failed';
  error: string | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  casesTotal: number;
  casesPassed: number;
  casesFailed: number;
  casesErrored: number;
  findingsTotal: number;
  findingsGrounded: number;
  durationMs: number;
  costUsd: number | null;
  results: StoredOutcome[];
}

export type DoneRunCoverage = Pick<StoredRun, 'id' | 'caseIds' | 'results'>;

export interface AgentTrendPoint {
  agentId: string;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
}

export interface EvalStore {
  findCaseBySourceFinding(workspaceId: string, findingId: string): Promise<StoredCase | undefined>;
  insertCase(
    workspaceId: string,
    values: NewCase,
  ): Promise<{ case: StoredCase; created: boolean } | undefined>;
  listCasesForAgent(workspaceId: string, agentId: string): Promise<StoredCase[]>;
  listCasesForSkill(workspaceId: string, skillId: string): Promise<StoredCase[]>;
  getCase(workspaceId: string, caseId: string): Promise<StoredCase | undefined>;
  updateCase(workspaceId: string, caseId: string, patch: CasePatch): Promise<StoredCase | undefined>;
  deleteCase(workspaceId: string, caseId: string): Promise<boolean>;
  listDoneRunsForAgent(
    workspaceId: string,
    agentId: string,
    limit: number,
  ): Promise<DoneRunCoverage[]>;

  listDoneRunsForSkill(
    workspaceId: string,
    skillId: string,
    limit: number,
  ): Promise<DoneRunCoverage[]>;

  insertRunningRun(workspaceId: string, values: NewRun): Promise<StoredRun | null>;
  findRunningSkillRun(workspaceId: string, skillId: string): Promise<StoredRunSummary | undefined>;
  findRunningRun(workspaceId: string, agentId: string): Promise<StoredRunSummary | undefined>;
  completeRun(runId: string, patch: RunCompletion): Promise<void>;
  listRunsForAgent(
    workspaceId: string,
    agentId: string,
    limit: number,
  ): Promise<StoredRunSummary[]>;
  listRunsForSkill(
    workspaceId: string,
    skillId: string,
    limit: number,
  ): Promise<StoredRunSummary[]>;
  getRun(workspaceId: string, runId: string): Promise<StoredRun | undefined>;
  failRunningRuns(error: string): Promise<number>;
  latestDoneRunPerAgent(workspaceId: string): Promise<StoredRunSummary[]>;
  recentDoneRuns(workspaceId: string, limit: number): Promise<StoredRunSummary[]>;
  caseCountsByAgent(workspaceId: string): Promise<{ agentId: string; count: number }[]>;
  runningAgentIds(workspaceId: string): Promise<string[]>;
  trendPerAgent(workspaceId: string, perAgent: number): Promise<AgentTrendPoint[]>;
}

export interface EvalAgentRecord {
  id: string;
  name: string;
  provider: string;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
  version: number;
}

export interface EvalAgentsReader {
  list(workspaceId: string): Promise<EvalAgentRecord[]>;
  getById(workspaceId: string, id: string): Promise<EvalAgentRecord | undefined>;
  getVersion(agentId: string, version: number): Promise<{ configJson: unknown } | undefined>;
}

export interface EvalSkillRecord {
  id: string;
  name: string;
  type: string;
  source: string;
  body: string;
  version: number;
}

export interface EvalSkillsReader {
  linkedEnabled(agentId: string): Promise<PromptSkill[]>;
  getById(workspaceId: string, id: string): Promise<EvalSkillRecord | undefined>;
  getVersion(skillId: string, version: number): Promise<{ body: string } | undefined>;
}

export interface EvalFindingOrigin {
  finding: {
    id: string;
    file: string;
    startLine: number;
    endLine: number;
    severity: string;
    category: string;
    title: string;
    acceptedAt: Date | null;
    dismissedAt: Date | null;
  };
  agentId: string | null;
  pull: { id: string; number: number; title: string; author: string; body: string | null };
}

export interface EvalFindingSource {
  findingOrigin(workspaceId: string, findingId: string): Promise<EvalFindingOrigin | undefined>;
  diffForPull(workspaceId: string, prId: string): Promise<UnifiedDiff>;
}

export interface EvalLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg: string): void;
}

export interface EvalDeps {
  readonly store: EvalStore;
  readonly agents: EvalAgentsReader;
  readonly skills: EvalSkillsReader;
  readonly findings: EvalFindingSource;
  readonly log: EvalLogger;
  llm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider>;
}
