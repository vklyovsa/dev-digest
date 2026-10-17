export interface PerfRange {
  from: Date;
  to: Date;
}

export interface AgentRef {
  id: string;
  name: string;
}

/** Counted runs of one agent (null = agent deleted), grouped in SQL. */
export interface RunAggregate {
  agentId: string | null;
  runs: number;
  /** Runs that have a cost. */
  pricedRuns: number;
  /** Runs with status `done`; the weight of `avgLatencyMs`. */
  doneRuns: number;
  totalCostUsd: number | null;
  avgLatencyMs: number | null;
  lastRunAt: Date | null;
}

export interface DecisionAggregate {
  agentId: string | null;
  accepted: number;
  dismissed: number;
}

export interface ModelCost {
  model: string | null;
  costUsd: number;
}

/** Read slice the performance service needs; implemented by the module's repository. */
export interface AgentPerformanceStore {
  listAgents(workspaceId: string): Promise<AgentRef[]>;
  getAgent(workspaceId: string, id: string): Promise<AgentRef | undefined>;
  runAggregates(workspaceId: string, range: PerfRange, agentId?: string): Promise<RunAggregate[]>;
  decisionAggregates(
    workspaceId: string,
    range: PerfRange,
    agentId?: string,
  ): Promise<DecisionAggregate[]>;
  costByModel(workspaceId: string, range: PerfRange): Promise<ModelCost[]>;
}

export interface AgentPerformanceDeps {
  readonly store: AgentPerformanceStore;
}
