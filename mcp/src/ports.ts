export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  model: string;
  enabled: boolean;
}

export interface RepoInfo {
  id: string;
  fullName: string;
}

export interface PullInfo {
  id: string | null;
  number: number;
  title: string;
}

export interface ActiveRun {
  runId: string;
  agentId: string | null;
  agentName: string | null;
  ranAt: string | null;
}

export interface RunInfo {
  runId: string;
  agentId: string | null;
  agentName: string | null;
  status: string | null;
  error: string | null;
  model: string | null;
  ranAt: string | null;
  durationMs: number | null;
  costUsd: number | null;
  score: number | null;
  blockers: number | null;
}

export interface FindingInfo {
  id: string;
  severity: string;
  category: string;
  title: string;
  file: string;
  startLine: number;
  endLine: number;
  rationale: string;
  suggestion: string | null;
  confidence: number;
  dismissed: boolean;
}

export interface ReviewInfo {
  id: string;
  runId: string | null;
  verdict: string | null;
  summary: string | null;
  score: number | null;
  model: string | null;
  createdAt: string;
  findings: FindingInfo[];
}

export interface ConventionInfo {
  id: string;
  category: string;
  rule: string;
  rationale: string | null;
  status: string;
  confidence: number;
  evidencePath: string;
  evidenceLineStart: number | null;
  evidenceLineEnd: number | null;
}

export interface ConventionsInfo {
  scannedAt: string | null;
  conventions: ConventionInfo[];
}

export interface BlastCallerInfo {
  file: string;
  line: number;
}

export interface BlastSymbolInfo {
  symbol: string;
  callers: BlastCallerInfo[];
  endpoints: string[];
  crons: string[];
}

export interface BlastInfo {
  summary: string;
  totals: { symbols: number; callers: number; endpoints: number; crons: number };
  degraded: boolean;
  reason: string | null;
  callerCap: number;
  changedFiles: number;
  changedSymbols: string[];
  symbols: BlastSymbolInfo[];
}

export interface DevDigestApi {
  listAgents(signal?: AbortSignal): Promise<AgentInfo[]>;
  listRepos(signal?: AbortSignal): Promise<RepoInfo[]>;
  listPulls(repoId: string, signal?: AbortSignal): Promise<PullInfo[]>;
  listActiveRuns(prId: string, signal?: AbortSignal): Promise<ActiveRun[]>;
  startReview(prId: string, agentId: string, signal?: AbortSignal): Promise<string>;
  waitForRun(runId: string, signal: AbortSignal): Promise<void>;
  listRuns(prId: string, signal?: AbortSignal): Promise<RunInfo[]>;
  listReviews(prId: string, signal?: AbortSignal): Promise<ReviewInfo[]>;
  cancelRun(runId: string, signal?: AbortSignal): Promise<void>;
  getConventions(repoId: string, signal?: AbortSignal): Promise<ConventionsInfo>;
  getBlastRadius(prId: string, signal?: AbortSignal): Promise<BlastInfo>;
  loadPullDetail(prId: string, signal?: AbortSignal): Promise<void>;
}

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}
