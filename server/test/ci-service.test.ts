import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { CiSyncResult } from '@devdigest/shared';
import type { RepoRef, WorkflowRunSummary } from '@devdigest/shared';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import { AppError, ConfigError } from '../src/platform/errors.js';
import { CiService } from '../src/modules/ci/service.js';
import type {
  CiAgentRecord,
  CiDeps,
  CiSkillRecord,
  CiStore,
  GhaInstallation,
  NewFailedRun,
  NewIngestedRun,
  StoredInstallation,
} from '../src/modules/ci/types.js';

const WS = 'ws-1';
const AGENT: CiAgentRecord = {
  id: 'agent-1',
  name: 'Sec Reviewer',
  provider: 'openrouter',
  model: 'm/x',
  systemPrompt: 'be strict',
  strategy: 'auto',
  ciFailOn: 'critical',
  version: 3,
};
const SHA = 'a'.repeat(40);

class FakeStore implements CiStore {
  installations: GhaInstallation[] = [];
  taken: { id: string; agentId: string } | undefined;
  existingUrls = new Set<string>();
  upserts: { agentId: string; repo: string }[] = [];
  failed: NewFailedRun[] = [];
  ingested: NewIngestedRun[] = [];

  async findInstallationForRepo() {
    return this.taken;
  }
  async upsertInstallation(agentId: string, repo: string): Promise<StoredInstallation> {
    this.upserts.push({ agentId, repo });
    return {
      id: 'inst-1',
      agentId,
      repo,
      targetType: 'gha',
      installedAt: new Date('2026-10-18T00:00:00Z'),
      latestRunStatus: null,
      latestRunAt: null,
      manifestVersion: null,
    };
  }
  async listInstallationsForAgent() {
    return [];
  }
  async globalMemory() {
    return [{ kind: 'fact', scope: 'global', content: 'remember' }];
  }
  async listGhaInstallations() {
    return this.installations;
  }
  async ciRunExists(url: string) {
    return this.existingUrls.has(url);
  }
  async insertFailedRun(run: NewFailedRun) {
    this.failed.push(run);
  }
  async insertIngestedRun(run: NewIngestedRun) {
    this.ingested.push(run);
  }
  async listRuns() {
    return [];
  }
}

let dir: string;
let bundlePath: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ci-service-'));
  bundlePath = path.join(dir, 'index.js');
  writeFileSync(bundlePath, '// runner bundle\n');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

interface Harness {
  service: CiService;
  store: FakeStore;
  gh: MockGitHubClient;
  logs: unknown[];
}

function harness(opts: {
  gh?: MockGitHubClient;
  skills?: CiSkillRecord[];
  secrets?: Record<string, string>;
  bundle?: string;
  github?: () => Promise<MockGitHubClient>;
} = {}): Harness {
  const store = new FakeStore();
  const gh = opts.gh ?? new MockGitHubClient();
  const logs: unknown[] = [];
  const deps: CiDeps = {
    store,
    agents: { getById: async (_w, id) => (id === AGENT.id ? AGENT : undefined) },
    skills: { linkedEnabled: async () => opts.skills ?? [{ id: 's1', name: 'SQL Injection', body: 'skill body' }] },
    secrets: new MockSecretsProvider(opts.secrets ?? {}),
    log: { info: (obj) => logs.push(obj) },
    runnerBundlePath: opts.bundle ?? bundlePath,
    github: opts.github ?? (async () => gh),
  };
  return { service: new CiService(deps), store, gh, logs };
}

const INPUT = { repo: 'acme/web', triggers: ['opened', 'synchronize'] as ('opened' | 'synchronize')[], post_as: 'github_review' as const };

async function failure(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    return e as AppError;
  }
  throw new Error('expected the call to fail');
}

