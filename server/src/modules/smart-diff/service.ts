import type { SmartDiff } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { buildSmartDiff, currentFindingLines } from './helpers.js';
import type { SmartDiffPullsReader, SmartDiffReviewsReader } from './types.js';

export class SmartDiffService {
  constructor(
    private readonly pulls: SmartDiffPullsReader,
    private readonly reviews: SmartDiffReviewsReader,
  ) {}

  async forPull(workspaceId: string, prId: string): Promise<SmartDiff> {
    const pr = await this.pulls.getById(workspaceId, prId);
    if (!pr) throw new NotFoundError('Pull request not found');
    const [files, reviews] = await Promise.all([
      this.pulls.listFiles(prId),
      this.reviews.reviewsForPull(prId),
    ]);
    return buildSmartDiff(files, currentFindingLines(reviews));
  }
}
