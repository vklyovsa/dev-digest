import { describe, expect, it } from 'vitest';
import { ToolError } from '../errors.js';
import type { DoneOutcome, EmptyOutcome, RunningOutcome } from '../findings.js';
import {
  FakeDevDigestApi,
  fakeAgent,
  fakeFinding,
  fakePull,
  fakeRepo,
  fakeReview,
  fakeRun,
  type FakeApiOptions,
} from '../testing/fake-api.js';
import { getFindings, type GetFindingsArgs } from './get-findings.js';

const SECURITY = fakeAgent({ id: 'a-sec', name: 'Security Reviewer' });
const QUALITY = fakeAgent({ id: 'a-q', name: 'Test Quality Reviewer', model: 'm/q' });

function world(over: FakeApiOptions = {}): FakeDevDigestApi {
  return new FakeDevDigestApi({
    agents: [SECURITY, QUALITY],
    repos: [fakeRepo()],
    pulls: { 'repo-1': [fakePull()] },
    ...over,
  });
}

const base: GetFindingsArgs = { repo: 'acme/payments-api', pr: 482 };

async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ToolError);
    return (err as ToolError).message;
  }
  throw new Error('expected getFindings to throw');
}

const securityRuns = {
  newest: fakeRun({ runId: 'run-new', agentId: 'a-sec', agentName: 'Security Reviewer', score: 55, blockers: 1 }),
  oldest: fakeRun({ runId: 'run-old', agentId: 'a-sec', agentName: 'Security Reviewer', score: 90, blockers: 0 }),
  quality: fakeRun({ runId: 'run-q', agentId: 'a-q', agentName: 'Test Quality Reviewer' }),
};

const reviews = {
  new: fakeReview({
    id: 'rv-new',
    runId: 'run-new',
    verdict: 'request_changes',
    findings: [
      fakeFinding({ id: 'f-1', severity: 'WARNING', title: 'Weak hash', file: 'src/auth.ts', startLine: 10, endLine: 12 }),
      fakeFinding({ id: 'f-2', severity: 'CRITICAL', title: 'SQL built from input', file: 'src/db.ts', startLine: 4, endLine: 4 }),
    ],
  }),
  old: fakeReview({
    id: 'rv-old',
    runId: 'run-old',
    verdict: 'approve',
    findings: [fakeFinding({ id: 'f-old', severity: 'SUGGESTION', title: 'Rename variable' })],
  }),
};

function withRuns(): FakeDevDigestApi {
  return world({
    runs: { 'pr-1': [securityRuns.newest, securityRuns.quality, securityRuns.oldest] },
    reviews: { 'pr-1': [reviews.old, reviews.new] },
  });
}

describe('getFindings by run_id', () => {
  it('returns the verdict, computed counts and findings of exactly that run', async () => {
    const result = (await getFindings(withRuns(), { ...base, runId: 'run-old' })) as DoneOutcome;

    expect(result).toMatchObject({
      status: 'done',
      run_id: 'run-old',
      repo: 'acme/payments-api',
      pr: 482,
      agent: 'Security Reviewer',
      verdict: 'approve',
      score: 90,
      blockers: 0,
      counts: { critical: 0, warning: 0, suggestion: 1 },
      total: 1,
    });
    expect(result.findings).toEqual([
      { severity: 'SUGGESTION', title: 'Rename variable', file: 'src/a.ts', lines: '1', category: 'bug' },
    ]);
    expect(result.truncated).toBeUndefined();
  });

  it('lists findings worst first with a line range', async () => {
    const result = (await getFindings(withRuns(), { ...base, runId: 'run-new' })) as DoneOutcome;

    expect(result.counts).toEqual({ critical: 1, warning: 1, suggestion: 0 });
    expect(result.findings.map((f) => [f.severity, f.lines])).toEqual([
      ['CRITICAL', '4'],
      ['WARNING', '10-12'],
    ]);
  });

  it('wins over agent when both are given', async () => {
    const result = await getFindings(withRuns(), { ...base, runId: 'run-old', agent: 'a-q' });
    expect(result.run_id).toBe('run-old');
  });

  it('does not read the agent list when a run_id is given', async () => {
    const api = withRuns();
    await getFindings(api, { ...base, runId: 'run-old' });
    expect(api.callsTo('listAgents')).toHaveLength(0);
  });

  it('E6: a run of another PR is refused with the way forward', async () => {
    const message = await messageOf(getFindings(withRuns(), { ...base, runId: 'run-elsewhere' }));
    expect(message).toBe(
      "Run run-elsewhere does not belong to PR #482 in acme/payments-api. Omit run_id and pass agent to get that agent's latest run.",
    );
  });
});

