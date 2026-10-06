import { CLIP, HINT_LIST_MAX } from '../constants.js';
import { ToolError } from '../errors.js';
import {
  REVIEW_MISSING_HINT,
  toEmptyOutcome,
  toOutcome,
  toRunningOutcome,
  type DoneOutcome,
  type EmptyOutcome,
  type RunningOutcome,
  type Severity,
} from '../findings.js';
import type { DevDigestApi, RunInfo } from '../ports.js';
import { resolveAgent, resolvePull, resolveRepo } from '../resolve.js';
import { clip, joinCapped } from '../text.js';

export interface GetFindingsArgs {
  repo: string;
  pr: number;
  runId?: string;
  agent?: string;
  minSeverity?: Severity;
  limit?: number;
  detailed?: boolean;
}

export type GetFindingsResult = DoneOutcome | RunningOutcome | EmptyOutcome;

interface Target {
  repo: string;
  pr: number;
}

function agentsWithRuns(runs: readonly RunInfo[]): string {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const run of runs) {
    const key = run.agentId ?? run.agentName ?? run.runId;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = clip(run.agentName ?? run.agentId ?? 'unknown agent', CLIP.title);
    const status = run.status ?? 'unknown';
    labels.push(run.agentId === null ? `${name} (${status})` : `${name} (${run.agentId}, ${status})`);
  }
  return joinCapped(labels, HINT_LIST_MAX);
}

async function pickRun(
  api: DevDigestApi,
  runs: readonly RunInfo[],
  args: GetFindingsArgs,
  target: Target,
  signal: AbortSignal | undefined,
): Promise<RunInfo> {
  const runId = args.runId?.trim();
  if (runId) {
    const byId = runs.find((run) => run.runId === runId);
    if (byId) return byId;
    throw new ToolError(
      `Run ${clip(runId, CLIP.title)} does not belong to PR #${target.pr} in ${target.repo}. Omit run_id and pass agent to get that agent's latest run.`,
    );
  }

  const wanted = args.agent?.trim();
  if (wanted) {
    const agent = resolveAgent(await api.listAgents(signal), wanted);
    const latest = runs.find((run) => run.agentId === agent.id);
    if (latest) return latest;
    throw new ToolError(
      `${clip(agent.name, CLIP.title)} has no runs on PR #${target.pr} in ${target.repo}. Call run_agent_on_pr to start one.`,
    );
  }

  if (runs.length === 0) {
    throw new ToolError(
      `PR #${target.pr} in ${target.repo} has no review runs yet. Call run_agent_on_pr to start one.`,
    );
  }
  throw new ToolError(
    `Pass run_id (from run_agent_on_pr) or agent (id from list_agents). Agents with runs on PR #${target.pr}: ${agentsWithRuns(runs)}.`,
  );
}

export async function getFindings(
  api: DevDigestApi,
  args: GetFindingsArgs,
  signal?: AbortSignal,
): Promise<GetFindingsResult> {
  const repo = resolveRepo(await api.listRepos(signal), args.repo);
  const pull = resolvePull(await api.listPulls(repo.id, signal), repo.fullName, args.pr);
  const target: Target = { repo: repo.fullName, pr: pull.number };

  const runs = await api.listRuns(pull.id, signal);
  const run = await pickRun(api, runs, args, target, signal);

  switch (run.status) {
    case 'done': {
      const reviews = await api.listReviews(pull.id, signal);
      const review = reviews.find((candidate) => candidate.runId === run.runId);
      if (!review) return toEmptyOutcome(run, { ...target, status: 'done', next: REVIEW_MISSING_HINT });
      return toOutcome(run, review, {
        ...target,
        minSeverity: args.minSeverity,
        limit: args.limit,
        detailed: args.detailed,
      });
    }
    case 'failed':
    case 'cancelled':
      return toEmptyOutcome(run, { ...target, status: run.status });
    default:
      return toRunningOutcome(run, target);
  }
}
