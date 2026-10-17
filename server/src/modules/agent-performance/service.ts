import type { AgentPerf, AgentStats } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { buildPerformance, buildRunsSeries, buildStats, previousRange, seriesBucketMs } from './helpers.js';
import type { AgentPerformanceDeps, PerfRange } from './types.js';

export class AgentPerformanceService {
  constructor(private readonly deps: AgentPerformanceDeps) {}

  async performance(workspaceId: string, range: PerfRange): Promise<AgentPerf> {
    const { store } = this.deps;
    const previous = previousRange(range);
    const bucketMs = seriesBucketMs(range);
    const [agents, runs, decisions, modelCosts, counts, previousRuns, previousDecisions] =
      await Promise.all([
        store.listAgents(workspaceId),
        store.runAggregates(workspaceId, range),
        store.decisionAggregates(workspaceId, range),
        store.costByModel(workspaceId, range),
        store.runsSeries(workspaceId, range, bucketMs),
        store.runAggregates(workspaceId, previous),
        store.decisionAggregates(workspaceId, previous),
      ]);
    return buildPerformance({
      agents,
      current: {
        runs,
        decisions,
        modelCosts,
        series: buildRunsSeries(range, bucketMs, counts),
      },
      previous: { runs: previousRuns, decisions: previousDecisions },
      range,
    });
  }

  async agentStats(workspaceId: string, agentId: string, range: PerfRange): Promise<AgentStats> {
    const { store } = this.deps;
    const agent = await store.getAgent(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const [runs, decisions] = await Promise.all([
      store.runAggregates(workspaceId, range, agentId),
      store.decisionAggregates(workspaceId, range, agentId),
    ]);
    return buildStats(agent, runs[0], decisions[0], range);
  }
}
