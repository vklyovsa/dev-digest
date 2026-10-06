import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROGRESS_INTERVAL_MS } from '../constants.js';
import { ApiError, ToolError } from '../errors.js';
import type { DoneOutcome, EmptyOutcome, RunningOutcome } from '../findings.js';
import type { LogFields, Logger, RunInfo } from '../ports.js';
import {
  FakeDevDigestApi,
  fakeAgent,
  fakeFinding,
  fakePull,
  fakeRepo,
  fakeRun,
  type FakeApiOptions,
} from '../testing/fake-api.js';
import { getFindings } from './get-findings.js';
import { runAgentOnPr, type RunAgentArgs, type RunAgentContext } from './run-agent-on-pr.js';

const SECURITY = fakeAgent({ id: 'a-sec', name: 'Security Reviewer' });
const QUALITY = fakeAgent({ id: 'a-q', name: 'Test Quality Reviewer', model: 'm/q', enabled: false });

const args: RunAgentArgs = { repo: 'acme/payments-api', pr: 482, agent: 'a-sec' };

interface LogLine {
  level: 'info' | 'warn' | 'error';
  event: string;
  fields?: LogFields;
}

function recordingLogger(): Logger & { lines: LogLine[] } {
  const lines: LogLine[] = [];
  const at =
    (level: LogLine['level']) =>
    (event: string, fields?: LogFields): void => {
      lines.push({ level, event, fields });
    };
  return { lines, info: at('info'), warn: at('warn'), error: at('error') };
}

function ctxOf(over: Partial<RunAgentContext> = {}): RunAgentContext {
  return {
    signal: new AbortController().signal,
    budgetMs: 5_000,
    finalReadTimeoutMs: 1_000,
    now: Date.now,
    log: recordingLogger(),
    ...over,
  };
}

class ScriptedApi extends FakeDevDigestApi {
  hangListPulls = false;
  startFailure: ApiError | undefined;
  waitError: ApiError | undefined;
  listRunsError: ApiError | undefined;
  cancelSignals: (AbortSignal | undefined)[] = [];

  override async listPulls(repoId: string, signal?: AbortSignal) {
    if (this.hangListPulls && signal) {
      await new Promise<void>((_, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new ApiError('aborted', { method: 'GET', path: '/repos/x/pulls', message: 'aborted' })),
          { once: true },
        );
      });
    }
    return super.listPulls(repoId);
  }

  override async startReview(prId: string, agentId: string) {
    if (this.startFailure) throw this.startFailure;
    return super.startReview(prId, agentId);
  }

  override async waitForRun(runId: string, signal: AbortSignal) {
    if (this.waitError) throw this.waitError;
    return super.waitForRun(runId, signal);
  }

  override async listRuns(prId: string) {
    if (this.listRunsError) throw this.listRunsError;
    return super.listRuns(prId);
  }

  override async cancelRun(runId: string, signal?: AbortSignal) {
    this.cancelSignals.push(signal);
    return super.cancelRun(runId);
  }
}

function world(over: FakeApiOptions = {}): ScriptedApi {
  return new ScriptedApi({
    agents: [SECURITY, QUALITY],
    repos: [fakeRepo()],
    pulls: { 'repo-1': [fakePull()] },
    ...over,
  });
}

const until = async (condition: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !condition(); i += 1) await new Promise((resolve) => setImmediate(resolve));
  if (!condition()) throw new Error('condition not reached');
};

async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ToolError);
    return (err as ToolError).message;
  }
  throw new Error('expected runAgentOnPr to throw');
}

const timeoutError = (path = '/x'): ApiError =>
  new ApiError('timeout', { method: 'GET', path, message: 'no answer within 15000 ms' });

afterEach(() => {
  vi.useRealTimers();
});

