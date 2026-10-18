import { describe, it, expect } from 'vitest';
import type { AgentColumn, FindingRecord } from '@devdigest/shared';
import { buildMultiAgentRun, groupFindings } from '../src/modules/multi-agent/helpers.js';
import type { ChildRun, RunHead } from '../src/modules/multi-agent/repository.js';

let seq = 0;
function finding(over: Partial<FindingRecord> & Pick<FindingRecord, 'file' | 'start_line' | 'end_line'>): FindingRecord {
  seq += 1;
  return {
    id: `f${seq}`,
    severity: 'WARNING',
    category: 'bug',
    title: `finding ${seq}`,
    rationale: 'because',
    confidence: 0.5,
    review_id: 'rev',
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

function column(name: string, findings: FindingRecord[], status: AgentColumn['status'] = 'done'): AgentColumn {
  return {
    run_id: `run-${name}`,
    agent_id: `agent-${name}`,
    agent_name: name,
    provider: 'openai',
    model: 'gpt-4.1',
    status,
    error: null,
    verdict: null,
    score: null,
    summary: null,
    duration_ms: null,
    cost_usd: null,
    findings,
  };
}

describe('groupFindings', () => {
  it('AC-32: groups findings that share a file and whose inclusive ranges overlap', () => {
    const a = finding({ file: 'src/a.ts', start_line: 10, end_line: 12 });
    const b = finding({ file: 'src/a.ts', start_line: 12, end_line: 14 });
    const groups = groupFindings([column('A', [a]), column('B', [b])]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ file: 'src/a.ts', start_line: 10, end_line: 14 });
  });

  it('AC-32: ranges that only sit next to each other (end 10, start 11) stay separate groups', () => {
    const a = finding({ file: 'src/a.ts', start_line: 5, end_line: 10 });
    const b = finding({ file: 'src/a.ts', start_line: 11, end_line: 15 });
    const groups = groupFindings([column('A', [a]), column('B', [b])]);

    expect(groups.map((g) => [g.start_line, g.end_line])).toEqual([
      [5, 10],
      [11, 15],
    ]);
  });

  it('AC-32: a chain of three overlaps joins one group even when the ends do not overlap', () => {
    const a = finding({ file: 'src/a.ts', start_line: 1, end_line: 5 });
    const b = finding({ file: 'src/a.ts', start_line: 5, end_line: 9 });
    const c = finding({ file: 'src/a.ts', start_line: 9, end_line: 12 });
    const groups = groupFindings([column('A', [a]), column('B', [b]), column('C', [c])]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ start_line: 1, end_line: 12 });
    expect(groups[0]!.takes.every((t) => t.verdict !== 'ignored')).toBe(true);
  });

  it('AC-32: the same lines in different files are different groups', () => {
    const a = finding({ file: 'src/a.ts', start_line: 3, end_line: 4 });
    const b = finding({ file: 'src/b.ts', start_line: 3, end_line: 4 });
    const groups = groupFindings([column('A', [a]), column('B', [b])]);

    expect(groups.map((g) => g.file)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('AC-32: findings of failed, cancelled and running children never enter a group', () => {
    const done = finding({ file: 'src/a.ts', start_line: 1, end_line: 2 });
    const ghost = finding({ file: 'src/a.ts', start_line: 1, end_line: 2 });
    const groups = groupFindings([
      column('A', [done]),
      column('B', [ghost], 'failed'),
      column('C', [ghost], 'cancelled'),
      column('D', [ghost], 'running'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.takes.map((t) => t.agent_name)).toEqual(['A']);
    expect(groups[0]!.takes.flatMap((t) => t.finding_ids)).toEqual([done.id]);
  });
});

describe('group takes', () => {
  it('AC-33 + EC-5: one take per done child; an agent with two findings in the group is one take with both ids and the worse severity; a silent agent is ignored', () => {
    const warn = finding({ file: 'src/a.ts', start_line: 10, end_line: 12, severity: 'WARNING', title: 'warn' });
    const crit = finding({ file: 'src/a.ts', start_line: 11, end_line: 11, severity: 'CRITICAL', title: 'crit' });
    const other = finding({ file: 'src/a.ts', start_line: 12, end_line: 13, severity: 'SUGGESTION', title: 'nit' });

    const [group] = groupFindings([
      column('A', [warn, crit]),
      column('B', [other]),
      column('C', []),
    ]);

    expect(group!.takes).toHaveLength(3);
    expect(group!.takes[0]).toEqual({
      run_id: 'run-A',
      agent_id: 'agent-A',
      agent_name: 'A',
      finding_ids: [warn.id, crit.id],
      verdict: 'CRITICAL',
      note: 'crit',
    });
    expect(group!.takes[1]).toMatchObject({ agent_name: 'B', finding_ids: [other.id], verdict: 'SUGGESTION' });
    expect(group!.takes[2]).toEqual({
      run_id: 'run-C',
      agent_id: 'agent-C',
      agent_name: 'C',
      finding_ids: [],
      verdict: 'ignored',
      note: '',
    });
  });
});

describe('group title', () => {
  it('AC-34: the title is the finding with the highest severity', () => {
    const low = finding({ file: 'f.ts', start_line: 1, end_line: 1, severity: 'SUGGESTION', title: 'low', confidence: 0.99 });
    const high = finding({ file: 'f.ts', start_line: 1, end_line: 1, severity: 'CRITICAL', title: 'high', confidence: 0.1 });

    expect(groupFindings([column('A', [low]), column('B', [high])])[0]!.title).toBe('high');
  });

  it('AC-34: equal severity falls back to the higher confidence', () => {
    const sure = finding({ file: 'f.ts', start_line: 1, end_line: 1, title: 'sure', confidence: 0.9 });
    const unsure = finding({ file: 'f.ts', start_line: 1, end_line: 1, title: 'unsure', confidence: 0.4 });

    expect(groupFindings([column('A', [unsure]), column('B', [sure])])[0]!.title).toBe('sure');
  });

  it('AC-34: equal severity and confidence falls back to the first column', () => {
    const first = finding({ file: 'f.ts', start_line: 1, end_line: 1, title: 'first' });
    const second = finding({ file: 'f.ts', start_line: 1, end_line: 1, title: 'second' });

    expect(groupFindings([column('A', [first]), column('B', [second])])[0]!.title).toBe('first');
  });

  it('AC-34 + EC-6: a severity outside the contract ranks below SUGGESTION', () => {
    const odd = finding({
      file: 'f.ts',
      start_line: 1,
      end_line: 1,
      severity: 'BLOCKER' as FindingRecord['severity'],
      title: 'odd',
      confidence: 1,
    });
    const nit = finding({ file: 'f.ts', start_line: 1, end_line: 1, severity: 'SUGGESTION', title: 'nit', confidence: 0.1 });

    const [group] = groupFindings([column('A', [odd]), column('B', [nit])]);
    expect(group!.title).toBe('nit');
    expect(group!.takes[0]!.verdict).toBe('BLOCKER');
  });

  it('EC-6: within one take, a stored unknown severity loses to a known one', () => {
    const odd = finding({ file: 'f.ts', start_line: 1, end_line: 2, severity: 'BLOCKER' as FindingRecord['severity'] });
    const nit = finding({ file: 'f.ts', start_line: 2, end_line: 3, severity: 'SUGGESTION' });

    const [group] = groupFindings([column('A', [odd, nit])]);
    expect(group!.takes[0]!.verdict).toBe('SUGGESTION');
  });
});

describe('group conflict', () => {
  it('AC-36: all agents flagged it at the same severity is not a conflict', () => {
    const a = finding({ file: 'f.ts', start_line: 1, end_line: 2, severity: 'WARNING' });
    const b = finding({ file: 'f.ts', start_line: 2, end_line: 3, severity: 'WARNING' });

    expect(groupFindings([column('A', [a]), column('B', [b])])[0]!.conflict).toBe(false);
  });

  it('AC-36: an agent that did not flag the place makes it a conflict', () => {
    const a = finding({ file: 'f.ts', start_line: 1, end_line: 2 });

    expect(groupFindings([column('A', [a]), column('B', [])])[0]!.conflict).toBe(true);
  });

  it('AC-36: flagged takes with different severities are a conflict', () => {
    const a = finding({ file: 'f.ts', start_line: 1, end_line: 2, severity: 'CRITICAL' });
    const b = finding({ file: 'f.ts', start_line: 2, end_line: 3, severity: 'SUGGESTION' });

    expect(groupFindings([column('A', [a]), column('B', [b])])[0]!.conflict).toBe(true);
  });
});

describe('buildMultiAgentRun', () => {
  const head: RunHead = {
    id: 'mar-1',
    prId: 'pr-1',
    ranAt: new Date('2026-10-18T10:00:00.000Z'),
    prNumber: 482,
    prTitle: 'Add rate limiting',
  };

  function child(name: string | null, over: Partial<ChildRun> = {}): ChildRun {
    return {
      runId: `run-${name ?? 'gone'}`,
      agentId: name ? `agent-${name}` : null,
      agentName: name,
      provider: 'openai',
      model: 'gpt-4.1',
      status: 'done',
      error: null,
      durationMs: 1000,
      costUsd: 0.01,
      score: 80,
      ...over,
    };
  }

  it('AC-35: every stored finding stays unchanged in its own child column, grouped or not', () => {
    const shared1 = finding({ file: 'src/a.ts', start_line: 1, end_line: 3 });
    const shared2 = finding({ file: 'src/a.ts', start_line: 2, end_line: 2 });
    const lonely = finding({ file: 'src/z.ts', start_line: 50, end_line: 51 });
    const odd = finding({ file: 'src/a.ts', start_line: 40, end_line: 41, severity: 'BLOCKER' as FindingRecord['severity'] });

    const run = buildMultiAgentRun(
      head,
      [child('B'), child('A')],
      [
        { run_id: 'run-A', verdict: 'comment', summary: 'a says', findings: [shared1, lonely] },
        { run_id: 'run-B', verdict: 'approve', summary: 'b says', findings: [shared2, odd] },
      ],
    );

    const a = run.columns.find((c) => c.agent_name === 'A')!;
    const b = run.columns.find((c) => c.agent_name === 'B')!;
    expect(a.findings).toEqual([shared1, lonely]);
    expect(b.findings).toEqual([shared2, odd]);
    expect(a.summary).toBe('a says');
    expect(run.groups.length).toBeGreaterThan(0);
  });

  it('orders columns by agent name and puts a deleted agent last', () => {
    const run = buildMultiAgentRun(head, [child(null), child('Zed'), child('Alpha')], []);

    expect(run.columns.map((c) => c.agent_name)).toEqual(['Alpha', 'Zed', '']);
    expect(run.columns[2]!.agent_id).toBeNull();
  });

  it('reads findings of a column from its own run only, never a colleague or a missing review', () => {
    const mine = finding({ file: 'src/a.ts', start_line: 1, end_line: 1 });
    const run = buildMultiAgentRun(
      head,
      [child('A'), child('B')],
      [{ run_id: 'run-A', verdict: null, summary: null, findings: [mine] }],
    );

    expect(run.columns.find((c) => c.agent_name === 'B')!.findings).toEqual([]);
  });

  it('totals: longest child duration and summed cost; null cost when no child has one; 0 when no duration', () => {
    const totals = buildMultiAgentRun(
      head,
      [
        child('A', { durationMs: 1000, costUsd: 0.25 }),
        child('B', { durationMs: 4000, costUsd: 0.5 }),
        child('C', { durationMs: null, costUsd: null, status: 'running' }),
      ],
      [],
    );
    expect(totals.agent_count).toBe(3);
    expect(totals.total_duration_ms).toBe(4000);
    expect(totals.total_cost_usd).toBeCloseTo(0.75, 10);

    const none = buildMultiAgentRun(head, [child('A', { durationMs: null, costUsd: null, status: 'running' })], []);
    expect(none.total_duration_ms).toBe(0);
    expect(none.total_cost_usd).toBeNull();
  });

  it('a failed child keeps its error and contributes no group', () => {
    const f = finding({ file: 'src/a.ts', start_line: 1, end_line: 1 });
    const run = buildMultiAgentRun(
      head,
      [child('A'), child('B', { status: 'failed', error: 'provider 500' })],
      [{ run_id: 'run-A', verdict: null, summary: null, findings: [f] }],
    );

    const b = run.columns.find((c) => c.agent_name === 'B')!;
    expect(b.status).toBe('failed');
    expect(b.error).toBe('provider 500');
    expect(run.groups[0]!.takes.map((t) => t.agent_name)).toEqual(['A']);
  });
});
