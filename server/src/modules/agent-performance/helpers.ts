import type { AgentPerf, AgentPerfRow, AgentStats, PerfCostSegment } from '@devdigest/shared';
import { COST_BASIS, MIN_DECISIONS } from './constants.js';
import type {
  AgentRef,
  DecisionAggregate,
  ModelCost,
  PerfRange,
  RunAggregate,
} from './types.js';

type RowFigures = Pick<
  AgentPerfRow,
  | 'runs'
  | 'unpriced_runs'
  | 'total_cost_usd'
  | 'avg_cost_usd'
  | 'avg_latency_ms'
  | 'last_run_at'
  | 'accepted'
  | 'dismissed'
  | 'decisions'
  | 'accept_rate'
  | 'small_sample'
>;

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
  for (const r of list) {
    runs += r.runs;
    pricedRuns += r.pricedRuns;
    doneRuns += r.doneRuns;
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

export function buildPerformance(
  agents: AgentRef[],
  runs: RunAggregate[],
  decisions: DecisionAggregate[],
  modelCosts: ModelCost[],
  range: PerfRange,
): AgentPerf {
  const known = new Set(agents.map((a) => a.id));
  const isKnown = (id: string | null): id is string => id !== null && known.has(id);

  const runById = new Map(runs.filter((r) => isKnown(r.agentId)).map((r) => [r.agentId, r]));
  const decById = new Map(decisions.filter((d) => isKnown(d.agentId)).map((d) => [d.agentId, d]));
  const orphanRuns = mergeRuns(runs.filter((r) => !isKnown(r.agentId)));
  const orphanDecisions = mergeDecisions(decisions.filter((d) => !isKnown(d.agentId)));

  const rows: AgentPerfRow[] = [...agents]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((agent) => ({
      agent_id: agent.id,
      agent_name: agent.name,
      ...toRowFigures(runById.get(agent.id), decById.get(agent.id)),
    }));
  if (orphanRuns || orphanDecisions) {
    rows.push({
      agent_id: null,
      agent_name: null,
      ...toRowFigures(orphanRuns, orphanDecisions),
    });
  }

  const cost_by_agent = rows
    .filter((r) => (r.total_cost_usd ?? 0) > 0)
    .map((r) => ({ label: r.agent_name, agent_id: r.agent_id, value: r.total_cost_usd as number }))
    .sort(byValueDesc);
  const cost_by_model = modelCosts
    .filter((m) => m.costUsd > 0)
    .map((m) => ({ label: m.model, value: m.costUsd }))
    .sort(byValueDesc);

  const totalRuns = rows.reduce((n, r) => n + r.runs, 0);
  const accepted = rows.reduce((n, r) => n + r.accepted, 0);
  const decisionCount = rows.reduce((n, r) => n + r.decisions, 0);
  const priced = rows.filter((r) => r.total_cost_usd !== null);

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
    cost_basis: COST_BASIS,
    min_decisions: MIN_DECISIONS,
    summary: {
      runs: totalRuns,
      total_cost_usd: priced.length > 0 ? priced.reduce((n, r) => n + (r.total_cost_usd ?? 0), 0) : null,
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
