import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { insertEvalAgent } from './helpers/eval.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { CiRepository } from '../src/modules/ci/repository.js';
import { CiService } from '../src/modules/ci/service.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
type Json = Record<string, unknown>;
const SHA = 'c'.repeat(40);
const INPUT = { repo: 'acme/web', triggers: ['opened' as const], post_as: 'none' as const };

d('Export to CI (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let workspaceId: string;
  let dir: string;
  let bundlePath: string;

  const db = () => pg.handle.db;

  function service(gh: MockGitHubClient) {
    return new CiService({
      store: new CiRepository(db()),
      agents: app.container.agentsRepo,
      skills: app.container.skillsRepo,
      secrets: new MockSecretsProvider({}),
      log: { info: () => undefined },
      runnerBundlePath: bundlePath,
      github: async () => gh,
    });
  }

  const get = async (url: string) => (await app.inject({ method: 'GET', url })).json() as Json[];
  const installationsOf = (agentId: string) =>
    db().select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, agentId));

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'ci-it-'));
    bundlePath = path.join(dir, 'index.js');
    writeFileSync(bundlePath, '// runner\n');
    pg = await startPg();
    await seed(db());
    const [ws] = await db().select().from(t.workspaces);
    workspaceId = ws!.id;
    app = await buildApp({
      config: config(),
      db: db(),
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient(),
        secrets: new MockSecretsProvider({}),
        github: new MockGitHubClient(),
        llm: { openai: new MockLLMProvider('openai') },
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('AC-18, AC-19: one gha installation per export, refreshed on repeat; another agent gets 409 and no commit', async () => {
    const a = await insertEvalAgent(db(), workspaceId);
    const b = await insertEvalAgent(db(), workspaceId);
    const gh = new MockGitHubClient();

    await service(gh).exportToGithub(workspaceId, a.id, INPUT);
    const [first] = await installationsOf(a.id);
    expect(first).toMatchObject({ repo: 'acme/web', targetType: 'gha' });

    await service(gh).zip(workspaceId, a.id, INPUT);
    const after = await installationsOf(a.id);
    expect(after).toHaveLength(1);
    expect(after[0]!.installedAt.getTime()).toBeGreaterThan(first!.installedAt.getTime());

    const committedBefore = gh.committed.length;
    await expect(service(gh).exportToGithub(workspaceId, b.id, INPUT)).rejects.toMatchObject({ statusCode: 409 });
    expect(gh.committed).toHaveLength(committedBefore);
    expect(await installationsOf(b.id)).toHaveLength(0);
  });

  it('AC-45, AC-46, AC-47, AC-48, AC-60: sync stores both rows, is idempotent, and the installation reads back the latest run', async () => {
    await db().delete(t.ciInstallations);
    const agent = await insertEvalAgent(db(), workspaceId, { name: 'CI agent' });
    await db().insert(t.ciInstallations).values({ agentId: agent.id, repo: 'acme/sync', targetType: 'gha' });
    const art = zipSync({
      'devdigest-result.json': strToU8(
        JSON.stringify({
          findings_count: 3,
          critical: 1,
          warning: 1,
          suggestion: 1,
          cost_usd: 0.02,
          duration_ms: 4000,
          agent: 'CI agent',
          version: '1.0.0',
          pr_number: 9,
          head_sha: SHA,
          repository_id: 77,
          verdict: 'request_changes',
          blockers: 1,
          model: 'm/x',
          manifest_version: 4,
        }),
      ),
    });
    const ok = { id: 1, htmlUrl: 'https://github.com/acme/sync/actions/runs/1', headSha: SHA, prNumber: 9, startedAt: '2026-10-18T10:00:00Z', headRepositoryId: 77, event: 'pull_request' };
    const noArtifact = { id: 2, htmlUrl: 'https://github.com/acme/sync/actions/runs/2', headSha: SHA, prNumber: 10, startedAt: '2026-10-18T09:00:00Z', headRepositoryId: 77, event: 'pull_request' };
    const gh = new MockGitHubClient({
      repositoryId: 77,
      workflowRuns: [ok, noArtifact],
      artifacts: { 1: [{ id: 10, name: 'devdigest-result', sizeInBytes: 10, expired: false }] },
      artifactZips: { 10: art },
    });

    const first = await service(gh).sync(workspaceId);
    expect(first).toMatchObject({ ingested: 1, failed: 1, skipped: 0 });

    const [agentRun] = await db().select().from(t.agentRuns).where(and(eq(t.agentRuns.agentId, agent.id), eq(t.agentRuns.source, 'ci')));
    expect(agentRun).toMatchObject({ status: 'done', prId: null, model: 'm/x', durationMs: 4000, findingsCount: 3, blockers: 1, costUsd: 0.02 });
    const [trace] = await db().select().from(t.runTraces).where(eq(t.runTraces.runId, agentRun!.id));
    const tr = trace!.trace as { config: Json; ci: Json };
    expect(tr.config.source).toBe('ci');
    expect(tr.ci).toMatchObject({ repo: 'acme/sync', repository_id: 77, pr_number: 9, head_sha: SHA, run_url: ok.htmlUrl, manifest_version: 4, verdict: 'request_changes' });

    const rows = await db().select().from(t.ciRuns).where(eq(t.ciRuns.source, 'gha'));
    const mine = rows.filter((r) => r.githubUrl === ok.htmlUrl || r.githubUrl === noArtifact.htmlUrl);
    expect(mine.find((r) => r.githubUrl === ok.htmlUrl)).toMatchObject({ status: 'succeeded', findingsCount: 3, costUsd: 0.02, prNumber: 9 });
    expect(mine.find((r) => r.githubUrl === noArtifact.htmlUrl)).toMatchObject({ status: 'failed', findingsCount: null, costUsd: null });
    const failedAgentRuns = await db().select().from(t.agentRuns).where(and(eq(t.agentRuns.agentId, agent.id), isNull(t.agentRuns.prId)));
    expect(failedAgentRuns).toHaveLength(1);

    const second = await service(gh).sync(workspaceId);
    expect(second).toMatchObject({ ingested: 0, failed: 0, skipped: 2 });
    expect(await db().select().from(t.ciRuns).where(eq(t.ciRuns.source, 'gha'))).toHaveLength(rows.length);

    const installs = await get(`/agents/${agent.id}/ci/installations`);
    expect(installs).toHaveLength(1);
    expect(installs[0]).toMatchObject({ repo: 'acme/sync', latest_run_status: 'succeeded', manifest_version: 4 });
    expect(typeof installs[0]!.latest_run_at).toBe('string');
  });

  it('AC-60: an installation with no run reads back null latest run and manifest version', async () => {
    const agent = await insertEvalAgent(db(), workspaceId);
    await db().insert(t.ciInstallations).values({ agentId: agent.id, repo: 'acme/empty', targetType: 'gha' });
    const installs = await get(`/agents/${agent.id}/ci/installations`);
    expect(installs[0]).toMatchObject({ latest_run_status: null, latest_run_at: null, manifest_version: null });
  });

  it('AC-54: GET /ci/runs returns the 100 newest runs of the workspace, filtered by agent_id when given', async () => {
    const big = await insertEvalAgent(db(), workspaceId, { name: 'Big' });
    const other = await insertEvalAgent(db(), workspaceId, { name: 'Other' });
    const [instBig] = await db().insert(t.ciInstallations).values({ agentId: big.id, repo: 'acme/big', targetType: 'gha' }).returning();
    const [instOther] = await db().insert(t.ciInstallations).values({ agentId: other.id, repo: 'acme/other', targetType: 'gha' }).returning();
    const base = Date.UTC(2030, 0, 1);
    await db().insert(t.ciRuns).values(
      Array.from({ length: 105 }, (_, i) => ({
        ciInstallationId: instBig!.id,
        prNumber: i,
        ranAt: new Date(base + i * 60_000),
        status: 'succeeded',
        findingsCount: 0,
        githubUrl: `https://github.com/acme/big/actions/runs/${1000 + i}`,
        source: 'gha',
      })),
    );
    await db().insert(t.ciRuns).values({
      ciInstallationId: instOther!.id,
      prNumber: 1,
      ranAt: new Date(base - 60_000),
      status: 'no_findings',
      findingsCount: 0,
      githubUrl: 'https://github.com/acme/other/actions/runs/1',
      source: 'gha',
    });

    const all = await get('/ci/runs');
    expect(all).toHaveLength(100);
    expect(all[0]).toMatchObject({ pr_number: 104, repo: 'acme/big', agent: 'Big' });
    const times = all.map((r) => Date.parse(r.ran_at as string));
    expect(times).toEqual([...times].sort((x, y) => y - x));

    const filtered = await get(`/ci/runs?agent_id=${other.id}`);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({ repo: 'acme/other', agent_id: other.id });
  });
});
