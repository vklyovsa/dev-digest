import type {
  BlastHistoryResponse,
  BlastHistoryUnavailableReason,
  BlastRadiusResponse,
  MergedPullWithFiles,
} from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { MAX_CALLERS_PER_SYMBOL } from '../repo-intel/constants.js';
import { HISTORY_MAX_ITEMS, HISTORY_SCAN_LIMIT } from './constants.js';
import { buildPrHistory, toBlastRadiusResponse } from './helpers.js';
import type { BlastDeps, BlastGitHubFactory, BlastPullRecord } from './types.js';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function unavailable(reason: BlastHistoryUnavailableReason): BlastHistoryResponse {
  return { history: [], available: false, unavailable_reason: reason };
}

export class BlastService {
  constructor(private readonly deps: BlastDeps) {}

  async forPull(workspaceId: string, prId: string): Promise<BlastRadiusResponse> {
    const startedAt = Date.now();
    const pr = await this.requirePull(workspaceId, prId);
    const changedFiles = await this.changedFiles(pr.id);

    const [result, state] = await Promise.all([
      this.deps.repoIntel.getBlastRadius(pr.repoId, changedFiles),
      this.deps.repoIntel.getIndexState(pr.repoId),
    ]);

    const response = toBlastRadiusResponse(result, {
      indexStatus: state.status,
      indexedSha: state.lastIndexedSha,
      changedFilesCount: changedFiles.length,
      maxCallersPerSymbol: MAX_CALLERS_PER_SYMBOL,
    });

    this.deps.log.info(
      {
        prId: pr.id,
        repoId: pr.repoId,
        source: result.degraded ? 'fallback' : 'index',
        indexStatus: state.status,
        changedFiles: changedFiles.length,
        ...response.totals,
        degraded: response.degraded,
        reason: response.reason,
        durationMs: Date.now() - startedAt,
      },
      'blast radius served',
    );
    return response;
  }

  async historyForPull(workspaceId: string, prId: string): Promise<BlastHistoryResponse> {
    const pr = await this.requirePull(workspaceId, prId);
    const repo = await this.deps.repos.getById(workspaceId, pr.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const changedFiles = await this.changedFiles(pr.id);
    if (changedFiles.length === 0) return unavailable('no_changed_files');

    let gh: Awaited<ReturnType<BlastGitHubFactory>>;
    try {
      gh = await this.deps.github();
    } catch (err) {
      this.deps.log.warn({ err: messageOf(err) }, 'blast history: GitHub client unavailable');
      return unavailable('no_token');
    }

    let merged: MergedPullWithFiles[];
    try {
      merged = await gh.listMergedPullsWithFiles(
        { owner: repo.owner, name: repo.name },
        HISTORY_SCAN_LIMIT,
      );
    } catch (err) {
      this.deps.log.warn({ err: messageOf(err) }, 'blast history: GitHub request failed');
      return unavailable('github_error');
    }

    return {
      history: buildPrHistory(merged, { number: pr.number, changedFiles }, HISTORY_MAX_ITEMS),
      available: true,
      unavailable_reason: null,
    };
  }

  private async requirePull(workspaceId: string, prId: string): Promise<BlastPullRecord> {
    const pr = await this.deps.pulls.getById(workspaceId, prId);
    if (!pr) throw new NotFoundError('Pull request not found');
    return pr;
  }

  private async changedFiles(prId: string): Promise<string[]> {
    return (await this.deps.pulls.listFiles(prId)).map((f) => f.path);
  }
}
