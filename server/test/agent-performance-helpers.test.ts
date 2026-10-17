import { describe, expect, it } from 'vitest';
import {
  buildPerformance,
  buildRunsSeries,
  buildStats,
  previousRange,
  seriesBucketMs,
  toRowFigures,
  type PerformanceInput,
} from '../src/modules/agent-performance/helpers.js';
import type {
  AgentRef,
  DecisionAggregate,
  ModelCost,
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
  billedUsd: 0,
  estimatedUsd: 0.1,
  unknownUsd: 0,
  avgLatencyMs: 1000,
  lastRunAt: new Date('2026-10-10T00:00:00Z'),
  ...over,
});

const model = (over: Partial<ModelCost> & { model: string | null }): ModelCost => ({
  costUsd: 0.1,
  billedUsd: 0,
  estimatedUsd: 0.1,
  unknownUsd: 0,
  ...over,
});

const build = (
  agents: AgentRef[],
  runs: RunAggregate[],
  decisions: DecisionAggregate[],
  modelCosts: ModelCost[],
  extra: Partial<Pick<PerformanceInput, 'previous' | 'range'>> & { series?: PerformanceInput['current']['series'] } = {},
) =>
  buildPerformance({
    agents,
    current: { runs, decisions, modelCosts, series: extra.series ?? [] },
    previous: extra.previous ?? { runs: [], decisions: [] },
    range: extra.range ?? RANGE,
  });

const split = (p: { billed_usd: number; estimated_usd: number; unknown_usd: number }) =>
  p.billed_usd + p.estimated_usd + p.unknown_usd;

