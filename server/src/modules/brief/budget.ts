import type { Intent } from '@devdigest/shared';
import { renderBriefInput } from './render.js';
import type { BriefFacts, DiffStatFile } from './types.js';

export interface FitOptions {
  system: string;
  budget: number;
  count: (text: string) => number;
}

type Fits = (facts: BriefFacts) => boolean;
type Step = (facts: BriefFacts, fits: Fits) => BriefFacts;

/**
 * Largest n in [1, max] with `fits(n)`, or 0 when none fits. The token count is not perfectly
 * monotone, so the result is always an n that was itself tested, never an untested bisection bound.
 */
function largestFit(max: number, fits: (n: number) => boolean): number {
  let lo = 0;
  let hi = Math.max(max, 0);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function cutText(text: string, length: number): string {
  const end = Math.max(0, Math.min(length, text.length));
  const last = text.charCodeAt(end - 1);
  const splitsPair = end > 0 && end < text.length && last >= 0xd800 && last <= 0xdbff;
  return text.slice(0, splitsPair ? end - 1 : end);
}

function withIntent(facts: BriefFacts, intent: Intent): BriefFacts {
  const empty =
    intent.intent.trim() === '' && intent.in_scope.length === 0 && intent.out_of_scope.length === 0;
  return { ...facts, intent: empty ? null : intent };
}

const shrinkDocuments: Step = (facts, fits) => {
  const docs = facts.documents;
  if (docs.length === 0) return facts;
  const withDocs = (documents: BriefFacts['documents']): BriefFacts => ({ ...facts, documents });
  if (!fits(withDocs([]))) return withDocs([]);

  const whole = largestFit(docs.length - 1, (k) => fits(withDocs(docs.slice(0, k))));
  const kept = docs.slice(0, whole);
  const next = docs[whole];
  if (next === undefined) return withDocs(kept);

  const length = largestFit(next.text.length - 1, (p) =>
    fits(withDocs([...kept, { path: next.path, text: cutText(next.text, p) }])),
  );
  const text = cutText(next.text, length);
  return withDocs(text === '' ? kept : [...kept, { path: next.path, text }]);
};

const shrinkDescription: Step = (facts, fits) => {
  const text = facts.description;
  if (text === '') return facts;
  const length = largestFit(text.length - 1, (p) =>
    fits({ ...facts, description: cutText(text, p) }),
  );
  return { ...facts, description: cutText(text, length) };
};

const shrinkCallerFiles: Step = (facts, fits) => {
  const { blast } = facts;
  if (blast === null || blast.callerFiles.length === 0) return facts;
  const withCallers = (count: number): BriefFacts => ({
    ...facts,
    blast: { ...blast, callerFiles: blast.callerFiles.slice(0, count) },
  });
  return withCallers(largestFit(blast.callerFiles.length - 1, (k) => fits(withCallers(k))));
};

const shrinkOutOfScope: Step = (facts, fits) => {
  const { intent } = facts;
  if (intent === null || intent.out_of_scope.length === 0) return facts;
  const withItems = (count: number): BriefFacts =>
    withIntent(facts, { ...intent, out_of_scope: intent.out_of_scope.slice(0, count) });
  return withItems(largestFit(intent.out_of_scope.length - 1, (k) => fits(withItems(k))));
};

const shrinkInScope: Step = (facts, fits) => {
  const { intent } = facts;
  if (intent === null || intent.in_scope.length === 0) return facts;
  const withItems = (count: number): BriefFacts =>
    withIntent(facts, { ...intent, in_scope: intent.in_scope.slice(0, count) });
  return withItems(largestFit(intent.in_scope.length - 1, (k) => fits(withItems(k))));
};

const shrinkSentence: Step = (facts, fits) => {
  const { intent } = facts;
  if (intent === null || intent.intent === '') return facts;
  const withSentence = (length: number): BriefFacts =>
    withIntent(facts, { ...intent, intent: cutText(intent.intent, length) });
  return withSentence(largestFit(intent.intent.length - 1, (p) => fits(withSentence(p))));
};

const shrinkFiles: Step = (facts, fits) => {
  if (facts.files.length === 0) return facts;
  const keepOrder = [...facts.files]
    .sort(
      (a, b) =>
        a.additions + a.deletions - (b.additions + b.deletions) ||
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    )
    .reverse();
  const withLargest = (count: number): BriefFacts => {
    const kept = new Set<DiffStatFile>(keepOrder.slice(0, count));
    return { ...facts, files: facts.files.filter((f) => kept.has(f)) };
  };
  return withLargest(largestFit(facts.files.length - 1, (k) => fits(withLargest(k))));
};

const STEPS: readonly Step[] = [
  shrinkDocuments,
  shrinkDescription,
  shrinkCallerFiles,
  shrinkOutOfScope,
  shrinkInScope,
  shrinkSentence,
  shrinkFiles,
];

export function fitToBudget(
  facts: BriefFacts,
  { system, budget, count }: FitOptions,
): { facts: BriefFacts; inputTokens: number } {
  const systemTokens = count(system);
  const measure = (candidate: BriefFacts): number =>
    systemTokens + count(renderBriefInput(candidate).user);
  const fits: Fits = (candidate) => measure(candidate) <= budget;

  let current = facts;
  let inputTokens = measure(current);
  for (const step of STEPS) {
    if (inputTokens <= budget) break;
    const next = step(current, fits);
    if (next === current) continue;
    current = next;
    inputTokens = measure(current);
  }
  return { facts: current, inputTokens };
}
