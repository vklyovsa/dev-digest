export interface PerfRange {
  from: Date;
  to: Date;
}

export interface AgentRef {
  id: string;
  name: string;
}

/** A cost figure split by source; `unknownUsd` is the cost of runs stored before the parts existed. */
export interface CostParts {
  billedUsd: number;
  estimatedUsd: number;
  unknownUsd: number;
}

/** Counted runs of one agent (null = agent deleted), grouped in SQL. */
export interface RunAggregate extends CostParts {
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

export interface ModelCost extends CostParts {
  model: string | null;
  costUsd: number;
}

export interface SeriesCount {
  bucket: number;
  runs: number;
}

export interface PeriodAggregates {
  runs: RunAggregate[];
  decisions: DecisionAggregate[];
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
  runsSeries(workspaceId: string, range: PerfRange, bucketMs: number): Promise<SeriesCount[]>;
}

export interface AgentPerformanceDeps {
  readonly store: AgentPerformanceStore;
}
