import { CLIP, PROGRESS_INTERVAL_MS } from '../constants.js';
import { ApiError, ToolError } from '../errors.js';
import {
  REVIEW_MISSING_HINT,
  toEmptyOutcome,
  toOutcome,
  toRunningOutcome,
  type DoneOutcome,
  type EmptyOutcome,
  type RunningOutcome,
} from '../findings.js';
import type { DevDigestApi, Logger, RunInfo } from '../ports.js';
import { resolveAgent, resolvePull, resolveRepo } from '../resolve.js';
import { clip } from '../text.js';

export interface RunAgentArgs {
  repo: string;
  pr: number;
  agent: string;
}

export interface RunAgentContext {
  signal: AbortSignal;
  budgetMs: number;
  finalReadTimeoutMs: number;
  now: () => number;
  onProgress?: (elapsedMs: number) => void;
  log: Logger;
}

export type RunAgentResult = DoneOutcome | RunningOutcome | EmptyOutcome;

const NOT_STARTED = 'DevDigest did not answer in time; no run was started.';
const START_NOT_CONFIRMED =
  'DevDigest did not confirm the run start in time. A run may exist: call get_findings with repo, pr and agent before starting another.';

function ranOutOfTime(err: unknown, client: AbortSignal): boolean {
  if (!(err instanceof ApiError) || client.aborted) return false;
  return err.kind === 'timeout' || err.kind === 'aborted';
}

function failedText(run: RunInfo): string {
  const cause = clip(run.error ?? '', CLIP.error).replace(/[.\s]+$/, '') || 'no error message was recorded';
  return `Run ${run.runId} failed: ${cause}. A retry is a new paid run; fix the cause first (provider key or model in DevDigest Settings) or pick another agent with list_agents.`;
}

async function resolveTarget(api: DevDigestApi, args: RunAgentArgs, signal: AbortSignal) {
  const agent = resolveAgent(await api.listAgents(signal), args.agent);
  const repo = resolveRepo(await api.listRepos(signal), args.repo);
  const pull = resolvePull(await api.listPulls(repo.id, signal), repo.fullName, args.pr);
  const active = await api.listActiveRuns(pull.id, signal);
  return { agent, repo, pull, active };
}

export async function runAgentOnPr(
  api: DevDigestApi,
  args: RunAgentArgs,
  ctx: RunAgentContext,
): Promise<RunAgentResult> {
  const startedAt = ctx.now();
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(ctx.budgetMs)]);
  const waitedS = (): number => Math.round((ctx.now() - startedAt) / 1000);

  const resolved = await resolveTarget(api, args, signal).catch((err: unknown) => {
    if (ranOutOfTime(err, ctx.signal)) throw new ToolError(NOT_STARTED);
    throw err;
  });
  const { agent, repo, pull, active } = resolved;

  const target = { repo: repo.fullName, pr: pull.number };
  const inFlight = active.find((run) => run.agentId === agent.id);
  const attached = inFlight !== undefined;

  let runId: string;
  if (inFlight) {
    runId = inFlight.runId;
    ctx.log.info('run.attached', { run_id: runId, agent_id: agent.id });
  } else {
    try {
      runId = await api.startReview(pull.id, agent.id, signal);
    } catch (err) {
      if (ranOutOfTime(err, ctx.signal)) {
        ctx.log.warn('run.start_unconfirmed', { agent_id: agent.id, pr_id: pull.id });
        throw new ToolError(START_NOT_CONFIRMED);
      }
      throw err;
    }
    ctx.log.info('run.started', { run_id: runId, agent_id: agent.id });
  }

  const ticker = ctx.onProgress
    ? setInterval(() => ctx.onProgress?.(ctx.now() - startedAt), PROGRESS_INTERVAL_MS)
    : undefined;
  try {
    await api.waitForRun(runId, signal);
  } catch (err) {
    if (ctx.signal.aborted) {
      if (!attached) await cancelQuietly(api, runId, ctx);
      throw err;
    }
    ctx.log.info('run.wait_ended', {
      run_id: runId,
      reason: err instanceof ApiError ? err.kind : 'error',
    });
  } finally {
    clearInterval(ticker);
  }

  const read = (): AbortSignal => AbortSignal.any([ctx.signal, AbortSignal.timeout(ctx.finalReadTimeoutMs)]);
  const stillRunning = (): RunningOutcome => ({
    ...toRunningOutcome({ runId, agentId: agent.id, agentName: agent.name }, { ...target, waitedS: waitedS() }),
    ...(attached ? { attached: true as const } : {}),
  });

  try {
    const run = (await api.listRuns(pull.id, read())).find((candidate) => candidate.runId === runId);
    if (!run || run.status === 'running') return stillRunning();
    if (run.status === 'failed') throw new ToolError(failedText(run));
    if (run.status === 'cancelled') {
      throw new ToolError(
        `Run ${run.runId} was cancelled in DevDigest. Call run_agent_on_pr again only if the user still wants the review.`,
      );
    }

    const review = (await api.listReviews(pull.id, read())).find((candidate) => candidate.runId === runId);
    if (!review) {
      return {
        ...toEmptyOutcome(run, { ...target, status: 'done', next: REVIEW_MISSING_HINT }),
        ...(attached ? { attached: true as const } : {}),
      };
    }
    return {
      ...toOutcome(run, review, { ...target, limit: 10, detailed: false }),
      ...(attached ? { attached: true as const } : {}),
    };
  } catch (err) {
    if (ranOutOfTime(err, ctx.signal)) {
      ctx.log.warn('run.final_read_unconfirmed', { run_id: runId });
      return stillRunning();
    }
    throw err;
  }
}

async function cancelQuietly(api: DevDigestApi, runId: string, ctx: RunAgentContext): Promise<void> {
  try {
    await api.cancelRun(runId, AbortSignal.timeout(ctx.finalReadTimeoutMs));
    ctx.log.info('run.cancelled_with_client', { run_id: runId });
  } catch (err) {
    ctx.log.warn('run.cancel_failed', {
      run_id: runId,
      reason: err instanceof ApiError ? err.kind : 'error',
    });
  }
}
