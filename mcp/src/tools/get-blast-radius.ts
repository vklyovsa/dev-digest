import { BLAST_SYMBOLS_MAX, CLIP, MAX_RESULT_CHARS } from '../constants.js';
import type { BlastInfo, BlastSymbolInfo, DevDigestApi } from '../ports.js';
import { resolvePull, resolveRepo } from '../resolve.js';
import { clip, shrinkToFit } from '../text.js';

export interface GetBlastRadiusArgs {
  repo: string;
  pr: number;
}

export interface BlastSymbolBrief {
  symbol: string;
  callers: string[];
  endpoints: string[];
  crons: string[];
  capped?: true;
}

export interface GetBlastRadiusResult {
  repo: string;
  pr: number;
  summary: string;
  totals: { symbols: number; callers: number; endpoints: number; crons: number };
  degraded: boolean;
  reason: string | null;
  symbols: BlastSymbolBrief[];
  truncated?: true;
  next?: string;
}

const BLAST_BLOCK = "the Blast radius block on the PR's Overview tab in the DevDigest UI";

const NO_STORED_FILES =
  'DevDigest has no stored files for this pull request, so the map is empty. Open the PR in the DevDigest UI once (loading it needs a GitHub token in Settings), then call get_blast_radius again.';

const REASON_WORDS = new Map<string, string>([
  ['flag_off', 'repository indexing is turned off'],
  ['index_failed', 'the last indexing run failed'],
  ['index_partial', 'only part of the repository is indexed'],
  ['repo_too_large', 'the repository is too large to index fully'],
  ['no_data', 'the repository has not been indexed yet'],
]);

const reasonWords = (reason: string | null): string =>
  (reason === null ? undefined : REASON_WORDS.get(reason)) ?? 'reason unknown';

function toBrief(symbol: BlastSymbolInfo, callerCap: number): BlastSymbolBrief {
  return {
    symbol: clip(symbol.symbol, CLIP.title),
    callers: symbol.callers.map((c) => `${clip(c.file, CLIP.path)}:${c.line}`),
    endpoints: symbol.endpoints.map((e) => clip(e, CLIP.title)),
    crons: symbol.crons.map((c) => clip(c, CLIP.title)),
    ...(symbol.callers.length >= callerCap ? { capped: true as const } : {}),
  };
}

function nextHint(blast: BlastInfo, shown: number, total: number): string | undefined {
  if (blast.changedFiles === 0) return NO_STORED_FILES;
  const parts: string[] = [];
  if (blast.degraded) {
    parts.push(
      `The index is incomplete (${reasonWords(blast.reason)}), so callers may be missing. Use Re-index in ${BLAST_BLOCK}, then call get_blast_radius again.`,
    );
  }
  if (shown < total) {
    parts.push(
      `Showing ${shown} of ${total} symbols with callers, highest-ranked first. The rest were left out to keep this result small; see ${BLAST_BLOCK}.`,
    );
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

export async function getBlastRadius(
  api: DevDigestApi,
  args: GetBlastRadiusArgs,
  signal?: AbortSignal,
): Promise<GetBlastRadiusResult> {
  const repo = resolveRepo(await api.listRepos(signal), args.repo);
  const pull = resolvePull(await api.listPulls(repo.id, signal), repo.fullName, args.pr);

  let blast = await api.getBlastRadius(pull.id, signal);
  if (blast.changedFiles === 0) {
    await api.loadPullDetail(pull.id, signal);
    blast = await api.getBlastRadius(pull.id, signal);
  }

  const symbols = blast.symbols.map((s) => toBrief(s, blast.callerCap));
  const wanted = Math.min(BLAST_SYMBOLS_MAX, symbols.length);

  const { value } = shrinkToFit<GetBlastRadiusResult>(
    wanted,
    (shown) => {
      const next = nextHint(blast, shown, symbols.length);
      return {
        repo: repo.fullName,
        pr: pull.number,
        summary: clip(blast.summary, CLIP.summary),
        totals: blast.totals,
        degraded: blast.degraded,
        reason: blast.reason,
        symbols: symbols.slice(0, shown),
        ...(shown < symbols.length ? { truncated: true as const } : {}),
        ...(next === undefined ? {} : { next }),
      };
    },
    MAX_RESULT_CHARS,
  );
  return value;
}
