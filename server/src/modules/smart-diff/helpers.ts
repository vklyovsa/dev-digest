import type { SmartDiff, SmartDiffFile, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';
import { newestPerAgent } from '../../domain/reviews/current-opinion.js';
import { classifyFile } from './classify.js';
import { SMART_DIFF_ROLE_ORDER } from './constants.js';
import type { SmartDiffFileRow, SmartDiffReviewEntry } from './types.js';

export function currentFindingLines(reviews: SmartDiffReviewEntry[]): Map<string, number[]> {
  const lines = new Map<string, Set<number>>();
  for (const { findings } of newestPerAgent(reviews, (e) => e.review)) {
    for (const f of findings) {
      const set = lines.get(f.file) ?? new Set<number>();
      set.add(f.startLine);
      lines.set(f.file, set);
    }
  }
  return new Map([...lines].map(([file, set]) => [file, [...set].sort((a, b) => a - b)]));
}

export function buildSmartDiff(
  files: SmartDiffFileRow[],
  linesByPath: Map<string, number[]>,
): SmartDiff {
  const buckets = new Map<SmartDiffRole, SmartDiffFile[]>();
  let totalLines = 0;
  for (const f of files) {
    totalLines += f.additions + f.deletions;
    const role = classifyFile(f.path);
    const bucket = buckets.get(role) ?? [];
    bucket.push({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      finding_lines: linesByPath.get(f.path) ?? [],
    });
    buckets.set(role, bucket);
  }

  const groups: SmartDiffGroup[] = [];
  for (const role of SMART_DIFF_ROLE_ORDER) {
    const bucket = buckets.get(role);
    if (bucket) groups.push({ role, files: bucket });
  }

  return {
    groups,
    split_suggestion: { too_big: false, total_lines: totalLines, proposed_splits: [] },
  };
}
