import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '@devdigest/reviewer-core';
import { logPromptAssembly, type PromptLog, type PromptLogContext } from '../src/platform/prompt-log.js';

/**
 * NFR-8 — the third place a run with project context is traceable: the `specs`
 * section of the `prompt.assembled` line carries its size, never its text.
 */

const DOC_ONE = { path: 'specs/payments-invariants.md', text: 'ALPHA-MARKER-7f3a payments must stay idempotent.' };
const DOC_TWO = { path: 'docs/limits.md', text: 'BETA-MARKER-9c1d the rate limit is sixty seconds.' };

const CTX: PromptLogContext = {
  purpose: 'review',
  correlationId: 'corr-1',
  prId: 'pr-1',
  runId: 'run-1',
  agent: 'Context agent',
  provider: 'openai',
  model: 'gpt-4.1',
  strategy: 'single-pass',
  chunk: { index: 0, count: 1, label: 'all' },
};

function sink() {
  const lines: { obj: Record<string, unknown>; msg?: string }[] = [];
  return {
    lines,
    sink: {
      info: (obj: unknown, msg?: string) => {
        lines.push({ obj: obj as Record<string, unknown>, msg });
      },
    },
  };
}

type LoggedSection = { name: string; source: string; wrapped: boolean; chars: number; approxTokens: number };

describe('logPromptAssembly with project context', () => {
  const { sections, assembly } = assemblePrompt({
    system: 'You are a reviewer.',
    specs: [DOC_ONE, DOC_TWO],
    diff: '@@ -1 +1 @@\n+const x = 1;',
    task: "Review PR #1 'rate limit'",
  });

  it('logs a specs section with its chars and token estimate', () => {
    const out = sink();
    const log: PromptLog = { mode: 'summary', sink: out.sink };

    logPromptAssembly(log, CTX, sections);

    expect(out.lines).toHaveLength(1);
    const logged = (out.lines[0]!.obj.sections as LoggedSection[]).find((s) => s.name === 'specs');
    expect(logged).toBeDefined();
    expect(logged).toMatchObject({ source: 'project-context', wrapped: true });
    expect(logged!.chars).toBe(`## Project context\n${assembly.specs}`.length);
    expect(logged!.approxTokens).toBe(Math.ceil(logged!.chars / 4));
  });

  it('holds none of the document text or paths in the serialised summary line', () => {
    const out = sink();

    logPromptAssembly({ mode: 'summary', sink: out.sink }, CTX, sections);

    const serialised = JSON.stringify(out.lines);
    for (const doc of [DOC_ONE, DOC_TWO]) {
      expect(serialised).not.toContain(doc.text);
      expect(serialised).not.toContain('MARKER');
      expect(serialised).not.toContain(doc.path);
    }
  });

  it('keeps document text out of the verbose line too: sizes per item, never content', () => {
    const out = sink();

    logPromptAssembly({ mode: 'verbose', sink: out.sink }, CTX, sections);

    const logged = (
      out.lines[0]!.obj.sections as (LoggedSection & { items?: number[] })[]
    ).find((s) => s.name === 'specs');
    expect(logged!.items).toEqual([DOC_ONE.text.length, DOC_TWO.text.length]);
    const serialised = JSON.stringify(out.lines);
    expect(serialised).not.toContain('MARKER');
    expect(serialised).not.toContain(DOC_ONE.text);
    expect(serialised).not.toContain(DOC_TWO.text);
  });

  it('writes no specs section for a prompt without documents', () => {
    const out = sink();
    const bare = assemblePrompt({ system: 'You are a reviewer.', diff: '+x', task: 't' });

    logPromptAssembly({ mode: 'summary', sink: out.sink }, CTX, bare.sections);

    const names = (out.lines[0]!.obj.sections as LoggedSection[]).map((s) => s.name);
    expect(names).not.toContain('specs');
  });
});