describe('getFindings by agent', () => {
  it("returns the agent's newest run, not another agent's and not an older one", async () => {
    const result = await getFindings(withRuns(), { ...base, agent: 'a-sec' });
    expect(result.run_id).toBe('run-new');
  });

  it('accepts an exact agent name', async () => {
    const result = await getFindings(withRuns(), { ...base, agent: 'security reviewer' });
    expect(result.run_id).toBe('run-new');
  });

  it('takes the newest run of any status, so a failed latest run is not skipped', async () => {
    const failed = fakeRun({ runId: 'run-bad', agentId: 'a-sec', status: 'failed', error: 'boom' });
    const api = world({ runs: { 'pr-1': [failed, securityRuns.oldest] }, reviews: { 'pr-1': [reviews.old] } });

    const result = await getFindings(api, { ...base, agent: 'a-sec' });

    expect(result.run_id).toBe('run-bad');
    expect(result.status).toBe('failed');
  });

  it('E8: an agent without runs on the PR is pointed to run_agent_on_pr', async () => {
    const api = world({ runs: { 'pr-1': [securityRuns.newest] }, reviews: { 'pr-1': [reviews.new] } });
    const message = await messageOf(getFindings(api, { ...base, agent: 'a-q' }));
    expect(message).toBe('Test Quality Reviewer has no runs on PR #482 in acme/payments-api. Call run_agent_on_pr to start one.');
  });

  it('E1: an unknown agent is pointed to list_agents', async () => {
    const message = await messageOf(getFindings(withRuns(), { ...base, agent: 'Nobody' }));
    expect(message).toContain('list_agents');
  });
});

describe('getFindings without run_id and agent', () => {
  it('E7: names the agents that have runs, with id and status', async () => {
    const message = await messageOf(getFindings(withRuns(), base));
    expect(message).toBe(
      'Pass run_id (from run_agent_on_pr) or agent (id from list_agents). Agents with runs on PR #482: Security Reviewer (a-sec, done), Test Quality Reviewer (a-q, done).',
    );
  });

  it('E7: lists each agent once, with its newest status', async () => {
    const running = fakeRun({ runId: 'run-live', agentId: 'a-sec', status: 'running' });
    const api = world({ runs: { 'pr-1': [running, securityRuns.oldest] } });
    const message = await messageOf(getFindings(api, base));
    expect(message).toContain('Security Reviewer (a-sec, running).');
    expect(message.match(/Security Reviewer/g)).toHaveLength(1);
  });

  it('E7: a PR with no runs says so and points to run_agent_on_pr', async () => {
    const message = await messageOf(getFindings(world(), base));
    expect(message).toBe('PR #482 in acme/payments-api has no review runs yet. Call run_agent_on_pr to start one.');
  });

  it('E7: caps the agent list at 10', async () => {
    const runs = Array.from({ length: 13 }, (_, i) =>
      fakeRun({ runId: `r-${i}`, agentId: `a-${i}`, agentName: `Agent ${i}` }),
    );
    const message = await messageOf(getFindings(world({ runs: { 'pr-1': runs } }), base));
    expect(message).toContain('Agent 9 (a-9, done), +3 more.');
    expect(message).not.toContain('Agent 10');
  });

  it('treats blank run_id and agent as absent', async () => {
    const message = await messageOf(getFindings(withRuns(), { ...base, runId: '  ', agent: '' }));
    expect(message).toContain('Pass run_id');
  });
});

