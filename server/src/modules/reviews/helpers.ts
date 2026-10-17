/**
 * Pure helpers for the review service (side-effect free; operate purely on
 * their arguments — no DB / network / `this`).
 */
import type { Finding, UnifiedDiff } from '@devdigest/shared';
import { sliceDiff, type PromptAssembledInfo } from '@devdigest/reviewer-core';
import type { PromptLogSection } from '../../platform/prompt-log.js';
import type { FindingRow, ReviewRow } from './repository.js';

// reduceReviews + sliceDiff live in @devdigest/reviewer-core (pure engine logic
// shared with the CI runner); re-exported here for backward-compatible imports.
export { reduceReviews, sliceDiff } from '@devdigest/reviewer-core';

// The prompt parts live in the domain so the eval module can use them too.
export { taskLine, renderSkillBlocks, type PromptSkill } from '../../domain/reviews/prompt-parts.js';

export interface ReviewDtoFinding extends Finding {
  review_id: string;
  accepted_at: string | null;
  dismissed_at: string | null;
}

export interface ReviewDto {
  id: string;
  pr_id: string;
  agent_id: string | null;
  run_id: string | null;
  agent_name?: string | null;
  kind: 'summary' | 'review';
  verdict: string | null;
  summary: string | null;
  score: number | null;
  model: string | null;
  grounding?: string | null;
  created_at: string;
  findings: ReviewDtoFinding[];
}

export function findingRowToDto(row: FindingRow): ReviewDtoFinding {
  return {
    id: row.id,
    severity: row.severity as Finding['severity'],
    category: row.category as Finding['category'],
    title: row.title,
    file: row.file,
    start_line: row.startLine,
    end_line: row.endLine,
    rationale: row.rationale,
    suggestion: row.suggestion ?? null,
    confidence: row.confidence,
    kind: (row.kind as Finding['kind']) ?? 'finding',
    trifecta_components: (row.trifectaComponents as Finding['trifecta_components']) ?? null,
    evidence: null,
    review_id: row.reviewId,
    accepted_at: row.acceptedAt?.toISOString() ?? null,
    dismissed_at: row.dismissedAt?.toISOString() ?? null,
  };
}

export function reviewToDto(
  review: ReviewRow,
  findings: FindingRow[],
  agentName?: string | null,
): ReviewDto {
  return {
    id: review.id,
    pr_id: review.prId,
    agent_id: review.agentId,
    run_id: review.runId,
    agent_name: agentName ?? null,
    kind: review.kind as 'summary' | 'review',
    verdict: review.verdict,
    summary: review.summary,
    score: review.score,
    model: review.model,
    created_at: review.createdAt.toISOString(),
    findings: findings.map(findingRowToDto),
  };
}

/** Verbose prompt-log labels: which skill and which diff file each size belongs to. */
export function promptSectionDetails(
  info: PromptAssembledInfo,
  skillNames: string[],
  diff: UnifiedDiff,
): PromptLogSection[] {
  return info.sections.map((section) => {
    if (section.name === 'skills' && section.items) {
      return {
        ...section,
        details: section.items.map((chars, i) => ({ label: skillNames[i] ?? `skill-${i + 1}`, chars })),
      };
    }
    if (section.name === 'diff') {
      const paths = info.mode === 'map-reduce' ? [info.chunkLabel] : diff.files.map((f) => f.path);
      return {
        ...section,
        details: paths.map((path) => ({ label: path, chars: sliceDiff(diff, path).length })),
      };
    }
    return section;
  });
}