describe('runAgentOnPr — a run that finishes in time', () => {
  it('starts the run, waits, and returns the verdict, counts and findings with the run id (AC3)', async () => {
    const api = world({
      startFindings: [
        fakeFinding({ id: 'f-1', severity: 'WARNING', title: 'Weak hash', file: 'src/auth.ts', startLine: 3, endLine: 5 }),
        fakeFinding({ id: 'f-2', severity: 'CRITICAL', title: 'Injection', file: 'src/db.ts' }),
      ],
    });

    const result = (await runAgentOnPr(api, args, ctxOf())) as DoneOutcome;

    expect(result).toMatchObject({
      status: 'done',
      run_id: 'run-started-1',
      repo: 'acme/payments-api',
      pr: 482,
      agent: 'Security Reviewer',
      verdict: 'request_changes',
      score: 80,
      blockers: 1,
      counts: { critical: 1, warning: 1, suggestion: 0 },
      total: 2,
    });
    expect(result.findings.map((f) => [f.severity, f.title, f.lines])).toEqual([
      ['CRITICAL', 'Injection', '1'],
      ['WARNING', 'Weak hash', '3-5'],
    ]);
    expect(result).not.toHaveProperty('attached');
    expect(result).not.toHaveProperty('summary');
    expect(api.callsTo('startReview')).toEqual([{ method: 'startReview', args: ['pr-1', 'a-sec'] }]);
    expect(api.callsTo('waitForRun')).toHaveLength(1);
  });

  it('returns at most 10 findings and points at get_findings for the rest', async () => {
    const startFindings = Array.from({ length: 13 }, (_, i) =>
      fakeFinding({ id: `f-${i}`, title: `Finding ${i}`, startLine: i + 1, endLine: i + 1 }),
    );

    const result = (await runAgentOnPr(world({ startFindings }), args, ctxOf())) as DoneOutcome;

    expect(result.findings).toHaveLength(10);
    expect(result.total).toBe(13);
    expect(result.truncated).toBe(true);
    expect(result.next).toContain('get_findings');
    expect(result.next).toContain('run_id "run-started-1"');
  });

  it('accepts an exact agent name, a different case of the repo, and a disabled agent', async () => {
    const api = world();
    const result = await runAgentOnPr(
      api,
      { repo: 'ACME/payments-api', pr: 482, agent: 'test quality reviewer' },
      ctxOf(),
    );

    expect(result).toMatchObject({ status: 'done', repo: 'acme/payments-api', agent: 'Test Quality Reviewer' });
    expect(api.callsTo('startReview')[0]?.args).toEqual(['pr-1', 'a-q']);
  });

  it('reads the agent, repo, PR and active runs before it starts anything', async () => {
    const api = world();
    await runAgentOnPr(api, args, ctxOf());

    expect(api.calls.map((c) => c.method).slice(0, 5)).toEqual([
      'listAgents',
      'listRepos',
      'listPulls',
      'listActiveRuns',
      'startReview',
    ]);
  });

  it('logs the start without any finding text', async () => {
    const log = recordingLogger();
    await runAgentOnPr(world({ startFindings: [fakeFinding({ title: 'SENSITIVE TITLE' })] }), args, ctxOf({ log }));

    expect(log.lines.map((l) => l.event)).toContain('run.started');
    expect(JSON.stringify(log.lines)).not.toContain('SENSITIVE TITLE');
  });
});

describe('runAgentOnPr — the wait budget (AC4)', () => {
  it('returns status running with the run id when the budget ends, and get_findings later returns the outcome', async () => {
    const api = world({ onStart: 'hang', startFindings: [fakeFinding({ severity: 'CRITICAL' })] });
    const began = Date.now();

    const result = (await runAgentOnPr(api, args, ctxOf({ budgetMs: 50, finalReadTimeoutMs: 50 }))) as RunningOutcome;

    expect(Date.now() - began).toBeLessThan(1_000);
    expect(result).toMatchObject({
      status: 'running',
      run_id: 'run-started-1',
      repo: 'acme/payments-api',
      pr: 482,
      agent: 'Security Reviewer',
    });
    expect(result.waited_s).toBeTypeOf('number');
    expect(result.next).toContain('get_findings');
    expect(result.next).toContain('run_id "run-started-1"');
    expect(result.next).toContain('Do not call run_agent_on_pr again');
    expect(result).not.toHaveProperty('findings');

    api.finishRun('run-started-1', 'done');
    const later = (await getFindings(api, { repo: 'acme/payments-api', pr: 482, runId: result.run_id })) as DoneOutcome;

    expect(later).toMatchObject({ status: 'done', run_id: 'run-started-1', counts: { critical: 1 } });
    expect(api.callsTo('startReview')).toHaveLength(1);
  });

  it('a deadline before the start yields "no run was started" and starts nothing', async () => {
    const api = world();
    api.hangListPulls = true;

    const message = await messageOf(runAgentOnPr(api, args, ctxOf({ budgetMs: 40 })));

    expect(message).toBe('DevDigest did not answer in time; no run was started.');
    expect(api.callsTo('startReview')).toHaveLength(0);
  });

  it('a request timeout before the start reads the same', async () => {
    const api = world();
    const original = api.listAgents.bind(api);
    api.listAgents = async () => {
      await original();
      throw timeoutError('/agents');
    };

    expect(await messageOf(runAgentOnPr(api, args, ctxOf()))).toBe('DevDigest did not answer in time; no run was started.');
    expect(api.callsTo('startReview')).toHaveLength(0);
  });

  it('E16: a start that is not confirmed in time says a run may exist', async () => {
    const api = world();
    api.startFailure = timeoutError('/pulls/pr-1/review');

    const message = await messageOf(runAgentOnPr(api, args, ctxOf()));

    expect(message).toBe(
      'DevDigest did not confirm the run start in time. A run may exist: call get_findings with repo, pr and agent before starting another.',
    );
  });

  it('a start that fails for another reason is not turned into E16', async () => {
    const api = world();
    api.startFailure = new ApiError('http', { method: 'POST', path: '/p', status: 429, message: 'slow down' });

    await expect(runAgentOnPr(api, args, ctxOf())).rejects.toMatchObject({ kind: 'http', status: 429 });
  });
});

