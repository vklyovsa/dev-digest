import { promptFingerprint, wrapUntrusted } from '@devdigest/reviewer-core';
import type { Intent } from '@devdigest/shared';
import type { PromptLogSection } from '../../platform/prompt-log.js';
import type { BriefFacts, DiffStatFile } from './types.js';

interface SectionItem {
  label: string;
  text: string;
}

/**
 * `wrapUntrusted` escapes only the exact `</untrusted>`; a model reads `</UNTRUSTED >` as a close too.
 * One character class after the `<`: `\s*\/?\s*` overlaps and backtracks quadratically on `<` + whitespace.
 */
function wrapFact(label: string, text: string): string {
  return wrapUntrusted(label, text.replace(/<(?=[\s\/]*untrusted)/gi, '&lt;'));
}

function fileLine(file: DiffStatFile): string {
  const ranges =
    file.ranges.length > 0 ? file.ranges.map((r) => `${r.start}-${r.end}`).join(',') : 'none';
  return `${file.path} | +${file.additions} -${file.deletions} | ${file.role} | ${ranges}`;
}

function intentText(intent: Intent): string {
  const lines: string[] = [];
  if (intent.intent.trim() !== '') lines.push(intent.intent);
  if (intent.in_scope.length > 0) lines.push('In scope:', ...intent.in_scope.map((s) => `- ${s}`));
  if (intent.out_of_scope.length > 0) {
    lines.push('Out of scope:', ...intent.out_of_scope.map((s) => `- ${s}`));
  }
  return lines.join('\n');
}

function blastText(blast: { summary: string; callerFiles: string[] }): string {
  const lines: string[] = [];
  if (blast.summary.trim() !== '') lines.push(blast.summary);
  if (blast.callerFiles.length > 0) lines.push('Caller files:', ...blast.callerFiles);
  return lines.join('\n');
}

/** Headers and `wrapUntrusted` labels are fixed text; fact text never stands outside a block. */
export function renderBriefInput(facts: BriefFacts): {
  user: string;
  sections: PromptLogSection[];
} {
  const parts: string[] = [];
  const sections: PromptLogSection[] = [];
  const add = (name: string, source: string, items: SectionItem[]) => {
    const texts = items.map((i) => i.text);
    const joined = texts.join('\n\n');
    parts.push(joined);
    sections.push({
      name,
      source,
      wrapped: true,
      chars: joined.length,
      ...(items.length > 1 ? { items: texts.map((t) => t.length) } : {}),
      fingerprint: promptFingerprint(joined),
      details: items.map((i) => ({ label: i.label, chars: i.text.length })),
    });
  };

  if (facts.files.length > 0) {
    add('diff_stats', 'github-pr', [
      {
        label: `${facts.files.length} file(s)`,
        text: `## Diff statistics\n${wrapFact('diff-stats', facts.files.map(fileLine).join('\n'))}`,
      },
    ]);
  }

  const intent = facts.intent === null ? '' : intentText(facts.intent);
  if (intent !== '') {
    add('intent', 'intent-layer', [
      { label: 'intent', text: `## Intent\n${wrapFact('intent', intent)}` },
    ]);
  }

  const blast = facts.blast === null ? '' : blastText(facts.blast);
  if (blast !== '') {
    add('blast_radius', 'repo-intel', [
      { label: 'blast radius', text: `## Blast radius\n${wrapFact('blast-radius', blast)}` },
    ]);
  }

  const prText: SectionItem[] = [
    { label: 'title', text: `## PR title\n${wrapFact('pr-title', facts.title)}` },
  ];
  if (facts.description.trim() !== '') {
    prText.push({
      label: 'description',
      text: `## PR description\n${wrapFact('pr-description', facts.description)}`,
    });
  }
  add('pr_text', 'github-pr', prText);

  if (facts.documents.length > 0) {
    add(
      'documents',
      'project-context',
      facts.documents.map((doc) => ({
        label: doc.path,
        text: `## Attached document\n${wrapFact('document', `path: ${doc.path}\n\n${doc.text}`)}`,
      })),
    );
  }

  return { user: parts.join('\n\n'), sections };
}
