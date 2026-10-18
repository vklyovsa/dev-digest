import type { FindingRecord } from '@devdigest/shared';
import type { Db } from '../../db/client.js';

/**
 * The two things a multi-agent run needs from the reviews module, declared by
 * the consumer. `ReviewService` satisfies it structurally, so this module never
 * imports the reviews data layer or the composition root.
 */
export interface MultiAgentReviews {
  runReview(
    workspaceId: string,
    prId: string,
    opts: { agentIds: string[]; multiAgentRunId: string },
  ): Promise<unknown>;
  reviewsForRuns(
    workspaceId: string,
    runIds: string[],
  ): Promise<
    {
      run_id: string | null;
      verdict: string | null;
      summary: string | null;
      findings: FindingRecord[];
    }[]
  >;
}

export interface MultiAgentDeps {
  readonly db: Db;
  readonly reviewService: MultiAgentReviews;
}