describe('CiService export', () => {
  it('commits every file as one commit to devdigest/ci, never to base, and opens the PR (AC-15, AC-16, AC-17, AC-18)', async () => {
    const h = harness();
    const out = await h.service.exportToGithub(WS, AGENT.id, { ...INPUT, base: 'develop' });

    expect(h.gh.committed).toHaveLength(1);
    const commit = h.gh.committed[0]!;
    expect(commit.branch).toBe('devdigest/ci');
    expect(commit.base).toBe('develop');
    expect(commit.files.map((f) => f.path)).toEqual([
      '.devdigest/agents/sec-reviewer.yaml',
      '.devdigest/skills/sql-injection.md',
      '.devdigest/memory.jsonl',
      '.devdigest/runner/index.js',
      '.github/workflows/devdigest-review.yml',
    ]);
    expect(commit.prune).toEqual(['.devdigest/agents/']);
    expect(h.gh.openedPrs).toEqual([
      expect.objectContaining({ title: 'Add DevDigest CI review', head: 'devdigest/ci', base: 'develop' }),
    ]);
    expect(out.pr_url).toBe('https://github.com/mock/mock/pull/1');
    expect(h.store.upserts).toEqual([{ agentId: AGENT.id, repo: 'acme/web' }]);
    expect(out.files.find((f) => f.path === '.devdigest/runner/index.js')).toMatchObject({
      contents: '',
      editable: false,
    });
  });

  it('reuses the open pull request of the branch instead of opening another (AC-16)', async () => {
    const gh = new MockGitHubClient();
    gh.openedPrs.push({ title: 'old', head: 'devdigest/ci', base: 'main', body: '' });
    const h = harness({ gh });
    await h.service.exportToGithub(WS, AGENT.id, INPUT);
    expect(gh.openedPrs).toHaveLength(1);
  });

  it('commits the edited workflow text verbatim when workflow_yaml is sent (AC-6 server side)', async () => {
    const h = harness();
    await h.service.exportToGithub(WS, AGENT.id, { ...INPUT, workflow_yaml: 'name: edited\n' });
    const wf = h.gh.committed[0]!.files.find((f) => f.path === '.github/workflows/devdigest-review.yml');
    expect(wf?.contents).toBe('name: edited\n');
  });

  it('answers 409 and commits nothing when another agent owns the repository (AC-19)', async () => {
    const h = harness();
    h.store.taken = { id: 'inst-x', agentId: 'other-agent' };
    const err = await failure(h.service.exportToGithub(WS, AGENT.id, INPUT));
    expect(err.statusCode).toBe(409);
    expect(h.gh.committed).toHaveLength(0);
    expect(h.store.upserts).toHaveLength(0);
  });

  it('answers 422 naming the file and commits nothing when a file holds a secret value (AC-20)', async () => {
    const h = harness({
      skills: [{ id: 's1', name: 'Leaky', body: 'use key sk-or-SENTINEL-12345 here' }],
      secrets: { OPENROUTER_API_KEY: 'sk-or-SENTINEL-12345' },
    });
    const err = await failure(h.service.exportToGithub(WS, AGENT.id, INPUT));
    expect(err.statusCode).toBe(422);
    expect(err.message).toContain('.devdigest/skills/leaky.md');
    expect(err.message).not.toContain('SENTINEL');
    expect(h.gh.committed).toHaveLength(0);
  });

  it('answers 409 naming the build command when the runner bundle is missing (AC-21)', async () => {
    const h = harness({ bundle: path.join(dir, 'missing.js') });
    const err = await failure(h.service.exportToGithub(WS, AGENT.id, INPUT));
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain('cd agent-runner && pnpm build');
    expect(h.gh.committed).toHaveLength(0);
  });

  it('answers 502 with GitHub\'s message and stores no installation when GitHub refuses (AC-23)', async () => {
    const gh = new MockGitHubClient();
    gh.commitFiles = async () => {
      throw new Error('Resource not accessible by personal access token');
    };
    const h = harness({ gh });
    const err = await failure(h.service.exportToGithub(WS, AGENT.id, INPUT));
    expect(err.statusCode).toBe(502);
    expect(err.message).toContain('Resource not accessible by personal access token');
    expect(h.store.upserts).toHaveLength(0);
  });

  it('zips the same files at their repository-relative paths and records the installation (AC-22, AC-18)', async () => {
    const h = harness();
    const archive = await h.service.zip(WS, AGENT.id, INPUT);
    const entries = Object.keys(unzipSync(new Uint8Array(archive))).sort();
    await h.service.exportToGithub(WS, AGENT.id, INPUT);
    expect(entries).toEqual(h.gh.committed[0]!.files.map((f) => f.path).sort());
    expect(h.store.upserts[0]).toEqual({ agentId: AGENT.id, repo: 'acme/web' });
  });

  it('writes the memory file from the workspace global memory (AC-24 through the service)', async () => {
    const h = harness();
    await h.service.exportToGithub(WS, AGENT.id, INPUT);
    const memory = h.gh.committed[0]!.files.find((f) => f.path === '.devdigest/memory.jsonl');
    expect(JSON.parse(memory!.contents.trim())).toEqual({ kind: 'fact', scope: 'global', content: 'remember' });
  });
});

function run(id: number, over: Partial<WorkflowRunSummary> = {}): WorkflowRunSummary {
  return {
    id,
    htmlUrl: `https://github.com/acme/web/actions/runs/${id}`,
    headSha: SHA,
    prNumber: 5,
    startedAt: '2026-10-18T10:00:00Z',
    headRepositoryId: 42,
    event: 'pull_request',
    ...over,
  };
}