describe('runAgentOnPr — runs that did not succeed', () => {
  it('E11: a failed run is an error with the run id and the cause', async () => {
    const api = world({ onStart: 'fail', startError: 'provider key is missing' });

    const message = await messageOf(runAgentOnPr(api, args, ctxOf()));

    expect(message).toBe(
      'Run run-started-1 failed: provider key is missing. A retry is a new paid run; fix the cause first (provider key or model in DevDigest Settings) or pick another agent with list_agents.',
    );
  });

  it('E11: does not double the full stop and clips a long, multi-line cause', async () => {
    const trailing = await messageOf(runAgentOnPr(world({ onStart: 'fail', startError: 'quota exceeded.' }), args, ctxOf()));
    expect(trailing).toContain('failed: quota exceeded. A retry');

    const long = await messageOf(
      runAgentOnPr(world({ onStart: 'fail', startError: `line one\nline two ${'x'.repeat(600)}` }), args, ctxOf()),
    );
    expect(long).toContain('failed: line one line two xxx');
    expect(long.length).toBeLessThan(600);
  });

  it('E11: a failed run with no recorded error still reads as a sentence', async () => {
    const api = world({ onStart: 'fail', startError: '' });
    expect(await messageOf(runAgentOnPr(api, args, ctxOf()))).toContain('failed: no error message was recorded. A retry');
  });

  it('E12: a run cancelled in DevDigest is an error that says when to run again', async () => {
    const api = world({ onStart: 'hang' });
    const pending = runAgentOnPr(api, args, ctxOf());
    await until(() => api.callsTo('waitForRun').length === 1);

    api.finishRun('run-started-1', 'cancelled');

    expect(await messageOf(pending)).toBe(
      'Run run-started-1 was cancelled in DevDigest. Call run_agent_on_pr again only if the user still wants the review.',
    );
  });
});

describe('runAgentOnPr — one run per agent per PR (decision 9)', () => {
  const live = (over: Partial<RunInfo> = {}): RunInfo =>
    fakeRun({ runId: 'run-live', agentId: 'a-sec', agentName: 'Security Reviewer', status: 'running', ...over });

  it('attaches to the agent’s in-flight run instead of starting another', async () => {
    const api = world({ onStart: 'hang', runs: { 'pr-1': [live()] } });
    const pending = runAgentOnPr(api, args, ctxOf());
    await until(() => api.callsTo('waitForRun').length === 1);

    api.finishRun('run-live', 'done', { findings: [fakeFinding({ severity: 'WARNING' })] });
    const result = (await pending) as DoneOutcome;

    expect(result).toMatchObject({ status: 'done', run_id: 'run-live', attached: true, counts: { warning: 1 } });
    expect(api.callsTo('startReview')).toHaveLength(0);
    expect(api.callsTo('waitForRun')[0]?.args).toEqual(['run-live']);
  });

  it('a still-running attached run is flagged attached too', async () => {
    const api = world({ runs: { 'pr-1': [live()] } });
    const result = (await runAgentOnPr(api, args, ctxOf({ budgetMs: 40, finalReadTimeoutMs: 40 }))) as RunningOutcome;

    expect(result).toMatchObject({ status: 'running', run_id: 'run-live', attached: true });
    expect(api.callsTo('startReview')).toHaveLength(0);
  });

  it('another agent’s in-flight run does not stop this agent from starting its own', async () => {
    const other = live({ runId: 'run-other', agentId: 'a-q', agentName: 'Test Quality Reviewer' });
    const api = world({ runs: { 'pr-1': [other] } });

    const result = await runAgentOnPr(api, args, ctxOf());

    expect(result).toMatchObject({ status: 'done', run_id: 'run-started-1' });
    expect(result).not.toHaveProperty('attached');
    expect(api.callsTo('startReview')).toHaveLength(1);
  });

  it('a finished earlier run of the same agent does not count as in flight', async () => {
    const api = world({ runs: { 'pr-1': [live({ status: 'done' })] } });
    await runAgentOnPr(api, args, ctxOf());
    expect(api.callsTo('startReview')).toHaveLength(1);
  });
});

