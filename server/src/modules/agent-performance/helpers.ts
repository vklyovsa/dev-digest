import type {
  AgentPerf,
  AgentPerfRow,
  AgentStats,
  CostSplit,
  PerfCostSegment,
} from '@devdigest/shared';
import { DAY_MS, HOUR_MS, MIN_DECISIONS, SERIES_HOURLY_MAX_MS } from './constants.js';
import type {
  AgentRef,
  CostParts,
  DecisionAggregate,
  ModelCost,
  PerfRange,
  PeriodAggregates,
  RunAggregate,
  SeriesCount,
} from './types.js';

type RowFigures = Pick<
  AgentPerfRow,
  | 'runs'
  | 'unpriced_runs'
  | 'total_cost_usd'
  | 'avg_cost_usd'
  | 'cost_split'
  | 'avg_latency_ms'
  | 'last_run_at'
  | 'accepted'
  | 'dismissed'
  | 'decisions'
  | 'accept_rate'
  | 'small_sample'
>;

export function previousRange(range: PerfRange): PerfRange {
  const length = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - length), to: range.from };
}

export function seriesBucketMs(range: PerfRange): number {
  return range.to.getTime() - range.from.getTime() <= SERIES_HOURLY_MAX_MS ? HOUR_MS : DAY_MS;
}

export function buildRunsSeries(
  range: PerfRange,
  bucketMs: number,
  counts: SeriesCount[],
): AgentPerf['runs_series'] {
  const fromMs = range.from.getTime();
  const size = Math.ceil((range.to.getTime() - fromMs) / bucketMs);
  const runs = new Array<number>(size).fill(0);
  for (const c of counts) {
    if (c.bucket >= 0 && c.bucket < size) runs[c.bucket] = (runs[c.bucket] ?? 0) + c.runs;
  }
  return runs.map((n, i) => ({ start: new Date(fromMs + i * bucketMs).toISOString(), runs: n }));
}

export function toCostSplit(parts: CostParts | undefined): CostSplit {
  return {
    billed_usd: parts?.billedUsd ?? 0,
    estimated_usd: parts?.estimatedUsd ?? 0,
    unknown_usd: parts?.unknownUsd ?? 0,
  };
}

function sumSplits(splits: CostSplit[]): CostSplit {
  return splits.reduce<CostSplit>(
    (n, s) => ({
      billed_usd: n.billed_usd + s.billed_usd,
      estimated_usd: n.estimated_usd + s.estimated_usd,
      unknown_usd: n.unknown_usd + s.unknown_usd,
    }),
    { billed_usd: 0, estimated_usd: 0, unknown_usd: 0 },
  );
}

export function toRowFigures(
  run: RunAggregate | undefined,
  dec: DecisionAggregate | undefined,
): RowFigures {
  const runs = run?.runs ?? 0;
  const pricedRuns = run?.pricedRuns ?? 0;
  const totalCost = run?.totalCostUsd ?? null;
  const accepted = dec?.accepted ?? 0;
  const dismissed = dec?.dismissed ?? 0;
  const decisions = accepted + dismissed;
  return {
    runs,
    unpriced_runs: runs - pricedRuns,
    total_cost_usd: totalCost,
    avg_cost_usd: pricedRuns > 0 && totalCost !== null ? totalCost / pricedRuns : null,
    cost_split: toCostSplit(run),
    avg_latency_ms: run?.avgLatencyMs ?? null,
    last_run_at: run?.lastRunAt ? run.lastRunAt.toISOString() : null,
    accepted,
    dismissed,
    decisions,
    accept_rate: decisions > 0 ? accepted / decisions : null,
    small_sample: decisions < MIN_DECISIONS,
  };
}

function mergeRuns(list: RunAggregate[]): RunAggregate | undefined {
  if (list.length === 0) return undefined;
  const first = list[0] as RunAggregate;
  if (list.length === 1) return { ...first, agentId: null };
  let doneRuns = 0;
  let latencySum = 0;
  let totalCost: number | null = null;
  let lastRunAt: Date | null = null;
  let runs = 0;
  let pricedRuns = 0;
  let billedUsd = 0;
  let estimatedUsd = 0;
  let unknownUsd = 0;
  for (const r of list) {
    runs += r.runs;
    pricedRuns += r.pricedRuns;
    doneRuns += r.doneRuns;
    billedUsd += r.billedUsd;
    estimatedUsd += r.estimatedUsd;
    unknownUsd += r.unknownUsd;
    if (r.avgLatencyMs !== null) latencySum += r.avgLatencyMs * r.doneRuns;
    if (r.totalCostUsd !== null) totalCost = (totalCost ?? 0) + r.totalCostUsd;
    if (r.lastRunAt && (!lastRunAt || r.lastRunAt > lastRunAt)) lastRunAt = r.lastRunAt;
  }
  return {
    agentId: null,
    runs,
    pricedRuns,
    doneRuns,
    totalCostUsd: totalCost,
    billedUsd,
    estimatedUsd,
    unknownUsd,
    avgLatencyMs: doneRuns > 0 ? latencySum / doneRuns : null,
    lastRunAt,
  };
}

function mergeDecisions(list: DecisionAggregate[]): DecisionAggregate | undefined {
  if (list.length === 0) return undefined;
  return {
    agentId: null,
    accepted: list.reduce((n, d) => n + d.accepted, 0),
    dismissed: list.reduce((n, d) => n + d.dismissed, 0),
  };
}

const byValueDesc = (a: PerfCostSegment, b: PerfCostSegment) => b.value - a.value;

