import { existsSync, readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { CiResultArtifact } from '@devdigest/shared';
import type {
  CiExport,
  CiExportInput,
  CiFile,
  CiInstallation,
  CiRun,
  CiSyncResult,
  RepoRef,
  RunArtifactSummary,
  WorkflowRunSummary,
} from '@devdigest/shared';
import { AppError, ExternalServiceError, NotFoundError, ValidationError } from '../../platform/errors.js';
import {
  AGENTS_DIR,
  ARTIFACT_MAX_BYTES,
  ARTIFACT_NAME,
  CI_BRANCH,
  COMMIT_MESSAGE,
  DEFAULT_RUNNER_BUNDLE,
  PR_BODY,
  PR_TITLE,
  RESULT_FILE,
  RUN_LIST_LIMIT,
  SCANNED_SECRET_KEYS,
  SYNC_RUN_LIMIT,
  WORKFLOW_FILE,
  WORKFLOW_PATH,
} from './constants.js';
import { buildFiles } from './bundle.js';
import {
  findSecretFile,
  toCiFile,
  toCiRunDto,
  toInstallationDto,
  toPreviewFiles,
  zipFiles,
} from './helpers.js';
import type { CiAgentRecord, CiDeps } from './types.js';

type Rejection = CiSyncResult['rejected'][number]['reason'];
type ExportRequest = Pick<CiExportInput, 'repo' | 'triggers' | 'post_as'> &
  Partial<Pick<CiExportInput, 'workflow_yaml' | 'base'>>;

function repoRef(repo: string): RepoRef {
  const [owner = '', name = ''] = repo.split('/');
  return { owner, name };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class CiService {
  private readonly syncing = new Set<string>();

  constructor(private readonly deps: CiDeps) {}

  async preview(workspaceId: string, agentId: string, input: ExportRequest): Promise<CiFile[]> {
    const agent = await this.requireAgent(workspaceId, agentId);
    return toPreviewFiles(await this.assemble(workspaceId, agent, input));
  }

  async exportToGithub(
    workspaceId: string,
    agentId: string,
    input: ExportRequest,
  ): Promise<CiExport> {
    const agent = await this.requireAgent(workspaceId, agentId);
    await this.assertRepoFree(workspaceId, agent.id, input.repo);
    const files = await this.assemble(workspaceId, agent, input);
    const gh = await this.deps.github();
    const ref = repoRef(input.repo);
    const base = input.base ?? 'main';

    let prUrl: string;
    try {
      await gh.commitFiles(ref, {
        branch: CI_BRANCH,
        base,
        message: COMMIT_MESSAGE,
        files: files.map((f) => ({ path: f.path, contents: f.contents })),
        prune: [AGENTS_DIR],
      });
      const open = await gh.findOpenPr(ref, CI_BRANCH);
      prUrl = (
        open ??
        (await gh.openPullRequest(ref, {
          title: PR_TITLE,
          head: CI_BRANCH,
          base,
          body: PR_BODY,
        }))
      ).url;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new ExternalServiceError(errorMessage(err));
    }

    const installation = await this.deps.store.upsertInstallation(agent.id, input.repo);
    return {
      installation: toInstallationDto(installation),
      files: toPreviewFiles(files),
      pr_url: prUrl,
    };
  }

  async zip(workspaceId: string, agentId: string, input: ExportRequest): Promise<Buffer> {
    const agent = await this.requireAgent(workspaceId, agentId);
    await this.assertRepoFree(workspaceId, agent.id, input.repo);
    const files = await this.assemble(workspaceId, agent, input);
    const archive = zipFiles(files);
    await this.deps.store.upsertInstallation(agent.id, input.repo);
    return archive;
  }

  async listInstallations(workspaceId: string, agentId: string): Promise<CiInstallation[]> {
    await this.requireAgent(workspaceId, agentId);
    const rows = await this.deps.store.listInstallationsForAgent(agentId);
    return rows.map(toInstallationDto);
  }

  async listRuns(workspaceId: string, agentId: string | undefined): Promise<CiRun[]> {
    const rows = await this.deps.store.listRuns(workspaceId, agentId, RUN_LIST_LIMIT);
    return rows.map(toCiRunDto);
  }

  async sync(workspaceId: string): Promise<CiSyncResult> {
    if (this.syncing.has(workspaceId)) {
      throw new AppError('ci_sync_running', 'A CI sync is already running', 409);
    }
    this.syncing.add(workspaceId);
    try {
      const gh = await this.deps.github();
      const installations = await this.deps.store.listGhaInstallations(workspaceId);
      const result: CiSyncResult = { ingested: 0, skipped: 0, failed: 0, rejected: [], errors: [] };

      for (const inst of installations) {
        const before = {
          ingested: result.ingested,
          skipped: result.skipped,
          failed: result.failed,
          rejected: result.rejected.length,
        };
        try {
          const ref = repoRef(inst.repo);
          const repositoryId = await gh.getRepositoryId(ref);
          const runs = await gh.listCompletedWorkflowRuns(ref, WORKFLOW_FILE, SYNC_RUN_LIMIT);
          for (const run of runs) {
            await this.syncRun({ gh, inst, ref, repositoryId, run, workspaceId, result });
          }
        } catch (err) {
          result.errors.push({ repo: inst.repo, message: errorMessage(err) });
        }
        this.deps.log.info(
          {
            repo: inst.repo,
            ingested: result.ingested - before.ingested,
            skipped: result.skipped - before.skipped,
            failed: result.failed - before.failed,
            rejected: result.rejected.length - before.rejected,
          },
          'ci sync',
        );
      }
      return result;
    } finally {
      this.syncing.delete(workspaceId);
    }
  }

  private async syncRun(ctx: {
    gh: Awaited<ReturnType<CiDeps['github']>>;
    inst: { id: string; agentId: string; repo: string };
    ref: RepoRef;
    repositoryId: number;
    run: WorkflowRunSummary;
    workspaceId: string;
    result: CiSyncResult;
  }): Promise<void> {
    const { gh, inst, ref, repositoryId, run, workspaceId, result } = ctx;
    const { store } = this.deps;

    if (await store.ciRunExists(run.htmlUrl)) {
      result.skipped++;
      return;
    }

    const artifacts = await gh.listRunArtifacts(ref, run.id);
    const found = artifacts.find((a: RunArtifactSummary) => a.name === ARTIFACT_NAME && !a.expired);
    if (!found) {
      await store.insertFailedRun({
        installationId: inst.id,
        prNumber: run.prNumber,
        ranAt: new Date(run.startedAt),
        githubUrl: run.htmlUrl,
      });
      result.failed++;
      return;
    }

    const reject = (reason: Rejection) => {
      result.rejected.push({ run_url: run.htmlUrl, reason });
    };

    if (found.sizeInBytes > ARTIFACT_MAX_BYTES) return reject('artifact_unreadable');
    const archive = await gh.downloadArtifact(ref, found.id);
    if (archive.byteLength > ARTIFACT_MAX_BYTES) return reject('artifact_unreadable');

    let text: string;
    try {
      const entries = unzipSync(archive, {
        filter: (f) => f.name === RESULT_FILE && f.originalSize <= ARTIFACT_MAX_BYTES,
      });
      const entry = entries[RESULT_FILE];
      if (!entry) return reject('artifact_unreadable');
      text = strFromU8(entry);
    } catch {
      return reject('artifact_unreadable');
    }

    let parsed: ReturnType<typeof CiResultArtifact.safeParse>;
    try {
      parsed = CiResultArtifact.safeParse(JSON.parse(text));
    } catch {
      return reject('schema');
    }
    if (!parsed.success) return reject('schema');
    const artifact = parsed.data;

    if (artifact.head_sha !== run.headSha) return reject('head_sha_mismatch');
    if (artifact.repository_id !== repositoryId) return reject('repository_mismatch');

    await store.insertIngestedRun({
      workspaceId,
      agentId: inst.agentId,
      installationId: inst.id,
      artifact,
      run,
      repo: inst.repo,
      repositoryId,
    });
    result.ingested++;
  }

  private async requireAgent(workspaceId: string, agentId: string): Promise<CiAgentRecord> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  }

  private async assertRepoFree(workspaceId: string, agentId: string, repo: string): Promise<void> {
    const taken = await this.deps.store.findInstallationForRepo(workspaceId, repo);
    if (taken && taken.agentId !== agentId) {
      throw new AppError(
        'ci_repo_taken',
        `Repository ${repo} already has a CI installation of another agent`,
        409,
      );
    }
  }

  private async assemble(
    workspaceId: string,
    agent: CiAgentRecord,
    input: ExportRequest,
  ): Promise<CiFile[]> {
    const bundlePath = this.deps.runnerBundlePath ?? DEFAULT_RUNNER_BUNDLE;
    if (!existsSync(bundlePath)) {
      throw new AppError(
        'runner_bundle_missing',
        `Runner bundle not found at ${bundlePath}. Run: cd agent-runner && pnpm build`,
        409,
      );
    }
    const [skills, memory] = await Promise.all([
      this.deps.skills.linkedEnabled(agent.id),
      this.deps.store.globalMemory(workspaceId),
    ]);
    const files = buildFiles({
      agent,
      skills,
      memory,
      triggers: input.triggers,
      postAs: input.post_as,
      runner: { contents: readFileSync(bundlePath, 'utf8') },
    });

    const edited = input.workflow_yaml;
    const finalFiles = edited
      ? files.map((f) => (f.path === WORKFLOW_PATH ? toCiFile(WORKFLOW_PATH, edited, true) : f))
      : files;

    const values: string[] = [];
    for (const key of SCANNED_SECRET_KEYS) {
      const value = await this.deps.secrets.get(key);
      if (value) values.push(value);
    }
    const leaking = findSecretFile(finalFiles, values);
    if (leaking) throw new ValidationError(`Generated file ${leaking} contains a secret value`);
    return finalFiles;
  }
}
