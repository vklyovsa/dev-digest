import {
  CLIP,
  FINDINGS_LIMIT_DEFAULT,
  FINDINGS_LIMIT_DETAILED_MAX,
  FINDINGS_LIMIT_MAX,
  LABEL_MAX,
  MAX_RESULT_CHARS,
} from './constants.js';
import type { FindingInfo, ReviewInfo, RunInfo } from './ports.js';
import { clip, compareText } from './text.js';

export const SEVERITIES = ['CRITICAL', 'WARNING', 'SUGGESTION'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface SeverityCounts {
  critical: number;
  warning: number;
  suggestion: number;
  other?: number;
}

export interface FindingBrief {
  severity: string;
  title: string;
  file: string;
  lines: string;
  category: string;
}

export interface FindingDetail extends FindingBrief {
  id: string;
  confidence: number;
  rationale: string;
  suggestion: string | null;
}

export interface DoneOutcome {
  status: 'done';
  run_id: string;
  repo: string;
  pr: number;
  agent: string | null;
  verdict: string | null;
  score: number | null;
  blockers: number | null;
  counts: SeverityCounts;
  total: number;
  dismissed?: number;
  matched?: number;
  findings: (FindingBrief | FindingDetail)[];
  truncated?: true;
  next?: string;
  attached?: true;
  summary?: string | null;
  model?: string | null;
  ran_at?: string | null;
  duration_s?: number | null;
  cost_usd?: number | null;
}

export interface OutcomeOptions {
  repo: string;
  pr: number;
  minSeverity?: Severity;
  limit?: number;
  detailed?: boolean;
}

export interface RunningOutcome {
  status: 'running';
  run_id: string;
  repo: string;
  pr: number;
  agent: string | null;
  waited_s?: number;
  next: string;
  attached?: true;
}

export interface EmptyOutcome {
  status: 'done' | 'failed' | 'cancelled';
  run_id: string;
  repo: string;
  pr: number;
  agent: string | null;
  error?: string | null;
  verdict: null;
  counts: Record<string, never>;
  total: 0;
  findings: [];
  next?: string;
}

export const REVIEW_MISSING_HINT =
  'The run finished, but DevDigest no longer holds its review (it may have been deleted). Open the pull request in DevDigest, or call run_agent_on_pr only if the user still wants a new review.';

const OTHER_RANK = SEVERITIES.length;

function canonicalSeverity(severity: string): Severity | undefined {
  const upper = severity.trim().toUpperCase();
  return SEVERITIES.find((s) => s === upper);
}

function rankOf(severity: string): number {
  const known = canonicalSeverity(severity);
  return known === undefined ? OTHER_RANK : SEVERITIES.indexOf(known);
}

const byPriority = (a: FindingInfo, b: FindingInfo): number =>
  rankOf(a.severity) - rankOf(b.severity) ||
  b.confidence - a.confidence ||
  compareText(a.file, b.file) ||
  a.startLine - b.startLine ||
  compareText(a.id, b.id);

export function countBySeverity(findings: readonly Pick<FindingInfo, 'severity'>[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, warning: 0, suggestion: 0 };
  let other = 0;
  for (const finding of findings) {
    switch (canonicalSeverity(finding.severity)) {
      case 'CRITICAL':
        counts.critical += 1;
        break;
      case 'WARNING':
        counts.warning += 1;
        break;
      case 'SUGGESTION':
        counts.suggestion += 1;
        break;
      default:
        other += 1;
    }
  }
  if (other > 0) counts.other = other;
  return counts;
}

function effectiveLimit(limit: number | undefined, detailed: boolean): number {
  const max = detailed ? FINDINGS_LIMIT_DETAILED_MAX : FINDINGS_LIMIT_MAX;
  if (limit === undefined || !Number.isFinite(limit)) return Math.min(FINDINGS_LIMIT_DEFAULT, max);
  return Math.min(max, Math.max(1, Math.trunc(limit)));
}

function lineRange(finding: FindingInfo): string {
  return finding.endLine > finding.startLine
    ? `${finding.startLine}-${finding.endLine}`
    : `${finding.startLine}`;
}

function toBrief(finding: FindingInfo): FindingBrief {
  return {
    severity: canonicalSeverity(finding.severity) ?? clip(finding.severity, LABEL_MAX),
    title: clip(finding.title, CLIP.title),
    file: clip(finding.file, CLIP.path),
    lines: lineRange(finding),
    category: clip(finding.category, LABEL_MAX),
  };
}

function toDetail(finding: FindingInfo): FindingDetail {
  return {
    ...toBrief(finding),
    id: finding.id,
    confidence: Math.round(finding.confidence * 100) / 100,
    rationale: clip(finding.rationale, CLIP.rationale),
    suggestion: finding.suggestion === null ? null : clip(finding.suggestion, CLIP.suggestion) || null,
  };
}

function truncationHint(
  shown: number,
  matched: number,
  runId: string,
  limit: number,
  detailed: boolean,
  sizeCapped: boolean,
): string {
  const head = `Showing ${shown} of ${matched} findings, worst first.`;
  if (sizeCapped) {
    return `${head} The rest were left out to keep this result small; open the pull request in DevDigest to see them.`;
  }
  const maxLimit = detailed ? FINDINGS_LIMIT_DETAILED_MAX : FINDINGS_LIMIT_MAX;
  if (limit < maxLimit) {
    return `${head} For more, call get_findings with the same repo and pr, run_id "${runId}" and limit up to ${maxLimit}.`;
  }
  if (detailed) {
    return `${head} For more, call get_findings with the same repo and pr, run_id "${runId}", detailed=false and limit up to ${FINDINGS_LIMIT_MAX}.`;
  }
  return `${head} The rest are lower priority; open the pull request in DevDigest to see them.`;
}

export function toOutcome(run: RunInfo, review: ReviewInfo, opts: OutcomeOptions): DoneOutcome {
  const detailed = opts.detailed === true;
  const limit = effectiveLimit(opts.limit, detailed);
  const open = review.findings.filter((f) => !f.dismissed);
  const dismissed = review.findings.length - open.length;
  const minRank = opts.minSeverity === undefined ? undefined : SEVERITIES.indexOf(opts.minSeverity);
  const matching = (minRank === undefined ? open : open.filter((f) => rankOf(f.severity) <= minRank)).sort(
    byPriority,
  );

  const render = (shown: number, sizeCapped: boolean): DoneOutcome => ({
    status: 'done',
    run_id: run.runId,
    repo: opts.repo,
    pr: opts.pr,
    agent: agentLabel(run),
    verdict: review.verdict,
    score: run.score ?? review.score,
    blockers: run.blockers,
    counts: countBySeverity(open),
    total: open.length,
    ...(dismissed > 0 ? { dismissed } : {}),
    ...(minRank !== undefined ? { matched: matching.length } : {}),
    findings: matching.slice(0, shown).map(detailed ? toDetail : toBrief),
    ...(shown < matching.length
      ? {
          truncated: true as const,
          next: truncationHint(shown, matching.length, run.runId, limit, detailed, sizeCapped),
        }
      : {}),
    ...(detailed
      ? {
          summary: review.summary === null ? null : clip(review.summary, CLIP.summary),
          model: run.model ?? review.model,
          ran_at: run.ranAt,
          duration_s: run.durationMs === null ? null : Math.round(run.durationMs / 100) / 10,
          cost_usd: run.costUsd,
        }
      : {}),
  });

  let shown = Math.min(limit, matching.length);
  let outcome = render(shown, false);
  while (shown > 0 && JSON.stringify(outcome).length > MAX_RESULT_CHARS) {
    shown -= 1;
    outcome = render(shown, true);
  }
  return outcome;
}

export function agentLabel(run: Pick<RunInfo, 'agentName' | 'agentId'>): string | null {
  return clip(run.agentName ?? run.agentId ?? '', CLIP.title) || null;
}

export function toRunningOutcome(
  run: Pick<RunInfo, 'runId' | 'agentName' | 'agentId'>,
  opts: { repo: string; pr: number; waitedS?: number },
): RunningOutcome {
  return {
    status: 'running',
    run_id: run.runId,
    repo: opts.repo,
    pr: opts.pr,
    agent: agentLabel(run),
    ...(opts.waitedS !== undefined ? { waited_s: opts.waitedS } : {}),
    next: `Not finished yet. Wait about 30 seconds, then call get_findings with the same repo and pr plus run_id "${run.runId}". Do not call run_agent_on_pr again: that starts a new paid run.`,
  };
}

export function toEmptyOutcome(
  run: Pick<RunInfo, 'runId' | 'agentName' | 'agentId' | 'error'>,
  opts: { repo: string; pr: number; status: EmptyOutcome['status']; next?: string },
): EmptyOutcome {
  const error = opts.status === 'done' ? undefined : clip(run.error ?? '', CLIP.error) || null;
  return {
    status: opts.status,
    run_id: run.runId,
    repo: opts.repo,
    pr: opts.pr,
    agent: agentLabel(run),
    ...(error !== undefined ? { error } : {}),
    verdict: null,
    counts: {},
    total: 0,
    findings: [],
    ...(opts.next !== undefined ? { next: opts.next } : {}),
  };
}