describe('buildPerformance', () => {
  it('keeps every total equal to the sum of its parts, deleted agents and unpriced runs included', () => {
    const runs = [
      run({ agentId: 'a', runs: 3, pricedRuns: 3, totalCostUsd: 0.3 }),
      run({ agentId: 'b', runs: 2, pricedRuns: 1, totalCostUsd: 0.2 }),
      run({ agentId: null, runs: 1, pricedRuns: 1, totalCostUsd: 0.5 }),
      run({ agentId: 'gone', runs: 1, pricedRuns: 1, totalCostUsd: 0.25 }),
    ];
    const perf = build([A, B], runs, [], [
      model({ model: 'm1', costUsd: 0.5, estimatedUsd: 0.5 }),
      model({ model: 'm2', costUsd: 0.5, estimatedUsd: 0.5 }),
      model({ model: null, costUsd: 0.25, estimatedUsd: 0.25 }),
    ]);

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
    const perf = build([A, B], [run({ agentId: 'a' })], decisions, []);
    expect(perf.summary.accepted).toBe(10);
    expect(perf.summary.decisions).toBe(12);
    expect(perf.summary.avg_accept_rate).toBeCloseTo(10 / 12);
  });

  it('breaks a runs tie by the newer last run', () => {
    const runs = [
      run({ agentId: 'a', runs: 2, lastRunAt: new Date('2026-10-05T00:00:00Z') }),
      run({ agentId: 'b', runs: 2, lastRunAt: new Date('2026-10-20T00:00:00Z') }),
    ];
    const perf = build([A, B], runs, [], []);
    expect(perf.summary.most_active_agent_id).toBe('b');
    expect(perf.summary.most_active_runs).toBe(2);
  });

  it('gives null most-active and null total for an empty period', () => {
    const perf = build([A], [], [], []);
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
    const perf = build([A], [run({ agentId: null, runs: 5 })], [], []);
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
    const row = build([A], runs, decisions, []).agents[0]!;
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

  it('carries the cost split of the agent row (AC-65)', () => {
    const runs = [run({ agentId: 'a', billedUsd: 0.04, estimatedUsd: 0.05, unknownUsd: 0.01, totalCostUsd: 0.1 })];
    const row = build([A], runs, [], []).agents[0]!;
    expect(buildStats(A, runs[0], undefined, RANGE).cost_split).toEqual(row.cost_split);
  });
});

describe('cost split', () => {
  it('sums to its figure in every row, segment and in the summary (AC-52)', () => {
    const runs = [
      run({ agentId: 'a', totalCostUsd: 0.3, billedUsd: 0.1, estimatedUsd: 0.2, unknownUsd: 0 }),
      run({ agentId: 'b', totalCostUsd: 0.2, billedUsd: 0, estimatedUsd: 0, unknownUsd: 0.2 }),
      run({ agentId: 'gone', totalCostUsd: 0.1, billedUsd: 0.05, estimatedUsd: 0.05, unknownUsd: 0 }),
      run({ agentId: null, totalCostUsd: 0.1, billedUsd: 0, estimatedUsd: 0.1, unknownUsd: 0 }),
    ];
    const models = [
      model({ model: 'm1', costUsd: 0.4, billedUsd: 0.15, estimatedUsd: 0.25 }),
      model({ model: null, costUsd: 0.3, billedUsd: 0, estimatedUsd: 0.1, unknownUsd: 0.2 }),
    ];
    const p = build([A, B], runs, [], models);

    for (const r of p.agents) expect(split(r.cost_split)).toBeCloseTo(r.total_cost_usd ?? 0, 10);
    for (const s of [...p.cost_by_agent, ...p.cost_by_model]) expect(split(s.cost_split)).toBeCloseTo(s.value, 10);
    expect(split(p.summary.cost_split)).toBeCloseTo(p.summary.total_cost_usd as number, 10);
    expect(p.summary.cost_split.billed_usd).toBeCloseTo(0.15, 10);
    expect(p.summary.cost_split.unknown_usd).toBeCloseTo(0.2, 10);
    const deleted = p.agents.find((r) => r.agent_id === null)!;
    expect(deleted.cost_split.billed_usd).toBeCloseTo(0.05, 10);
    expect(deleted.cost_split.estimated_usd).toBeCloseTo(0.15, 10);
  });

  it('is all zeros for an agent without data', () => {
    expect(build([A], [], [], []).agents[0]!.cost_split).toEqual({
      billed_usd: 0,
      estimated_usd: 0,
      unknown_usd: 0,
    });
  });
});

describe('previous period', () => {
  const PREV: PerfRange = previousRange(RANGE);

  it('is the same length, ending where the selected period starts (AC-56)', () => {
    expect(PREV.to).toEqual(RANGE.from);
    expect(PREV.to.getTime() - PREV.from.getTime()).toBe(RANGE.to.getTime() - RANGE.from.getTime());
  });

  it('equals the summary of a build that treats the previous aggregates as current', () => {
    const prevRuns = [run({ agentId: 'a', runs: 4, totalCostUsd: 0.4 }), run({ agentId: null, runs: 2, totalCostUsd: 0.2 })];
    const asCurrent = build([A], prevRuns, [], []);
    const p = build([A], [run({ agentId: 'a' })], [], [], { previous: { runs: prevRuns, decisions: [] } });
    expect(p.previous).toEqual({
      from: PREV.from.toISOString(),
      to: PREV.to.toISOString(),
      runs: asCurrent.summary.runs,
      total_cost_usd: asCurrent.summary.total_cost_usd,
    });
  });

  it('gives a cost delta, and null when either total is null (AC-59)', () => {
    const delta = build([A], [run({ agentId: 'a', totalCostUsd: 0.5 })], [], [], {
      previous: { runs: [run({ agentId: 'a', totalCostUsd: 0.2 })], decisions: [] },
    });
    expect(delta.summary.cost_delta_usd).toBeCloseTo(0.3, 10);

    const noPrev = build([A], [run({ agentId: 'a', totalCostUsd: 0.5 })], [], []);
    expect(noPrev.summary.cost_delta_usd).toBeNull();
    const noCurrent = build([A], [], [], [], {
      previous: { runs: [run({ agentId: 'a', totalCostUsd: 0.2 })], decisions: [] },
    });
    expect(noCurrent.summary.cost_delta_usd).toBeNull();
  });
});

describe('accept trend (AC-62)', () => {
  const trendOf = (cur: [number, number], prev?: [number, number]) => {
    const p = build(
      [A],
      [run({ agentId: 'a' })],
      [{ agentId: 'a', accepted: cur[0], dismissed: cur[1] }],
      [],
      {
        previous: {
          runs: [],
          decisions: prev ? [{ agentId: 'a', accepted: prev[0], dismissed: prev[1] }] : [],
        },
      },
    );
    return p.agents[0]!.accept_trend;
  };

  it('is up, down or flat by the rate rounded to a whole percent', () => {
    expect(trendOf([8, 2], [5, 5])).toBe('up');
    expect(trendOf([5, 5], [8, 2])).toBe('down');
    expect(trendOf([7, 3], [7, 3])).toBe('flat');
    expect(trendOf([644, 356], [636, 364])).toBe('flat');
  });

  it('is null for a small sample and for no previous rate', () => {
    expect(trendOf([2, 1], [5, 5])).toBeNull();
    expect(trendOf([5, 5], [2, 1])).toBeNull();
    expect(trendOf([8, 2])).toBeNull();
  });

  it('carries the previous rate', () => {
    const p = build([A], [], [{ agentId: 'a', accepted: 8, dismissed: 2 }], [], {
      previous: { runs: [], decisions: [{ agentId: 'a', accepted: 5, dismissed: 5 }] },
    });
    expect(p.agents[0]!.previous_accept_rate).toBeCloseTo(0.5, 10);
  });
});

describe('runs series (AC-57)', () => {
  const series = (from: string, to: string, counts: { bucket: number; runs: number }[] = []) => {
    const range: PerfRange = { from: new Date(from), to: new Date(to) };
    return buildRunsSeries(range, seriesBucketMs(range), counts);
  };

  it('is hourly up to 48 hours, daily beyond', () => {
    expect(series('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z')).toHaveLength(24);
    expect(series('2026-10-01T00:00:00Z', '2026-10-03T00:00:00Z')).toHaveLength(48);
    expect(series('2026-10-01T00:00:00Z', '2026-10-31T00:00:00Z')).toHaveLength(30);
    expect(series('2026-10-01T00:00:00Z', '2026-10-04T00:00:00Z')).toHaveLength(3);
  });

  it('fills missing buckets with 0 and its counts add up to the runs', () => {
    const s = series('2026-10-01T00:00:00Z', '2026-10-04T00:00:00Z', [
      { bucket: 0, runs: 2 },
      { bucket: 2, runs: 5 },
    ]);
    expect(s.map((b) => b.runs)).toEqual([2, 0, 5]);
    expect(s[1]!.start).toBe('2026-10-02T00:00:00.000Z');
  });

  it('gives 3 buckets to a 71 hour range, the last one cut off at the end', () => {
    const s = series('2026-10-25T00:00:00Z', '2026-10-27T23:00:00Z', [{ bucket: 2, runs: 1 }]);
    expect(s).toHaveLength(3);
    expect(s[2]!.runs).toBe(1);
  });

  it('is carried by the response', () => {
    const s = series('2026-10-01T00:00:00Z', '2026-10-04T00:00:00Z', [{ bucket: 1, runs: 3 }]);
    expect(build([A], [], [], [], { series: s }).runs_series).toEqual(s);
  });
});
