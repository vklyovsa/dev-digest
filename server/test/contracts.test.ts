import { describe, it, expect } from 'vitest';
import {
  Review,
  Finding,
  Intent,
  BlastRadius,
  Risks,
  PrHistory,
  SmartDiff,
  Conformance,
  Onboarding,
  EvalRun,
  MemoryItem,
  RunTrace,
  Settings,
  Repo,
  PrDetail,
  SpecFile,
  ContextDocumentList,
  ContextAttachmentsInput,
  PrBrief,
  PrBriefAnswer,
  PrBriefRecord,
} from '@devdigest/shared';

/**
 * Contract tests — parse/round-trip the fixtures from data.jsx/data2.jsx
 * so feature agents can rely on the schemas matching the prototype data.
 */
describe('AI contracts parse fixtures', () => {
  it('Review + Finding (data.jsx VERDICT/FINDINGS)', () => {
    const review = Review.parse({
      verdict: 'request_changes',
      summary: 'Two blockers before merge.',
      score: 61,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
          suggestion: 'Move to env and rotate.',
          confidence: 0.98,
          kind: 'secret_leak',
        },
      ],
    });
    expect(review.findings).toHaveLength(1);
    expect(review.score).toBe(61);
  });

  it('lethal-trifecta Finding variant', () => {
    const f = Finding.parse({
      id: 'f2',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta',
      file: 'src/api/public/webhooks.ts',
      start_line: 61,
      end_line: 74,
      rationale: 'all three legs present',
      confidence: 0.79,
      kind: 'lethal_trifecta',
      trifecta_components: ['private_data_access', 'untrusted_input', 'exfil_path'],
      evidence: [{ component: 'untrusted_input', file: 'src/api/public/webhooks.ts', line: 61 }],
    });
    expect(f.trifecta_components).toContain('exfil_path');
  });

  it('Intent / BlastRadius / Risks / PrHistory', () => {
    expect(() =>
      Intent.parse({ intent: 'x', in_scope: ['a'], out_of_scope: ['b'] }),
    ).not.toThrow();
    expect(() =>
      BlastRadius.parse({
        changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'rateLimit',
            callers: [{ name: 'publicRouter', file: 'b.ts', line: 23 }],
            endpoints_affected: ['GET /x'],
            crons_affected: ['c'],
          },
        ],
        summary: 's',
      }),
    ).not.toThrow();
    expect(() =>
      Risks.parse({
        risks: [{ kind: 'security', title: 't', explanation: 'e', severity: 'high', file_refs: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      PrHistory.parse({
        history: [
          {
            pr_number: 401,
            title: 't',
            merged_at: '2026-03-18',
            author: 'a',
            files_overlap: [],
            notes: 'n',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('SmartDiff (data.jsx DIFF)', () => {
    const d = SmartDiff.parse({
      groups: [
        {
          role: 'core',
          files: [{ path: 'a.ts', additions: 84, deletions: 0, finding_lines: [28, 52] }],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
    });
    expect(d.groups[0]!.role).toBe('core');
    expect(() =>
      SmartDiff.parse({
        groups: [
          { role: 'tests', files: [{ path: 'a.test.ts', additions: 1, deletions: 0, finding_lines: [] }] },
          { role: 'docs', files: [{ path: 'README.md', additions: 2, deletions: 1, finding_lines: [] }] },
        ],
        split_suggestion: { too_big: false, total_lines: 4, proposed_splits: [] },
      }),
    ).not.toThrow();
  });

  it('Conformance / Onboarding / EvalRun / MemoryItem', () => {
    expect(() =>
      Conformance.parse({
        spec_id: 's1',
        spec_title: 'Spec',
        items: [{ requirement: 'r', status: 'implemented' }],
        completeness_pct: 80,
      }),
    ).not.toThrow();
    expect(() =>
      Onboarding.parse({
        sections: [{ kind: 'architecture', title: 'T', body: 'b', links: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      EvalRun.parse({
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        duration_ms: 12000,
        cost_usd: 0.23,
        per_trace: [{ name: 't01', pass: true, expected: 'x', actual: 'x' }],
      }),
    ).not.toThrow();
    expect(() =>
      MemoryItem.parse({
        content: 'c',
        scope: 'team',
        kind: 'decision',
        confidence: 0.92,
        sources: [{ pr: 401, context: 'ctx' }],
      }),
    ).not.toThrow();
  });

  it('RunTrace (data2.jsx TRACE single-document)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', version: 'v7', model: 'gpt-4.1', pr: 482, source: 'local' },
      stats: { duration_ms: 8200, tokens_in: 14820, tokens_out: 1240, findings: 3, grounding: '3/3 passed' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [{ tool: 'read_file', args: "'src/config.ts'", meta: '1,240 bytes', ms: 120 }],
      raw_output: '{}',
      memory_pulled: [{ pr: 288, text: 'verified via stripe-signature' }],
      specs_read: ['specs/security-baseline.md'],
      log: [{ t: '00.00', kind: 'info', msg: 'started' }],
    });
    expect(trace.tool_calls).toHaveLength(1);
  });

  it('RunTrace parses with and without specs_docs', () => {
    const base = {
      config: { agent: 'Security Reviewer', model: 'gpt-4.1' },
      stats: { duration_ms: 1, tokens_in: 1, tokens_out: 1, findings: 0, grounding: '0/0' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [],
      raw_output: '{}',
      memory_pulled: [],
      specs_read: ['docs/a.md', 'docs/b.md'],
      log: [],
    };
    expect(RunTrace.parse(base).specs_docs).toBeUndefined();
    const withDocs = RunTrace.parse({
      ...base,
      specs_docs: [
        { path: 'docs/a.md', tokens: 12, source: 'agent', skill_name: null },
        { path: 'docs/b.md', tokens: 7, source: 'skill', skill_name: 'Auth rules' },
        { path: 'docs/c.md', tokens: 0 },
      ],
    });
    expect(withDocs.specs_docs).toHaveLength(3);
    expect(withDocs.specs_docs![1]!.skill_name).toBe('Auth rules');
  });
});

describe('project context contracts', () => {
  it('ContextAttachmentsInput rejects unsafe or repeated paths and accepts a plain one', () => {
    for (const bad of ['', '/abs.md', 'a/../b.md', '../b.md', 'a\\b.md', 'a\0.md']) {
      expect(ContextAttachmentsInput.safeParse({ paths: [bad] }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(ContextAttachmentsInput.safeParse({ paths: ['docs/a.md', 'docs/a.md'] }).success).toBe(false);
    expect(ContextAttachmentsInput.safeParse({ paths: ['docs/a.md'] }).success).toBe(true);
    expect(ContextAttachmentsInput.safeParse({ paths: [] }).success).toBe(true);
  });

  it('SpecFile list entry parses without content and defaults agent_count', () => {
    const entry = SpecFile.parse({ path: 'docs/a.md', type: 'docs', tokens: 12 });
    expect(entry.content).toBeUndefined();
    expect(entry.agent_count).toBe(0);
    expect(
      ContextDocumentList.parse({ roots: ['docs'], documents: [{ path: 'docs/a.md', type: 'docs', tokens: 3 }] })
        .documents,
    ).toHaveLength(1);
  });
});

describe('PR brief contracts', () => {
  const answer = {
    summary: 'Adds a rate limiter to the public router.',
    risks: [
      {
        kind: 'security',
        title: 'Limiter bypass',
        explanation: 'The limiter skips authenticated callers.',
        severity: 'high',
        file_refs: ['src/limiter.ts'],
      },
    ],
    review_focus: [{ file: 'src/limiter.ts', line: 12, reason: 'The skip condition lives here.' }],
  };

  it('PrBriefAnswer accepts a full sample and rejects a missing or empty summary and a line of 0', () => {
    expect(PrBriefAnswer.safeParse(answer).success).toBe(true);

    const { summary: _summary, ...withoutSummary } = answer;
    expect(PrBriefAnswer.safeParse(withoutSummary).success).toBe(false);
    expect(PrBriefAnswer.safeParse({ ...answer, summary: '' }).success).toBe(false);
    expect(
      PrBriefAnswer.safeParse({
        ...answer,
        review_focus: [{ file: 'src/limiter.ts', line: 0, reason: 'r' }],
      }).success,
    ).toBe(false);
  });

  it('PrBriefAnswer rejects a blank summary and trims a padded one', () => {
    expect(PrBriefAnswer.safeParse({ ...answer, summary: '   ' }).success).toBe(false);
    expect(PrBriefAnswer.parse({ ...answer, summary: ' ok ' }).summary).toBe('ok');
  });

  it('PrBrief accepts intent: null, blast: null and no history; PrBriefRecord takes cost_usd: null and needs head_sha', () => {
    const brief = {
      summary: answer.summary,
      review_focus: answer.review_focus,
      risks: { risks: answer.risks },
      intent: null,
      blast: null,
    };
    const parsed = PrBrief.parse(brief);
    expect(parsed.intent).toBeNull();
    expect(parsed.blast).toBeNull();
    expect(parsed.history).toBeUndefined();

    const record = {
      ...brief,
      pr_id: 'p1',
      head_sha: 'abc123',
      stale: false,
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      tokens_in: 1200,
      tokens_out: 340,
      cost_usd: null,
      documents_read: [],
    };
    expect(PrBriefRecord.safeParse(record).success).toBe(true);

    const { head_sha: _headSha, ...withoutHeadSha } = record;
    expect(PrBriefRecord.safeParse(withoutHeadSha).success).toBe(false);
  });
});

describe('platform DTOs', () => {
  it('Settings defaults + passthrough', () => {
    const s = Settings.parse({ extra_key: 'x' });
    expect(s.theme).toBe('dark');
    expect((s as Record<string, unknown>).extra_key).toBe('x');
  });

  it('Repo + PrDetail', () => {
    expect(() =>
      Repo.parse({
        id: 'r1',
        workspace_id: 'w1',
        owner: 'acme',
        name: 'payments-api',
        full_name: 'acme/payments-api',
        default_branch: 'main',
        clone_path: null,
        last_polled_at: null,
        created_by: null,
      }),
    ).not.toThrow();
    expect(() =>
      PrDetail.parse({
        number: 482,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        head_sha: 'sha',
        additions: 1,
        deletions: 0,
        files_count: 1,
        status: 'open',
        files: [],
        commits: [],
      }),
    ).not.toThrow();
  });
});