describe('getFindings by run status', () => {
  it('a running run is reported as running, not as an error, and its review is not read', async () => {
    const live = fakeRun({ runId: 'run-live', agentId: 'a-sec', agentName: 'Security Reviewer', status: 'running' });
    const api = world({ runs: { 'pr-1': [live] } });

    const result = (await getFindings(api, { ...base, runId: 'run-live' })) as RunningOutcome;

    expect(result.status).toBe('running');
    expect(result).toMatchObject({ run_id: 'run-live', repo: 'acme/payments-api', pr: 482, agent: 'Security Reviewer' });
    expect(result.next).toContain('get_findings');
    expect(result.next).toContain('run-live');
    expect(result.next).toContain('Do not call run_agent_on_pr again');
    expect(result).not.toHaveProperty('findings');
    expect(api.callsTo('listReviews')).toHaveLength(0);
  });

  it('a failed run carries its error, a null verdict and no findings', async () => {
    const failed = fakeRun({ runId: 'run-bad', agentId: 'a-sec', status: 'failed', error: 'provider\n  said no' });
    const api = world({ runs: { 'pr-1': [failed] } });

    const result = (await getFindings(api, { ...base, runId: 'run-bad' })) as EmptyOutcome;

    expect(result).toEqual({
      status: 'failed',
      run_id: 'run-bad',
      repo: 'acme/payments-api',
      pr: 482,
      agent: 'Security Reviewer',
      error: 'provider said no',
      verdict: null,
      counts: {},
      total: 0,
      findings: [],
    });
    expect(api.callsTo('listReviews')).toHaveLength(0);
  });

  it('a cancelled run is reported with its status', async () => {
    const cancelled = fakeRun({ runId: 'run-x', agentId: 'a-sec', status: 'cancelled' });
    const result = (await getFindings(world({ runs: { 'pr-1': [cancelled] } }), { ...base, runId: 'run-x' })) as EmptyOutcome;

    expect(result).toMatchObject({ status: 'cancelled', verdict: null, error: null, findings: [] });
  });

  it('a done run whose review is gone returns a null verdict and says why', async () => {
    const api = world({ runs: { 'pr-1': [securityRuns.oldest] }, reviews: { 'pr-1': [reviews.new] } });

    const result = (await getFindings(api, { ...base, runId: 'run-old' })) as EmptyOutcome;

    expect(result).toMatchObject({ status: 'done', run_id: 'run-old', verdict: null, findings: [], counts: {}, total: 0 });
    expect(result.next).toContain('no longer holds its review');
  });

  it('a run with an unknown status is treated as still running', async () => {
    const odd = fakeRun({ runId: 'run-odd', status: null });
    const result = await getFindings(world({ runs: { 'pr-1': [odd] } }), { ...base, runId: 'run-odd' });
    expect(result.status).toBe('running');
  });
});