describe('runAgentOnPr — client cancellation (AC13)', () => {
  it('cancels the DevDigest run once, stops the wait, and rethrows', async () => {
    const api = world({ onStart: 'hang' });
    const log = recordingLogger();
    const client = new AbortController();
    const pending = runAgentOnPr(api, args, ctxOf({ signal: client.signal, log }));
    const settled = pending.then(
      () => 'resolved',
      (err: unknown) => err,
    );
    await until(() => api.callsTo('waitForRun').length === 1);

    client.abort();
    const outcome = await settled;

    expect(outcome).toBeInstanceOf(ApiError);
    expect(outcome).toMatchObject({ kind: 'aborted' });
    expect(api.callsTo('cancelRun')).toEqual([{ method: 'cancelRun', args: ['run-started-1'] }]);
    expect((await api.listRuns('pr-1'))[0]?.status).toBe('cancelled');
    expect(log.lines.map((l) => l.event)).toContain('run.cancelled_with_client');
  });

  it('sends the cancel under its own deadline, not the already-aborted client signal', async () => {
    const api = world({ onStart: 'hang' });
    const client = new AbortController();
    const settled = runAgentOnPr(api, args, ctxOf({ signal: client.signal })).catch(() => undefined);
    await until(() => api.callsTo('waitForRun').length === 1);

    client.abort();
    await settled;

    expect(api.cancelSignals).toHaveLength(1);
    expect(api.cancelSignals[0]?.aborted).toBe(false);
  });

  it('a failing cancel is logged and does not hide the abort', async () => {
    const api = world({ onStart: 'hang' });
    api.cancelRun = async () => {
      throw new ApiError('unreachable', { method: 'POST', path: '/runs/x/cancel', message: 'down' });
    };
    const log = recordingLogger();
    const client = new AbortController();
    const settled = runAgentOnPr(api, args, ctxOf({ signal: client.signal, log })).catch((err: unknown) => err);
    await until(() => api.callsTo('waitForRun').length === 1);

    client.abort();

    expect(await settled).toMatchObject({ kind: 'aborted' });
    expect(log.lines.find((l) => l.event === 'run.cancel_failed')).toMatchObject({
      level: 'warn',
      fields: { run_id: 'run-started-1', reason: 'unreachable' },
    });
  });

  it('does not cancel a run it only attached to', async () => {
    const live = fakeRun({ runId: 'run-live', agentId: 'a-sec', agentName: 'Security Reviewer', status: 'running' });
    const api = world({ runs: { 'pr-1': [live] } });
    const client = new AbortController();
    const settled = runAgentOnPr(api, args, ctxOf({ signal: client.signal })).catch((err: unknown) => err);
    await until(() => api.callsTo('waitForRun').length === 1);

    client.abort();

    expect(await settled).toMatchObject({ kind: 'aborted' });
    expect(api.callsTo('cancelRun')).toHaveLength(0);
    expect((await api.listRuns('pr-1'))[0]?.status).toBe('running');
  });

  it('the budget running out is not a cancellation: the run is left running', async () => {
    const api = world({ onStart: 'hang' });
    await runAgentOnPr(api, args, ctxOf({ budgetMs: 40, finalReadTimeoutMs: 40 }));
    expect(api.callsTo('cancelRun')).toHaveLength(0);
    expect((await api.listRuns('pr-1'))[0]?.status).toBe('running');
  });
});

describe('runAgentOnPr — addressing errors (AC8)', () => {
  it('E1: an unknown agent leads to list_agents and starts nothing', async () => {
    const api = world();
    const message = await messageOf(runAgentOnPr(api, { ...args, agent: 'Nobody' }, ctxOf()));

    expect(message).toBe('Agent "Nobody" not found. Call list_agents and pass one of its ids.');
    expect(api.callsTo('startReview')).toHaveLength(0);
  });

  it('E3, E4, E5: a bad repo or PR starts nothing', async () => {
    const api = world();

    expect(await messageOf(runAgentOnPr(api, { ...args, repo: 'acme/other' }, ctxOf()))).toContain('Known repositories:');
    expect(await messageOf(runAgentOnPr(api, { ...args, repo: 'x' }, ctxOf()))).toContain('repo must look like "owner/name"');
    expect(await messageOf(runAgentOnPr(api, { ...args, pr: 9 }, ctxOf()))).toContain('DevDigest knows PRs: #482.');
    expect(api.callsTo('startReview')).toHaveLength(0);
  });

  it('a PR that exists but has no stored id cannot be reviewed', async () => {
    const api = world({ pulls: { 'repo-1': [fakePull({ id: null })] } });
    expect(await messageOf(runAgentOnPr(api, args, ctxOf()))).toContain('PR #482 not found');
    expect(api.callsTo('startReview')).toHaveLength(0);
  });
});

