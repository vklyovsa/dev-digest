import type {
  CiFailOn,
  CiResultArtifact,
  GitHubClient,
  Provider,
  SecretsProvider,
  WorkflowRunSummary,
} from '@devdigest/shared';

export type ReviewStrategy = 'auto' | 'single-pass' | 'map-reduce';

export interface CiAgentRecord {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
  ciFailOn: CiFailOn;
  version: number;
}

export interface CiAgentsReader {
  getById(workspaceId: string, id: string): Promise<CiAgentRecord | undefined>;
}

export interface CiSkillRecord {
  id: string;
  name: string;
  body: string;
}

export interface CiSkillsReader {
  linkedEnabled(agentId: string): Promise<CiSkillRecord[]>;
}

export interface MemoryRecord {
  kind: string;
  scope: string;
  content: string;
}

export interface StoredInstallation {
  id: string;
  agentId: string;
  repo: string;
  targetType: 'gha' | 'circle' | 'jenkins' | 'cli';
  installedAt: Date;
  latestRunStatus: string | null;
  latestRunAt: Date | null;
  manifestVersion: number | null;
}

export interface GhaInstallation {
  id: string;
  agentId: string;
  repo: string;
  agentName: string;
}

export interface StoredCiRun {
  id: string;
  installationId: string | null;
  prNumber: number | null;
  ranAt: Date | null;
  status: string | null;
  findingsCount: number | null;
  costUsd: number | null;
  githubUrl: string | null;
  source: string | null;
  agentId: string | null;
  agentName: string | null;
  repo: string;
  durationMs: number | null;
  verdict: string | null;
  critical: number | null;
  warning: number | null;
  suggestion: number | null;
}

export interface NewFailedRun {
  installationId: string;
  prNumber: number | null;
  ranAt: Date;
  githubUrl: string;
}

export interface NewIngestedRun {
  workspaceId: string;
  agentId: string;
  installationId: string;
  artifact: CiResultArtifact;
  run: WorkflowRunSummary;
  repo: string;
  repositoryId: number;
}

export interface CiStore {
  findInstallationForRepo(
    workspaceId: string,
    repo: string,
  ): Promise<{ id: string; agentId: string } | undefined>;
  upsertInstallation(agentId: string, repo: string): Promise<StoredInstallation>;
  listInstallationsForAgent(agentId: string): Promise<StoredInstallation[]>;
  globalMemory(workspaceId: string): Promise<MemoryRecord[]>;
  listGhaInstallations(workspaceId: string): Promise<GhaInstallation[]>;
  ciRunExists(githubUrl: string): Promise<boolean>;
  insertFailedRun(run: NewFailedRun): Promise<void>;
  insertIngestedRun(run: NewIngestedRun): Promise<void>;
  listRuns(workspaceId: string, agentId: string | undefined, limit: number): Promise<StoredCiRun[]>;
}

export interface CiLogger {
  info(obj: unknown, msg?: string): void;
}

export interface CiDeps {
  readonly store: CiStore;
  readonly agents: CiAgentsReader;
  readonly skills: CiSkillsReader;
  readonly secrets: SecretsProvider;
  readonly log: CiLogger;
  readonly runnerBundlePath?: string;
  github(): Promise<GitHubClient>;
}

export interface BundleInput {
  agent: CiAgentRecord;
  skills: CiSkillRecord[];
  memory: MemoryRecord[];
  triggers: readonly string[];
  postAs: string;
  runner: { contents: string };
}