describe('getFindings volume controls', () => {
  const many = Array.from({ length: 14 }, (_, i) =>
    fakeFinding({
      id: `f-${String(i).padStart(2, '0')}`,
      severity: i < 2 ? 'CRITICAL' : i < 8 ? 'WARNING' : 'SUGGESTION',
      title: `Finding ${i}`,
      startLine: i + 1,
      endLine: i + 1,
      confidence: 0.9,
    }),
  );
  const api = (): FakeDevDigestApi =>
    world({
      runs: { 'pr-1': [securityRuns.newest] },
      reviews: { 'pr-1': [fakeReview({ runId: 'run-new', findings: many })] },
    });

  it('shows 10 findings by default and says how to get more', async () => {
    const result = (await getFindings(api(), { ...base, runId: 'run-new' })) as DoneOutcome;

    expect(result.findings).toHaveLength(10);
    expect(result.total).toBe(14);
    expect(result.truncated).toBe(true);
    expect(result.next).toContain('Showing 10 of 14');
    expect(result.next).toContain('run_id "run-new"');
  });

  it('honours limit', async () => {
    const result = (await getFindings(api(), { ...base, runId: 'run-new', limit: 3 })) as DoneOutcome;
    expect(result.findings.map((f) => f.title)).toEqual(['Finding 0', 'Finding 1', 'Finding 2']);
    expect(result.truncated).toBe(true);
  });

  it('honours min_severity and reports how many matched', async () => {
    const result = (await getFindings(api(), { ...base, runId: 'run-new', minSeverity: 'WARNING' })) as DoneOutcome;

    expect(result.matched).toBe(8);
    expect(result.findings).toHaveLength(8);
    expect(result.findings.every((f) => f.severity !== 'SUGGESTION')).toBe(true);
    expect(result.counts).toEqual({ critical: 2, warning: 6, suggestion: 6 });
    expect(result.truncated).toBeUndefined();
  });

  it('detailed adds the rationale, the fix and the run facts', async () => {
    const result = (await getFindings(api(), {
      ...base,
      runId: 'run-new',
      detailed: true,
      limit: 50,
    })) as DoneOutcome;

    expect(result.findings).toHaveLength(14);
    expect(result.findings[0]).toEqual({
      severity: 'CRITICAL',
      title: 'Finding 0',
      file: 'src/a.ts',
      lines: '1',
      category: 'bug',
      id: 'f-00',
      confidence: 0.9,
      rationale: 'Because of the way it is written.',
      suggestion: null,
    });
    expect(result).toMatchObject({
      summary: 'A scripted review.',
      model: 'fake/model',
      ran_at: '2026-10-03T12:00:00.000Z',
      duration_s: 18,
      cost_usd: 0.004,
    });
  });

  it('excludes dismissed findings from counts and reports them', async () => {
    const dismissed = fakeFinding({ id: 'f-d', severity: 'CRITICAL', dismissed: true });
    const live = world({
      runs: { 'pr-1': [securityRuns.newest] },
      reviews: { 'pr-1': [fakeReview({ runId: 'run-new', findings: [dismissed, fakeFinding({ id: 'f-k' })] })] },
    });

    const result = (await getFindings(live, { ...base, runId: 'run-new' })) as DoneOutcome;

    expect(result.counts).toEqual({ critical: 0, warning: 1, suggestion: 0 });
    expect(result.dismissed).toBe(1);
    expect(result.findings).toHaveLength(1);
  });

  it('buckets an unknown severity as other and lists it last', async () => {
    const odd = world({
      runs: { 'pr-1': [securityRuns.newest] },
      reviews: {
        'pr-1': [
          fakeReview({
            runId: 'run-new',
            findings: [fakeFinding({ id: 'f-1', severity: 'MAJOR' }), fakeFinding({ id: 'f-2', severity: 'SUGGESTION' })],
          }),
        ],
      },
    });

    const result = (await getFindings(odd, { ...base, runId: 'run-new' })) as DoneOutcome;

    expect(result.counts).toEqual({ critical: 0, warning: 0, suggestion: 1, other: 1 });
    expect(result.findings.map((f) => f.severity)).toEqual(['SUGGESTION', 'MAJOR']);
  });
});

describe('getFindings addressing', () => {
  it('passes the repo and PR errors of the resolvers through', async () => {
    expect(await messageOf(getFindings(withRuns(), { ...base, repo: 'nonsense', runId: 'x' }))).toContain(
      'repo must look like "owner/name"',
    );
    expect(await messageOf(getFindings(withRuns(), { ...base, repo: 'acme/other', runId: 'x' }))).toContain(
      'Known repositories: acme/payments-api',
    );
    expect(await messageOf(getFindings(withRuns(), { ...base, pr: 7, runId: 'x' }))).toContain(
      'DevDigest knows PRs: #482.',
    );
  });

  it('answers with the canonical repo name even when the caller used another case', async () => {
    const result = await getFindings(withRuns(), { ...base, repo: 'ACME/Payments-API', runId: 'run-old' });
    expect(result.repo).toBe('acme/payments-api');
  });

  it('never reaches a mutating port method', async () => {
    const api = withRuns();
    await getFindings(api, { ...base, agent: 'a-sec' });
    await getFindings(api, { ...base, runId: 'run-old', detailed: true }).catch(() => undefined);

    const methods = new Set(api.calls.map((c) => c.method));
    expect(methods.has('startReview')).toBe(false);
    expect(methods.has('cancelRun')).toBe(false);
    expect(methods.has('waitForRun')).toBe(false);
  });
});