function artifactJson(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    findings_count: 2,
    critical: 1,
    warning: 1,
    suggestion: 0,
    cost_usd: 0.01,
    duration_ms: 1200,
    agent: 'Sec Reviewer',
    version: '1.0.0',
    pr_number: 5,
    head_sha: SHA,
    repository_id: 42,
    verdict: 'request_changes',
    blockers: 1,
    model: 'm/x',
    manifest_version: 3,
    ...over,
  };
}

const zipOf = (name: string, text: string) => zipSync({ [name]: strToU8(text) });
const goodZip = (over?: Record<string, unknown>) => zipOf('devdigest-result.json', JSON.stringify(artifactJson(over)));
const ART = (id: number) => [{ id, name: 'devdigest-result', sizeInBytes: 100, expired: false }];

function syncHarness(gh: MockGitHubClient, extra: Parameters<typeof harness>[0] = {}) {
  const h = harness({ gh, ...extra });
  h.store.installations = [{ id: 'inst-1', agentId: AGENT.id, repo: 'acme/web', agentName: AGENT.name }];
  return h;
}

describe('CiService sync', () => {
  it('ingests a verified artifact, takes github_url from GitHub, and answers the sync shape (AC-45/46 input, AC-49)', async () => {
    const gh = new MockGitHubClient({
      repositoryId: 42,
      workflowRuns: [run(1)],
      artifacts: { 1: ART(10) },
      artifactZips: { 10: goodZip() },
    });
    const h = syncHarness(gh);
    const result = await h.service.sync(WS);

    expect(CiSyncResult.parse(result)).toEqual({ ingested: 1, skipped: 0, failed: 0, rejected: [], errors: [] });
    expect(h.store.ingested).toHaveLength(1);
    expect(h.store.ingested[0]).toMatchObject({
      agentId: AGENT.id,
      installationId: 'inst-1',
      repositoryId: 42,
      repo: 'acme/web',
      run: { htmlUrl: 'https://github.com/acme/web/actions/runs/1' },
    });
    expect(h.logs).toEqual([{ repo: 'acme/web', ingested: 1, skipped: 0, failed: 0, rejected: 0 }]);
  });

  it('reads at most the 20 most recent runs of an installation (AC-40)', async () => {
    const runs = Array.from({ length: 25 }, (_, i) => run(i + 1));
    const h = syncHarness(new MockGitHubClient({ repositoryId: 42, workflowRuns: runs }));
    const result = await h.service.sync(WS);
    expect(result.failed).toBe(20);
  });

  it('rejects an artifact failing CiResultArtifact with reason schema and writes no row (AC-41)', async () => {
    const gh = new MockGitHubClient({
      repositoryId: 42,
      workflowRuns: [run(1), run(2)],
      artifacts: { 1: ART(10), 2: ART(11) },
      artifactZips: {
        10: goodZip({ head_sha: 'not-a-sha' }),
        11: zipOf('devdigest-result.json', '{ not json'),
      },
    });
    const h = syncHarness(gh);
    const result = await h.service.sync(WS);
    expect(result.rejected.map((r) => r.reason)).toEqual(['schema', 'schema']);
    expect(h.store.ingested).toHaveLength(0);
    expect(h.store.failed).toHaveLength(0);
  });

  it('rejects a head_sha that differs from the one GitHub reports for the run (AC-42)', async () => {
    const gh = new MockGitHubClient({
      repositoryId: 42,
      workflowRuns: [run(1)],
      artifacts: { 1: ART(10) },
      artifactZips: { 10: goodZip({ head_sha: 'b'.repeat(40) }) },
    });
    const h = syncHarness(gh);
    const result = await h.service.sync(WS);
    expect(result.rejected).toEqual([{ run_url: run(1).htmlUrl, reason: 'head_sha_mismatch' }]);
    expect(h.store.ingested).toHaveLength(0);
  });

  it('rejects a repository_id that differs from the installation repository (AC-43)', async () => {
    const gh = new MockGitHubClient({
      repositoryId: 42,
      workflowRuns: [run(1)],
      artifacts: { 1: ART(10) },
      artifactZips: { 10: goodZip({ repository_id: 999 }) },
    });
    const h = syncHarness(gh);
    const result = await h.service.sync(WS);
    expect(result.rejected).toEqual([{ run_url: run(1).htmlUrl, reason: 'repository_mismatch' }]);
    expect(h.store.ingested).toHaveLength(0);
  });

  it('rejects a run from another head repository or a non-pull_request event before reading its artifact', async () => {
    const gh = new MockGitHubClient({
      repositoryId: 42,
      workflowRuns: [run(1, { headRepositoryId: 999 }), run(2, { event: 'push' }), run(3, { headRepositoryId: null })],
      artifacts: { 1: ART(10), 2: ART(11), 3: ART(12) },
      artifactZips: { 10: goodZip(), 11: goodZip(), 12: goodZip() },
    });
    const listArtifacts = vi.spyOn(gh, 'listRunArtifacts');
    const download = vi.spyOn(gh, 'downloadArtifact');
    const h = syncHarness(gh);
    const result = await h.service.sync(WS);
    expect(result.rejected).toEqual([1, 2, 3].map((id) => ({ run_url: run(id).htmlUrl, reason: 'untrusted_run' })));
    expect(listArtifacts).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(h.store.ingested).toHaveLength(0);
    expect(h.store.failed).toHaveLength(0);
  });

  it('rejects an oversized archive and an archive without devdigest-result.json as artifact_unreadable (AC-44)', async () => {
    const gh = new MockGitHubClient({
      repositoryId: 42,
      workflowRuns: [run(1), run(2), run(3)],
      artifacts: {
        1: [{ id: 10, name: 'devdigest-result', sizeInBytes: 1_048_577, expired: false }],
        2: ART(11),
        3: ART(12),
      },
      artifactZips: {
        11: zipOf('other.json', '{}'),
        12: new Uint8Array(1_048_577),
      },
    });
    const h = syncHarness(gh);
    const result = await h.service.sync(WS);
    expect(result.rejected.map((r) => r.reason)).toEqual([
      'artifact_unreadable',
      'artifact_unreadable',
      'artifact_unreadable',
    ]);
    expect(h.store.ingested).toHaveLength(0);
  });

  it('skips a run whose html_url is already stored and writes nothing (AC-47)', async () => {
    const gh = new MockGitHubClient({
      repositoryId: 42,
      workflowRuns: [run(1)],
      artifacts: { 1: ART(10) },
      artifactZips: { 10: goodZip() },
    });
    const h = syncHarness(gh);
    h.store.existingUrls.add(run(1).htmlUrl);
    const result = await h.service.sync(WS);
    expect(result).toMatchObject({ ingested: 0, skipped: 1, failed: 0 });
    expect(h.store.ingested).toHaveLength(0);
    expect(h.store.failed).toHaveLength(0);
  });

  it('stores a failed run with its GitHub link and no ingested row when there is no artifact (AC-48)', async () => {
    const h = syncHarness(new MockGitHubClient({ repositoryId: 42, workflowRuns: [run(1)] }));
    const result = await h.service.sync(WS);
    expect(result).toMatchObject({ ingested: 0, failed: 1 });
    expect(h.store.failed).toEqual([
      expect.objectContaining({ installationId: 'inst-1', githubUrl: run(1).htmlUrl, prNumber: 5 }),
    ]);
    expect(h.store.ingested).toHaveLength(0);
  });

  it('answers 409 while a sync is already running in the workspace (AC-50)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const gh = new MockGitHubClient();
    const h = syncHarness(gh, {
      github: async () => {
        await gate;
        return gh;
      },
    });
    const first = h.service.sync(WS);
    const err = await failure(h.service.sync(WS));
    expect(err.statusCode).toBe(409);
    release();
    await first;
    await expect(h.service.sync(WS)).resolves.toBeDefined();
  });

  it('lists a refused repository in errors with GitHub\'s message and still syncs the others (AC-51)', async () => {
    const gh = new MockGitHubClient({
      repositoryId: 42,
      workflowRuns: [run(1)],
      artifacts: { 1: ART(10) },
      artifactZips: { 10: goodZip() },
    });
    const original = gh.getRepositoryId.bind(gh);
    gh.getRepositoryId = async (repo: RepoRef) => {
      if (repo.name === 'private') throw new Error('Not Found');
      return original(repo);
    };
    const h = syncHarness(gh);
    h.store.installations = [
      { id: 'inst-0', agentId: AGENT.id, repo: 'acme/private', agentName: AGENT.name },
      { id: 'inst-1', agentId: AGENT.id, repo: 'acme/web', agentName: AGENT.name },
    ];
    const result = await h.service.sync(WS);
    expect(result.errors).toEqual([{ repo: 'acme/private', message: 'Not Found' }]);
    expect(result.ingested).toBe(1);
  });

  it('writes nothing and names the missing token when no GitHub token is configured (AC-52)', async () => {
    const h = syncHarness(new MockGitHubClient(), {
      github: async () => {
        throw new ConfigError('GITHUB_TOKEN is not configured');
      },
    });
    const err = await failure(h.service.sync(WS));
    expect(err.message).toContain('GITHUB_TOKEN');
    expect(h.store.ingested).toHaveLength(0);
    expect(h.store.failed).toHaveLength(0);
    await expect(h.service.sync(WS)).rejects.toThrow('GITHUB_TOKEN');
  });
});
