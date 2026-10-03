import {
  CLIP,
  CONVENTIONS_LIMIT_DEFAULT,
  CONVENTIONS_LIMIT_MAX,
  LABEL_MAX,
  MAX_RESULT_CHARS,
} from '../constants.js';
import type { ConventionInfo, DevDigestApi } from '../ports.js';
import { resolveRepo } from '../resolve.js';
import { clip, compareText, shrinkToFit } from '../text.js';

export interface GetConventionsArgs {
  repo: string;
  limit?: number;
  detailed?: boolean;
}

export interface ConventionBrief {
  category: string;
  rule: string;
}

export interface ConventionDetail extends ConventionBrief {
  why: string | null;
  evidence: string;
  confidence: number;
}

export interface GetConventionsResult {
  repo: string;
  total: number;
  conventions: (ConventionBrief | ConventionDetail)[];
  scanned_at: string | null;
  pending?: number;
  truncated?: true;
  next?: string;
}

const CONVENTIONS_PAGE = "the repository's Conventions page in the DevDigest UI";

const byCategory = (a: ConventionInfo, b: ConventionInfo): number =>
  compareText(a.category.toLowerCase(), b.category.toLowerCase()) ||
  b.confidence - a.confidence ||
  compareText(a.id, b.id);

function effectiveLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return CONVENTIONS_LIMIT_DEFAULT;
  return Math.min(CONVENTIONS_LIMIT_MAX, Math.max(1, Math.trunc(limit)));
}

function evidenceOf(convention: ConventionInfo): string {
  const path = clip(convention.evidencePath, CLIP.path);
  const start = convention.evidenceLineStart;
  if (start === null) return path;
  const end = convention.evidenceLineEnd;
  return end !== null && end > start ? `${path}:${start}-${end}` : `${path}:${start}`;
}

function toBrief(convention: ConventionInfo): ConventionBrief {
  return {
    category: clip(convention.category, LABEL_MAX),
    rule: clip(convention.rule, CLIP.rule),
  };
}

function toDetail(convention: ConventionInfo): ConventionDetail {
  return {
    ...toBrief(convention),
    why: convention.rationale === null ? null : clip(convention.rationale, CLIP.rationale) || null,
    evidence: evidenceOf(convention),
    confidence: Math.round(convention.confidence * 100) / 100,
  };
}

function emptyHint(pending: number): string {
  const waiting = pending > 0 ? ` ${pending} candidate${pending === 1 ? ' is' : 's are'} waiting for review.` : '';
  return `No accepted conventions yet.${waiting} Open ${CONVENTIONS_PAGE}, run a scan and accept the rules worth keeping, then call get_conventions again.`;
}

function truncationHint(shown: number, total: number, limit: number, sizeCapped: boolean): string {
  const head = `Showing ${shown} of ${total} accepted conventions, sorted by category.`;
  if (sizeCapped) {
    return `${head} The rest were left out to keep this result small; open ${CONVENTIONS_PAGE} to see them.`;
  }
  if (limit < CONVENTIONS_LIMIT_MAX) {
    return `${head} For more, call get_conventions with the same repo and limit up to ${CONVENTIONS_LIMIT_MAX}.`;
  }
  return `${head} Open ${CONVENTIONS_PAGE} to see the rest.`;
}

export async function getConventions(
  api: DevDigestApi,
  args: GetConventionsArgs,
  signal?: AbortSignal,
): Promise<GetConventionsResult> {
  const repo = resolveRepo(await api.listRepos(signal), args.repo);
  const page = await api.getConventions(repo.id, signal);

  const accepted = page.conventions.filter((c) => c.status === 'accepted').sort(byCategory);
  const pending = page.conventions.filter((c) => c.status === 'pending').length;
  const detailed = args.detailed === true;
  const limit = effectiveLimit(args.limit);
  const wanted = Math.min(limit, accepted.length);

  const { value } = shrinkToFit<GetConventionsResult>(
    wanted,
    (shown) => ({
      repo: repo.fullName,
      total: accepted.length,
      conventions: accepted.slice(0, shown).map(detailed ? toDetail : toBrief),
      scanned_at: page.scannedAt,
      ...(pending > 0 ? { pending } : {}),
      ...(shown < accepted.length
        ? {
            truncated: true as const,
            next: truncationHint(shown, accepted.length, limit, shown < wanted),
          }
        : {}),
      ...(accepted.length === 0 ? { next: emptyHint(pending) } : {}),
    }),
    MAX_RESULT_CHARS,
  );
  return value;
}