function buildRows(agents: AgentRef[], period: PeriodAggregates): AgentPerfRow[] {
  const known = new Set(agents.map((a) => a.id));
  const isKnown = (id: string | null): id is string => id !== null && known.has(id);

  const runById = new Map(
    period.runs.filter((r) => isKnown(r.agentId)).map((r) => [r.agentId, r]),
  );
  const decById = new Map(
    period.decisions.filter((d) => isKnown(d.agentId)).map((d) => [d.agentId, d]),
  );
  const orphanRuns = mergeRuns(period.runs.filter((r) => !isKnown(r.agentId)));
  const orphanDecisions = mergeDecisions(period.decisions.filter((d) => !isKnown(d.agentId)));

  const rows: AgentPerfRow[] = [...agents]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((agent) => ({
      agent_id: agent.id,
      agent_name: agent.name,
      previous_accept_rate: null,
      accept_trend: null,
      ...toRowFigures(runById.get(agent.id), decById.get(agent.id)),
    }));
  if (orphanRuns || orphanDecisions) {
    rows.push({
      agent_id: null,
      agent_name: null,
      previous_accept_rate: null,
      accept_trend: null,
      ...toRowFigures(orphanRuns, orphanDecisions),
    });
  }
  return rows;
}

function totalCostOf(rows: AgentPerfRow[]): number | null {
  const priced = rows.filter((r) => r.total_cost_usd !== null);
  return priced.length > 0 ? priced.reduce((n, r) => n + (r.total_cost_usd ?? 0), 0) : null;
}

function trendOf(current: AgentPerfRow, previous: AgentPerfRow | undefined): AgentPerfRow['accept_trend'] {
  if (!previous) return null;
  if (current.accept_rate === null || previous.accept_rate === null) return null;
  if (current.small_sample || previous.small_sample) return null;
  const now = Math.round(current.accept_rate * 100);
  const before = Math.round(previous.accept_rate * 100);
  if (now > before) return 'up';
  if (now < before) return 'down';
  return 'flat';
}

export interface PerformanceInput {
  agents: AgentRef[];
  current: PeriodAggregates & { modelCosts: ModelCost[]; series: AgentPerf['runs_series'] };
  previous: PeriodAggregates;
  range: PerfRange;
}

export function buildPerformance({ agents, current, previous, range }: PerformanceInput): AgentPerf {
  const previousPeriod = previousRange(range);
  const previousRows = buildRows(agents, previous);
  const previousById = new Map(previousRows.map((r) => [r.agent_id, r]));
  const rows = buildRows(agents, current).map((row) => {
    const before = previousById.get(row.agent_id);
    return {
      ...row,
      previous_accept_rate: before?.accept_rate ?? null,
      accept_trend: trendOf(row, before),
    };
  });

  const cost_by_agent = rows
    .filter((r) => (r.total_cost_usd ?? 0) > 0)
    .map((r) => ({
      label: r.agent_name,
      agent_id: r.agent_id,
      value: r.total_cost_usd as number,
      cost_split: r.cost_split,
    }))
    .sort(byValueDesc);
  const cost_by_model = current.modelCosts
    .filter((m) => m.costUsd > 0)
    .map((m) => ({ label: m.model, value: m.costUsd, cost_split: toCostSplit(m) }))
    .sort(byValueDesc);

  const totalRuns = rows.reduce((n, r) => n + r.runs, 0);
  const accepted = rows.reduce((n, r) => n + r.accepted, 0);
  const decisionCount = rows.reduce((n, r) => n + r.decisions, 0);
  const totalCost = totalCostOf(rows);
  const previousCost = totalCostOf(previousRows);

  const active = rows
    .filter((r) => r.agent_id !== null && r.runs > 0)
    .sort(
      (a, b) =>
        b.runs - a.runs ||
        (b.last_run_at ?? '').localeCompare(a.last_run_at ?? '') ||
        (a.agent_name ?? '').localeCompare(b.agent_name ?? ''),
    )[0];

  return {
    period: { from: range.from.toISOString(), to: range.to.toISOString() },
    min_decisions: MIN_DECISIONS,
    summary: {
      runs: totalRuns,
      total_cost_usd: totalCost,
      cost_split: sumSplits(rows.map((r) => r.cost_split)),
      cost_delta_usd: totalCost !== null && previousCost !== null ? totalCost - previousCost : null,
      unpriced_runs: rows.reduce((n, r) => n + r.unpriced_runs, 0),
      accepted,
      decisions: decisionCount,
      avg_accept_rate: decisionCount > 0 ? accepted / decisionCount : null,
      most_active_agent: active?.agent_name ?? null,
      most_active_agent_id: active?.agent_id ?? null,
      most_active_runs: active?.runs ?? 0,
      most_active_accept_rate: active?.accept_rate ?? null,
    },
    agents: rows,
    cost_by_agent,
    cost_by_model,
    runs_series: current.series,
    previous: {
      from: previousPeriod.from.toISOString(),
      to: previousPeriod.to.toISOString(),
      runs: previousRows.reduce((n, r) => n + r.runs, 0),
      total_cost_usd: previousCost,
    },
  };
}

export function buildStats(
  agent: AgentRef,
  run: RunAggregate | undefined,
  dec: DecisionAggregate | undefined,
  range: PerfRange,
): AgentStats {
  const { last_run_at: _lastRunAt, small_sample: _small, ...figures } = toRowFigures(run, dec);
  return {
    agent_id: agent.id,
    agent_name: agent.name,
    period: { from: range.from.toISOString(), to: range.to.toISOString() },
    ...figures,
  };
}
