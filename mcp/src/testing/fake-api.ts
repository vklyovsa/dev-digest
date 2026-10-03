import { ApiError } from '../errors.js';
import type {
  ActiveRun,
  AgentInfo,
  ConventionsInfo,
  DevDigestApi,
  FindingInfo,
  PullInfo,
  RepoInfo,
  ReviewInfo,
  RunInfo,
} from '../ports.js';

export type FinishedStatus = 'done' | 'failed' | 'cancelled';

export interface FakeCall {
  method: keyof DevDigestApi;
  args: unknown[];
}

export interface FakeApiOptions {
  agents?: AgentInfo[];
  repos?: RepoInfo[];
  pulls?: Record<string, PullInfo[]>;
  runs?: Record<string, RunInfo[]>;
  reviews?: Record<string, ReviewInfo[]>;
  conventions?: Record<string, ConventionsInfo>;
  onStart?: 'complete' | 'fail' | 'hang';
  startFindings?: FindingInfo[];
  startError?: string;
}

export interface FinishExtras {
  error?: string;
  findings?: FindingInfo[];
  verdict?: string;
}

export function fakeAgent(over: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'agent-1',
    name: 'Security Reviewer',
    description: 'Looks for vulnerabilities.',
    model: 'fake/model',
    enabled: true,
    ...over,
  };
}

export function fakeRepo(over: Partial<RepoInfo> = {}): RepoInfo {
  return { id: 'repo-1', fullName: 'acme/payments-api', ...over };
}

export function fakePull(over: Partial<PullInfo> = {}): PullInfo {
  return { id: 'pr-1', number: 482, title: 'Add rate limiting', ...over };
}

export function fakeFinding(over: Partial<FindingInfo> = {}): FindingInfo {
  return {
    id: 'finding-1',
    severity: 'WARNING',
    category: 'bug',
    title: 'Something is off',
    file: 'src/a.ts',
    startLine: 1,
    endLine: 1,
    rationale: 'Because of the way it is written.',
    suggestion: null,
    confidence: 0.5,
    dismissed: false,
    ...over,
  };
}

export function fakeRun(over: Partial<RunInfo> = {}): RunInfo {
  return {
    runId: 'run-1',
    agentId: 'agent-1',
    agentName: 'Security Reviewer',
    status: 'done',
    error: null,
    model: 'fake/model',
    ranAt: '2026-10-03T12:00:00.000Z',
    durationMs: 18_000,
    costUsd: 0.004,
    score: 80,
    blockers: 0,
    ...over,
  };
}

export function fakeReview(over: Partial<ReviewInfo> = {}): ReviewInfo {
  return {
    id: 'review-1',
    runId: 'run-1',
    verdict: 'comment',
    summary: 'A scripted review.',
    score: 80,
    model: 'fake/model',
    createdAt: '2026-10-03T12:00:18.000Z',
    findings: [],
    ...over,
  };
}

export class FakeDevDigestApi implements DevDigestApi {
  readonly calls: FakeCall[] = [];

  private readonly agents: AgentInfo[];
  private readonly repos: RepoInfo[];
  private readonly pulls: Record<string, PullInfo[]>;
  private readonly conventions: Record<string, ConventionsInfo>;
  private readonly runsByPr = new Map<string, RunInfo[]>();
  private readonly reviewsByPr = new Map<string, ReviewInfo[]>();
  private readonly prOfRun = new Map<string, string>();
  private readonly waiters = new Map<string, Set<() => void>>();
  private readonly onStart: 'complete' | 'fail' | 'hang';
  private readonly startFindings: FindingInfo[];
  private readonly startError: string;
  private started = 0;

  constructor(options: FakeApiOptions = {}) {
    this.agents = options.agents ?? [];
    this.repos = options.repos ?? [];
    this.pulls = options.pulls ?? {};
    this.conventions = options.conventions ?? {};
    this.onStart = options.onStart ?? 'complete';
    this.startFindings = options.startFindings ?? [];
    this.startError = options.startError ?? 'provider error';
    for (const [prId, runs] of Object.entries(options.runs ?? {})) {
      this.runsByPr.set(prId, [...runs]);
      for (const run of runs) this.prOfRun.set(run.runId, prId);
    }
    for (const [prId, reviews] of Object.entries(options.reviews ?? {})) {
      this.reviewsByPr.set(prId, [...reviews]);
    }
  }

  callsTo(method: keyof DevDigestApi): FakeCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  async listAgents(): Promise<AgentInfo[]> {
    this.record('listAgents');
    return [...this.agents];
  }

  async listRepos(): Promise<RepoInfo[]> {
    this.record('listRepos');
    return [...this.repos];
  }

