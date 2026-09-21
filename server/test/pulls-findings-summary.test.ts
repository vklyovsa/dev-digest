/**
 * summarizeFindings / scoreForFindings — the group-by and the derived score
 * behind the PR list's FINDINGS and SCORE columns. Hermetic (no DB): the rules
 * worth pinning are that an absent severity stays absent, an unknown one sorts
 * last instead of first, the preview cap keeps the worst findings, and the
 * score comes from the engine's penalty table rather than a second copy of it.
 */
import { describe, it, expect } from 'vitest';
import {
  summarizeFindings,
  scoreForFindings,
  PREVIEW_LIMIT,
  type SummarizableFinding,
} from '../src/modules/pulls/findings-summary.js';

function finding(o: Partial<SummarizableFinding> & { severity: string }): SummarizableFinding {
  return {
    id: o.title ?? o.severity,
    severity: o.severity,
    category: 'bug',
    title: o.title ?? `${o.severity} finding`,
    file: 'src/index.ts',
    startLine: 1,
    endLine: 1,
    confidence: 0.9,
    rationale: 'because',
    ...o,
  };
}

describe('summarizeFindings', () => {
  it('counts only the severities present, worst first', () => {
    const summary = summarizeFindings([
      finding({ severity: 'SUGGESTION' }),
      finding({ severity: 'CRITICAL' }),
      finding({ severity: 'SUGGESTION', title: 'second suggestion' }),
    ]);
    expect(summary.total).toBe(3);
    expect(summary.counts).toEqual([
      { severity: 'CRITICAL', count: 1 },
      { severity: 'SUGGESTION', count: 2 },
    ]);
  });

  it('an empty run summarizes to zero without inventing severities', () => {
    expect(summarizeFindings([])).toEqual({ total: 0, counts: [], previews: [] });
  });

  it('an unknown severity is counted but sorts last', () => {
    const summary = summarizeFindings([
      finding({ severity: 'NONSENSE' }),
      finding({ severity: 'WARNING' }),
    ]);
    expect(summary.counts.map((c) => c.severity)).toEqual(['WARNING', 'NONSENSE']);
    expect(summary.previews[0]!.severity).toBe('WARNING');
  });

  it('caps previews at the limit, keeping the worst and most confident', () => {
    const summary = summarizeFindings([
      ...Array.from({ length: 6 }, (_, i) =>
        finding({ severity: 'SUGGESTION', title: `sugg-${i}`, confidence: 0.5 }),
      ),
      finding({ severity: 'WARNING', title: 'warn-low', confidence: 0.6 }),
      finding({ severity: 'WARNING', title: 'warn-high', confidence: 0.95 }),
    ]);
    expect(summary.total).toBe(8);
    expect(summary.previews).toHaveLength(PREVIEW_LIMIT);
    expect(summary.previews.slice(0, 2).map((p) => p.title)).toEqual(['warn-high', 'warn-low']);
  });

  it('a preview carries snake_case line fields, ready for the wire', () => {
    const [preview] = summarizeFindings([
      finding({ severity: 'CRITICAL', startLine: 12, endLine: 18 }),
    ]).previews;
    expect(preview).toMatchObject({ start_line: 12, end_line: 18 });
    expect(preview).not.toHaveProperty('startLine');
  });
});

describe('scoreForFindings', () => {
  it('a PR with nothing open scores 100', () => {
    expect(scoreForFindings([])).toBe(100);
  });

  it('applies the engine penalties: 35 critical, 12 warning, 3 suggestion', () => {
    expect(scoreForFindings([finding({ severity: 'CRITICAL' })])).toBe(65);
    expect(scoreForFindings([finding({ severity: 'WARNING' })])).toBe(88);
    expect(scoreForFindings([finding({ severity: 'SUGGESTION' })])).toBe(97);
  });

  it('penalties accumulate and the floor is 0, never negative', () => {
    expect(
      scoreForFindings([
        finding({ severity: 'CRITICAL', title: 'a' }),
        finding({ severity: 'WARNING', title: 'b' }),
      ]),
    ).toBe(53);
    const manyCriticals = Array.from({ length: 5 }, (_, i) =>
      finding({ severity: 'CRITICAL', title: `c-${i}` }),
    );
    expect(scoreForFindings(manyCriticals)).toBe(0);
  });

  it('an unknown severity costs no points instead of NaN', () => {
    expect(scoreForFindings([finding({ severity: 'NONSENSE' })])).toBe(100);
  });

  it('agrees with the summary it is shown next to', () => {
    const findings = [
      finding({ severity: 'CRITICAL', title: 'a' }),
      finding({ severity: 'SUGGESTION', title: 'b' }),
    ];
    const summary = summarizeFindings(findings);
    expect(summary.counts).toEqual([
      { severity: 'CRITICAL', count: 1 },
      { severity: 'SUGGESTION', count: 1 },
    ]);
    expect(scoreForFindings(findings)).toBe(100 - 35 - 3);
  });
});
