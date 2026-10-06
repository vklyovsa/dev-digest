import type { FindingRecord, ReviewRecord, Verdict } from "@devdigest/shared";

export type ReviewWithVerdict = ReviewRecord & { verdict: Verdict };

function hasVerdict(review: ReviewRecord): review is ReviewWithVerdict {
  return review.verdict !== null;
}

function timeOf(review: ReviewRecord): number {
  const time = Date.parse(review.created_at);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** On equal timestamps the earlier entry wins — reviews arrive newest-run-first. */
export function newestReviewWithVerdict(reviews: ReviewRecord[] | undefined): ReviewWithVerdict | null {
  let newest: ReviewWithVerdict | null = null;
  for (const review of reviews ?? []) {
    if (!hasVerdict(review)) continue;
    if (newest === null || timeOf(review) > timeOf(newest)) newest = review;
  }
  return newest;
}

/** Mirrors the blocker count on the review run card. */
export function blockerCount(findings: FindingRecord[]): number {
  return findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length;
}