  async listPulls(repoId: string): Promise<PullInfo[]> {
    this.record('listPulls', repoId);
    return [...(this.pulls[repoId] ?? [])];
  }

  async listActiveRuns(prId: string): Promise<ActiveRun[]> {
    this.record('listActiveRuns', prId);
    return (this.runsByPr.get(prId) ?? [])
      .filter((run) => run.status === 'running')
      .map((run) => ({
        runId: run.runId,
        agentId: run.agentId,
        agentName: run.agentName,
        ranAt: run.ranAt,
      }));
  }

  async startReview(prId: string, agentId: string): Promise<string> {
    this.record('startReview', prId, agentId);
    this.started += 1;
    const runId = `run-started-${this.started}`;
    const agent = this.agents.find((a) => a.id === agentId);
    const run = fakeRun({
      runId,
      agentId,
      agentName: agent?.name ?? null,
      status: 'running',
      model: null,
      durationMs: null,
      costUsd: null,
      score: null,
      blockers: null,
      ranAt: new Date(Date.UTC(2026, 9, 3, 12, 0, this.started)).toISOString(),
    });
    this.runsByPr.set(prId, [run, ...(this.runsByPr.get(prId) ?? [])]);
    this.prOfRun.set(runId, prId);
    if (this.onStart === 'complete') this.finishRun(runId, 'done');
    if (this.onStart === 'fail') this.finishRun(runId, 'failed', { error: this.startError });
    return runId;
  }

  async waitForRun(runId: string, signal: AbortSignal): Promise<void> {
    this.record('waitForRun', runId);
    const path = `/runs/${runId}/events`;
    const aborted = (): ApiError =>
      new ApiError('aborted', { method: 'GET', path, message: 'request aborted by the caller' });
    if (signal.aborted) throw aborted();
    if (this.findRun(runId)?.status !== 'running') return;

    await new Promise<void>((resolve, reject) => {
      const waiters = this.waiters.get(runId) ?? new Set<() => void>();
      this.waiters.set(runId, waiters);
      const settle = (): void => {
        waiters.delete(wake);
        signal.removeEventListener('abort', onAbort);
      };
      const wake = (): void => {
        settle();
        resolve();
      };
      const onAbort = (): void => {
        settle();
        reject(aborted());
      };
      waiters.add(wake);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  async listRuns(prId: string): Promise<RunInfo[]> {
    this.record('listRuns', prId);
    return [...(this.runsByPr.get(prId) ?? [])];
  }

  async listReviews(prId: string): Promise<ReviewInfo[]> {
    this.record('listReviews', prId);
    return [...(this.reviewsByPr.get(prId) ?? [])];
  }

  async cancelRun(runId: string): Promise<void> {
    this.record('cancelRun', runId);
    if (this.findRun(runId)?.status === 'running') this.finishRun(runId, 'cancelled');
  }

  async getConventions(repoId: string): Promise<ConventionsInfo> {
    this.record('getConventions', repoId);
    return this.conventions[repoId] ?? { scannedAt: null, conventions: [] };
  }

  finishRun(runId: string, status: FinishedStatus, extras: FinishExtras = {}): void {
    const prId = this.prOfRun.get(runId);
    const runs = prId === undefined ? undefined : this.runsByPr.get(prId);
    const index = runs?.findIndex((run) => run.runId === runId) ?? -1;
    const current = runs?.[index];
    if (prId === undefined || runs === undefined || current === undefined) {
      throw new Error(`FakeDevDigestApi.finishRun: unknown run "${runId}"`);
    }

    if (status === 'done') {
      const findings = extras.findings ?? this.startFindings;
      const critical = findings.filter((f) => !f.dismissed && f.severity === 'CRITICAL').length;
      const reviews = this.reviewsByPr.get(prId) ?? [];
      reviews.push(
        fakeReview({
          id: `review-for-${runId}`,
          runId,
          verdict: extras.verdict ?? (critical > 0 ? 'request_changes' : 'comment'),
          findings,
        }),
      );
      this.reviewsByPr.set(prId, reviews);
      runs[index] = { ...current, status, score: 80, blockers: critical, durationMs: 1_000, costUsd: 0.001, model: 'fake/model' };
    } else {
      runs[index] = { ...current, status, error: status === 'failed' ? (extras.error ?? 'run failed') : null };
    }

    const waiters = this.waiters.get(runId);
    if (waiters) for (const wake of [...waiters]) wake();
  }

  private findRun(runId: string): RunInfo | undefined {
    const prId = this.prOfRun.get(runId);
    return prId === undefined ? undefined : this.runsByPr.get(prId)?.find((run) => run.runId === runId);
  }

  private record(method: keyof DevDigestApi, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }
}
