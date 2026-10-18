import type { MultiAgentEstimates, MultiAgentRun, MultiAgentRunLatest } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import type { MultiAgentDeps, MultiAgentReviews } from './deps.js';
import { buildMultiAgentRun } from './helpers.js';
import { MultiAgentRepository } from './repository.js';

/** Multi-agent review: start one run over several agents, read it back with grouped findings. */
export class MultiAgentService {
  private repo: MultiAgentRepository;
  private reviews: MultiAgentReviews;

  constructor(deps: MultiAgentDeps) {
    this.repo = new MultiAgentRepository(deps.db);
    this.reviews = deps.reviewService;
  }

  async start(workspaceId: string, prId: string, agentIds: string[]): Promise<MultiAgentRun> {
    const ids = [...new Set(agentIds)];
    if (!(await this.repo.pullInWorkspace(workspaceId, prId))) {
      throw new NotFoundError('Pull request not found');
    }
    if ((await this.repo.countAgents(workspaceId, ids)) !== ids.length) {
      throw new NotFoundError('Agent not found');
    }
    const multiAgentRunId = await this.repo.insertRun(workspaceId, prId);
    await this.reviews.runReview(workspaceId, prId, { agentIds: ids, multiAgentRunId });
    return this.get(workspaceId, multiAgentRunId);
  }

  async get(workspaceId: string, id: string): Promise<MultiAgentRun> {
    const head = await this.repo.getRunHead(workspaceId, id);
    if (!head) throw new NotFoundError('Multi-agent run not found');
    const children = await this.repo.children(id);
    const reviews = await this.reviews.reviewsForRuns(
      workspaceId,
      children.map((c) => c.runId),
    );
    return buildMultiAgentRun(head, children, reviews);
  }

  async latest(workspaceId: string, repoId: string): Promise<MultiAgentRunLatest> {
    if (!(await this.repo.repoInWorkspace(workspaceId, repoId))) {
      throw new NotFoundError('Repo not found');
    }
    const id = await this.repo.latestRunId(workspaceId, repoId);
    return { run: id ? await this.get(workspaceId, id) : null };
  }

  async estimates(workspaceId: string): Promise<MultiAgentEstimates> {
    const rows = await this.repo.estimates(workspaceId);
    return {
      estimates: rows.map((r) => ({
        agent_id: r.agentId,
        duration_ms: r.durationMs,
        cost_usd: r.costUsd,
      })),
    };
  }
}
