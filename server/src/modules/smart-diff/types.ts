export interface SmartDiffFileRow {
  path: string;
  additions: number;
  deletions: number;
}

export interface SmartDiffReviewEntry {
  review: { id: string; agentId: string | null; kind: string; createdAt: Date };
  findings: { file: string; startLine: number }[];
}

export interface SmartDiffPullsReader {
  getById(workspaceId: string, prId: string): Promise<{ id: string } | undefined>;
  listFiles(prId: string): Promise<SmartDiffFileRow[]>;
}

export interface SmartDiffReviewsReader {
  reviewsForPull(prId: string): Promise<SmartDiffReviewEntry[]>;
}
