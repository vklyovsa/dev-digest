import { describe, expect, it } from 'vitest';
import { buildPerformance, buildStats, toRowFigures } from '../src/modules/agent-performance/helpers.js';
import type {
  AgentRef,
  DecisionAggregate,
  PerfRange,
  RunAggregate,
} from '../src/modules/agent-performance/types.js';

const RANGE: PerfRange = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-31T00:00:00Z') };
const A: AgentRef = { id: 'a', name: 'Alpha' };
const B: AgentRef = { id: 'b', name: 'Beta' };

const run = (over: Partial<RunAggregate> & { agentId: string | null }): RunAggregate => ({
  runs: 1,
  pricedRuns: 1,
  doneRuns: 1,
  totalCostUsd: 0.1,
  avgLatencyMs: 1000,
  lastRunAt: new Date('2026-10-10T00:00:00Z'),
  ...over,
});

describe('buildPerformance', () => {
  it('keeps every total equal to the sum of its parts, deleted agents and unpriced runs included', () => {
    const runs = [
      run({ agentId: 'a', runs: 3, pricedRuns: 3, totalCostUsd: 0.3 }),
      run({ agentId: 'b', runs: 2, pricedRuns: 1, totalCostUsd: 0.2 }),
      run({ agentId: null, runs: 1, pricedRuns: 1, totalCostUsd: 0.5 }),
      run({ agentId: 'gone', runs: 1, pricedRuns: 1, totalCostUsd: 0.25 }),
    ];
    const perf = buildPerformance([A, B], runs, [], [
      { model: 'm1', costUsd: 0.5 },
      { model: 'm2', costUsd: 0.5 },
      { model: null, costUsd: 0.25 },
    ], RANGE);

    const rowSum = perf.agents.reduce((n, r) => n + (r.total_cost_usd ?? 0), 0);
    const agentSum = perf.cost_by_agent.reduce((n, s) => n + s.value, 0);
    const modelSum = perf.cost_by_model.reduce((n, s) => n + s.value, 0);
    expect(perf.summary.total_cost_usd).toBeCloseTo(rowSum);
    expect(perf.summary.total_cost_usd).toBeCloseTo(agentSum);
    expect(perf.summary.total_cost_usd).toBeCloseTo(modelSum);
    expect(perf.summary.total_cost_usd).toBeCloseTo(1.25);
    expect(perf.summary.runs).toBe(7);
    expect(perf.summary.unpriced_runs).toBe(1);

    const deleted = perf.agents.filter((r) => r.agent_id === null);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.runs).toBe(2);
    expect(perf.agents.at(-1)?.agent_id).toBeNull();
    expect(perf.cost_by_model.some((s) => s.label === null)).toBe(true);
  });

  it('computes the average accept rate over all decisions', () => {
    const decisions: DecisionAggregate[] = [
      { agentId: 'a', accepted: 9, dismissed: 1 },
      { agentId: 'b', accepted: 1, dismissed: 1 },
    ];
    const perf = buildPerformance([A, B], [run({ agentId: 'a' })], decisions, [], RANGE);
    expect(perf.summary.accepted).toBe(10);
    expect(perf.summary.decisions).toBe(12);
    expect(perf.summary.avg_accept_rate).toBeCloseTo(10 / 12);
  });

  it('breaks a runs tie by the newer last run', () => {
    const runs = [
      run({ agentId: 'a', runs: 2, lastRunAt: new Date('2026-10-05T00:00:00Z') }),
      run({ agentId: 'b', runs: 2, lastRunAt: new Date('2026-10-20T00:00:00Z') }),
    ];
    const perf = buildPerformance([A, B], runs, [], [], RANGE);
    expect(perf.summary.most_active_agent_id).toBe('b');
    expect(perf.summary.most_active_runs).toBe(2);
  });

  it('gives null most-active and null total for an empty period', () => {
    const perf = buildPerformance([A], [], [], [], RANGE);
    expect(perf.summary).toMatchObject({
      runs: 0,
      total_cost_usd: null,
      avg_accept_rate: null,
      most_active_agent: null,
      most_active_agent_id: null,
      most_active_runs: 0,
      most_active_accept_rate: null,
    });
    expect(perf.agents).toHaveLength(1);
    expect(perf.cost_by_agent).toEqual([]);
  });

  it('never picks the deleted-agents row as most active', () => {
    const perf = buildPerformance([A], [run({ agentId: null, runs: 5 })], [], [], RANGE);
    expect(perf.summary.runs).toBe(5);
    expect(perf.summary.most_active_agent).toBeNull();
  });
});

describe('toRowFigures', () => {
  it('marks fewer than 10 decisions as a small sample', () => {
    expect(toRowFigures(undefined, { agentId: 'a', accepted: 5, dismissed: 4 }).small_sample).toBe(true);
    expect(toRowFigures(undefined, { agentId: 'a', accepted: 5, dismissed: 5 }).small_sample).toBe(false);
  });

  it('leaves the accept rate null with no decisions', () => {
    const f = toRowFigures(run({ agentId: 'a' }), undefined);
    expect(f.accept_rate).toBeNull();
    expect(f.decisions).toBe(0);
  });

  it('gives runs 0 and null figures to an agent with no run', () => {
    expect(toRowFigures(undefined, undefined)).toMatchObject({
      runs: 0,
      unpriced_runs: 0,
      total_cost_usd: null,
      avg_cost_usd: null,
      avg_latency_ms: null,
      last_run_at: null,
      accept_rate: null,
    });
  });

  it('averages cost over priced runs only', () => {
    const f = toRowFigures(run({ agentId: 'a', runs: 4, pricedRuns: 2, totalCostUsd: 1 }), undefined);
    expect(f.avg_cost_usd).toBeCloseTo(0.5);
    expect(f.unpriced_runs).toBe(2);
  });
});

describe('buildStats', () => {
  it('equals the agent row of the performance response', () => {
    const runs = [run({ agentId: 'a', runs: 3 })];
    const decisions: DecisionAggregate[] = [{ agentId: 'a', accepted: 3, dismissed: 1 }];
    const row = buildPerformance([A], runs, decisions, [], RANGE).agents[0]!;
    const stats = buildStats(A, runs[0], decisions[0], RANGE);
    expect(stats).toMatchObject({
      agent_id: 'a',
      runs: row.runs,
      total_cost_usd: row.total_cost_usd,
      avg_cost_usd: row.avg_cost_usd,
      avg_latency_ms: row.avg_latency_ms,
      accepted: row.accepted,
      dismissed: row.dismissed,
      accept_rate: row.accept_rate,
    });
  });
});
