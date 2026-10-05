import type { BlastRadius, Intent, PrBriefAnswer, PrBriefRecord, Risk } from '@devdigest/shared';
import { HUNK_NEW_SIDE_RE } from './constants.js';
import type { AnswerCheck, LineRange, StoredBrief, ValidatedAnswer } from './types.js';

export function changedLineRanges(patch: string | null): LineRange[] {
  if (!patch) return [];
  const ranges: LineRange[] = [];
  for (const line of patch.split('\n')) {
    if (!line.startsWith('@@')) continue;
    const match = HUNK_NEW_SIDE_RE.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const length = match[2] === undefined ? 1 : Number(match[2]);
    if (length === 0) continue;
    ranges.push({ start, end: start + length - 1 });
  }
  return ranges;
}

export function allowedFiles(prFiles: readonly string[], blast: BlastRadius | null): Set<string> {
  const allowed = new Set(prFiles);
  if (blast === null) return allowed;
  for (const symbol of blast.changed_symbols) allowed.add(symbol.file);
  for (const impact of blast.downstream) {
    for (const caller of impact.callers) allowed.add(caller.file);
  }
  return allowed;
}

export function validateAnswer(answer: PrBriefAnswer, check: AnswerCheck): ValidatedAnswer {
  const risks: Risk[] = [];
  for (const risk of answer.risks) {
    if (risk.title.trim() === '') continue;
    const fileRefs = risk.file_refs.filter((path) => check.allowed.has(path));
    if (fileRefs.length === 0) continue;
    risks.push({ ...risk, file_refs: fileRefs });
  }

  const reviewFocus = answer.review_focus.filter(
    (item) =>
      item.reason.trim() !== '' &&
      check.allowed.has(item.file) &&
      (check.ranges.get(item.file) ?? []).some(
        (range) => item.line >= range.start && item.line <= range.end,
      ),
  );

  return {
    risks,
    reviewFocus,
    discarded: {
      risks: answer.risks.length - risks.length,
      reviewFocus: answer.review_focus.length - reviewFocus.length,
    },
  };
}

export function toStoredIntent(intent: Intent | null): Intent | null {
  if (intent === null) return null;
  return { intent: intent.intent, in_scope: intent.in_scope, out_of_scope: intent.out_of_scope };
}

export function toStoredBlast(blast: BlastRadius): BlastRadius | null {
  if (blast.changed_symbols.length === 0) return null;
  return {
    changed_symbols: blast.changed_symbols,
    downstream: blast.downstream,
    summary: blast.summary,
  };
}

export function callerFilesOf(blast: BlastRadius): string[] {
  const files = new Set<string>();
  for (const impact of blast.downstream) {
    for (const caller of impact.callers) files.add(caller.file);
  }
  return [...files];
}

export function toBriefRecord(stored: StoredBrief, currentHeadSha: string): PrBriefRecord {
  return { ...stored, stale: stored.head_sha !== currentHeadSha };
}
