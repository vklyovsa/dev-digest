import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors.js';
import {
  FakeDevDigestApi,
  fakeAgent,
  fakeBlast,
  fakeFinding,
  fakePull,
  fakeRepo,
  fakeReview,
  fakeRun,
} from './fake-api.js';

const never = (): AbortSignal => new AbortController().signal;

describe('FakeDevDigestApi', () => {
  it('serves scripted data and logs every call without the signal', async () => {
    const api = new FakeDevDigestApi({
      agents: [fakeAgent()],
      repos: [fakeRepo()],
      pulls: { 'repo-1': [fakePull()] },
      runs: { 'pr-1': [fakeRun()] },
      reviews: { 'pr-1': [fakeReview()] },
    });

    expect(await api.listAgents()).toHaveLength(1);
    expect(await api.listRepos()).toHaveLength(1);
    expect(await api.listPulls('repo-1')).toHaveLength(1);
    expect(await api.listRuns('pr-1')).toHaveLength(1);
    expect(await api.listReviews('pr-1')).toHaveLength(1);
    expect(await api.listPulls('other')).toEqual([]);
    expect(await api.getConventions('repo-1')).toEqual({ scannedAt: null, conventions: [] });

    expect(api.calls.map((c) => c.method)).toEqual([
      'listAgents',
      'listRepos',
      'listPulls',
      'listRuns',
      'listReviews',
      'listPulls',
      'getConventions',
    ]);
    expect(api.callsTo('listPulls').map((c) => c.args)).toEqual([['repo-1'], ['other']]);
  });

  it('serves the scripted blast map, switching to the after-detail one once the PR was loaded', async () => {
    const before = fakeBlast({ changedFiles: 0, symbols: [] });
    const after = fakeBlast();
    const api = new FakeDevDigestApi({
      blast: { 'pr-1': before, 'pr-2': after },
      blastAfterDetail: { 'pr-1': after },
    });

    expect(await api.getBlastRadius('pr-1')).toBe(before);
    await api.loadPullDetail('pr-1');
    expect(await api.getBlastRadius('pr-1')).toBe(after);
    expect(await api.getBlastRadius('pr-2')).toBe(after);
    await api.loadPullDetail('pr-2');
    expect(await api.getBlastRadius('pr-2')).toBe(after);

    expect(api.callsTo('loadPullDetail').map((c) => c.args)).toEqual([['pr-1'], ['pr-2']]);
    expect(api.callsTo('getBlastRadius')).toHaveLength(4);
  });

  it('answers an unscripted PR with an empty map that has no stored files', async () => {
    const api = new FakeDevDigestApi();

    expect(await api.getBlastRadius('nobody')).toMatchObject({ changedFiles: 0, symbols: [], degraded: true });
  });

  it('completes a started run at once by default, newest run first', async () => {
    const api = new FakeDevDigestApi({
      agents: [fakeAgent()],
      runs: { 'pr-1': [fakeRun({ runId: 'old' })] },
      startFindings: [fakeFinding({ severity: 'CRITICAL' })],
    });

    const runId = await api.startReview('pr-1', 'agent-1');

    const runs = await api.listRuns('pr-1');
    expect(runs.map((r) => r.runId)).toEqual([runId, 'old']);
    expect(runs[0]).toMatchObject({ status: 'done', agentName: 'Security Reviewer', blockers: 1 });
    const reviews = await api.listReviews('pr-1');
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ runId, verdict: 'request_changes' });
    expect(await api.listActiveRuns('pr-1')).toEqual([]);
    await expect(api.waitForRun(runId, never())).resolves.toBeUndefined();
  });

  it('fails a started run on request', async () => {
    const api = new FakeDevDigestApi({ agents: [fakeAgent()], onStart: 'fail', startError: 'bad key' });

    const runId = await api.startReview('pr-1', 'agent-1');

    expect((await api.listRuns('pr-1'))[0]).toMatchObject({ runId, status: 'failed', error: 'bad key' });
    expect(await api.listReviews('pr-1')).toEqual([]);
  });

  it('keeps a hanging run running until it is finished, then wakes the waiter', async () => {
    const api = new FakeDevDigestApi({ agents: [fakeAgent()], onStart: 'hang' });
    const runId = await api.startReview('pr-1', 'agent-1');
    expect(await api.listActiveRuns('pr-1')).toEqual([
      expect.objectContaining({ runId, agentId: 'agent-1', agentName: 'Security Reviewer' }),
    ]);

    let settled = false;
    const waiting = api.waitForRun(runId, never()).then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);

    api.finishRun(runId, 'done', { findings: [fakeFinding()] });
    await waiting;

    expect(settled).toBe(true);
    expect((await api.listRuns('pr-1'))[0]?.status).toBe('done');
    expect(await api.listReviews('pr-1')).toHaveLength(1);
  });

  it('rejects a waiting caller with an aborted ApiError when its signal fires', async () => {
    const api = new FakeDevDigestApi({ agents: [fakeAgent()], onStart: 'hang' });
    const runId = await api.startReview('pr-1', 'agent-1');
    const controller = new AbortController();

    const pending = expect(api.waitForRun(runId, controller.signal)).rejects.toMatchObject({ kind: 'aborted' });
    controller.abort();
    await pending;

    const early = new AbortController();
    early.abort();
    const err = await api.waitForRun(runId, early.signal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((await api.listRuns('pr-1'))[0]?.status).toBe('running');
  });

  it('cancels a running run and wakes its waiter, and ignores a finished one', async () => {
    const api = new FakeDevDigestApi({ agents: [fakeAgent()], onStart: 'hang' });
    const runId = await api.startReview('pr-1', 'agent-1');
    const waiting = api.waitForRun(runId, never());

    await api.cancelRun(runId);
    await waiting;

    expect((await api.listRuns('pr-1'))[0]).toMatchObject({ status: 'cancelled', error: null });
    await api.cancelRun(runId);
    expect(api.callsTo('cancelRun')).toHaveLength(2);
    expect((await api.listRuns('pr-1'))[0]?.status).toBe('cancelled');
  });

  it('refuses to finish an unknown run', () => {
    expect(() => new FakeDevDigestApi().finishRun('nope', 'done')).toThrow(/unknown run/);
  });
});