describe('runAgentOnPr — when the wait or the final reads misbehave', () => {
  it('a wait that ends with a stream error falls through to the final reads', async () => {
    const api = world();
    api.waitError = new ApiError('unreachable', { method: 'GET', path: '/runs/r/events', message: 'reset' });
    const log = recordingLogger();

    const result = await runAgentOnPr(api, args, ctxOf({ log }));

    expect(result).toMatchObject({ status: 'done', run_id: 'run-started-1' });
    expect(api.callsTo('cancelRun')).toHaveLength(0);
    expect(log.lines.find((l) => l.event === 'run.wait_ended')?.fields).toMatchObject({ reason: 'unreachable' });
  });

  it('a final read that times out still returns the run id, as running', async () => {
    const api = world();
    api.listRunsError = timeoutError('/pulls/pr-1/runs');

    const result = (await runAgentOnPr(api, args, ctxOf())) as RunningOutcome;

    expect(result).toMatchObject({ status: 'running', run_id: 'run-started-1' });
    expect(result.next).toContain('get_findings');
  });

  it('a final review read that times out also returns the run id, as running', async () => {
    const api = world();
    api.listReviews = async () => {
      throw timeoutError('/pulls/pr-1/reviews');
    };

    expect(await runAgentOnPr(api, args, ctxOf())).toMatchObject({ status: 'running', run_id: 'run-started-1' });
  });

  it('any other API failure in the final reads is not hidden', async () => {
    const api = world();
    api.listRunsError = new ApiError('http', { method: 'GET', path: '/p', status: 500, message: 'boom' });

    await expect(runAgentOnPr(api, args, ctxOf())).rejects.toMatchObject({ kind: 'http', status: 500 });
  });

  it('a run that is missing from the run list is reported as running, not as a failure', async () => {
    const api = world();
    api.listRuns = async () => [];

    expect(await runAgentOnPr(api, args, ctxOf())).toMatchObject({ status: 'running', run_id: 'run-started-1' });
  });

  it('a done run whose review cannot be found returns a null verdict and says why', async () => {
    const api = world();
    api.listReviews = async () => [];

    const result = (await runAgentOnPr(api, args, ctxOf())) as EmptyOutcome;

    expect(result).toMatchObject({ status: 'done', run_id: 'run-started-1', verdict: null, findings: [] });
    expect(result.next).toContain('no longer holds its review');
  });
});

describe('runAgentOnPr — progress', () => {
  it('reports elapsed time every 15 s while waiting, and stops when the run ends', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let clock = 1_000;
    const seen: number[] = [];
    const api = world({ onStart: 'hang' });
    const pending = runAgentOnPr(api, args, ctxOf({ now: () => clock, onProgress: (ms) => seen.push(ms) }));
    await until(() => api.callsTo('waitForRun').length === 1);

    clock += PROGRESS_INTERVAL_MS;
    vi.advanceTimersByTime(PROGRESS_INTERVAL_MS);
    clock += PROGRESS_INTERVAL_MS;
    vi.advanceTimersByTime(PROGRESS_INTERVAL_MS);
    expect(seen).toEqual([15_000, 30_000]);

    api.finishRun('run-started-1', 'done');
    await pending;
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(PROGRESS_INTERVAL_MS * 3);
    expect(seen).toHaveLength(2);
  });

  it('starts no timer when nobody listens for progress', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const api = world({ onStart: 'hang' });
    const pending = runAgentOnPr(api, args, ctxOf());
    await until(() => api.callsTo('waitForRun').length === 1);

    expect(vi.getTimerCount()).toBe(0);
    api.finishRun('run-started-1', 'done');
    await pending;
  });

  it('clears the timer when the wait is cancelled', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const api = world({ onStart: 'hang' });
    const client = new AbortController();
    const settled = runAgentOnPr(api, args, ctxOf({ signal: client.signal, onProgress: () => undefined })).catch(() => undefined);
    await until(() => api.callsTo('waitForRun').length === 1);
    expect(vi.getTimerCount()).toBe(1);

    client.abort();
    await settled;

    expect(vi.getTimerCount()).toBe(0);
  });
});
