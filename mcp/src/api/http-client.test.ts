import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors.js';
import { HttpDevDigestApi } from './http-client.js';

const BASE = 'http://127.0.0.1:3001';

const ID = {
  agent: '11111111-1111-4111-8111-111111111111',
  repo: '22222222-2222-4222-8222-222222222222',
  pr: '33333333-3333-4333-8333-333333333333',
  run: '44444444-4444-4444-8444-444444444444',
  review: '55555555-5555-4555-8555-555555555555',
  finding: '66666666-6666-4666-8666-666666666666',
  convention: '77777777-7777-4777-8777-777777777777',
} as const;

interface Recorded {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | undefined;
  hasSignal: boolean;
}

type Handler = (req: Recorded, signal: AbortSignal | undefined) => Response | Promise<Response>;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function rejectionOf(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected the call to reject');
}

function fakeFetch(routes: Record<string, Handler>): { fetchImpl: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const req: Recorded = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === 'string' ? init.body : undefined,
      hasSignal: init?.signal instanceof AbortSignal,
    };
    calls.push(req);
    const handler = routes[`${req.method} ${req.path}`];
    return handler ? handler(req, init?.signal ?? undefined) : json({ error: { code: 'not_found', message: 'no route' } }, 404);
  };
  return { fetchImpl, calls };
}

function apiFor(routes: Record<string, Handler>, requestTimeoutMs?: number) {
  const { fetchImpl, calls } = fakeFetch(routes);
  return { api: new HttpDevDigestApi(BASE, fetchImpl, requestTimeoutMs), calls };
}

function hangUntilAborted(): typeof fetch {
  return (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
}

function controlledStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: () =>
      new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
    fail: (err: Error) => controller.error(err),
    wasCancelled: () => cancelled,
  };
}

const wireAgent = {
  id: ID.agent,
  name: 'Security Reviewer',
  description: 'Finds vulnerabilities',
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
  system_prompt: 'TOP SECRET SYSTEM PROMPT',
  output_schema: { type: 'object' },
  enabled: true,
  version: 3,
  skill_count: 2,
};

const wireFinding = {
  id: ID.finding,
  review_id: ID.review,
  severity: 'CRITICAL',
  category: 'security',
  title: 'SQL injection',
  file: 'src/db.ts',
  start_line: 42,
  end_line: 47,
  rationale: 'User input reaches the query.',
  suggestion: 'Use a parameterized query.',
  confidence: 0.9,
  kind: 'finding',
  accepted_at: null,
  dismissed_at: null,
};

const wireReview = {
  id: ID.review,
  pr_id: ID.pr,
  agent_id: ID.agent,
  run_id: ID.run,
  agent_name: 'Security Reviewer',
  kind: 'review',
  verdict: 'request_changes',
  summary: 'One critical issue.',
  score: 70,
  model: 'deepseek/deepseek-v4-flash',
  created_at: '2026-10-03T10:00:00.000Z',
  findings: [wireFinding],
};

const wireRun = {
  run_id: ID.run,
  agent_id: ID.agent,
  agent_name: 'Security Reviewer',
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
  status: 'done',
  error: null,
  duration_ms: 18000,
  tokens_in: 100,
  tokens_out: 50,
  cost_usd: 0.0042,
  findings_count: 1,
  grounding: null,
  ran_at: '2026-10-03T10:00:00.000Z',
  score: 70,
  blockers: 1,
};

const wireConvention = {
  id: ID.convention,
  repo_id: ID.repo,
  rule: 'Use kebab-case file names.',
  rationale: 'All 40 modules follow it.',
  category: 'naming',
  status: 'accepted',
  confidence: 0.8,
  evidence_path: 'server/src/app.ts',
  evidence_line_start: 12,
  evidence_line_end: 18,
  evidence_snippet: 'const x = 1;',
  created_at: '2026-10-03T09:00:00.000Z',
  updated_at: '2026-10-03T09:00:00.000Z',
};

const allRoutes: Record<string, Handler> = {
  'GET /agents': () => json([wireAgent]),
  'GET /repos': () => json([{ id: ID.repo, full_name: 'acme/payments-api', owner: 'acme' }]),
  [`GET /repos/${ID.repo}/pulls`]: () => json([{ id: ID.pr, number: 482, title: 'Add rate limiting' }]),
  [`GET /pulls/${ID.pr}/runs/active`]: () => json([]),
  [`POST /pulls/${ID.pr}/review`]: () =>
    json({
      pr_id: ID.pr,
      runs: [{ run_id: ID.run, agent_id: ID.agent, agent_name: 'Security Reviewer' }],
      reviews: [],
    }),
  [`GET /runs/${ID.run}/events`]: () => new Response('event: done\ndata: {}\n\n', { status: 200 }),
  [`GET /pulls/${ID.pr}/runs`]: () => json([wireRun]),
  [`GET /pulls/${ID.pr}/reviews`]: () => json([wireReview]),
  [`POST /runs/${ID.run}/cancel`]: () => json({ ok: true }),
  [`GET /repos/${ID.repo}/conventions`]: () =>
    json({ scan: { started_at: 'a', finished_at: 'b' }, candidates: [wireConvention] }),
};

describe('HttpDevDigestApi: wire to domain mapping', () => {
  it('maps agents and never carries the prompt or schema', async () => {
    const { api } = apiFor(allRoutes);

    const agents = await api.listAgents();

    expect(agents).toEqual([
      {
        id: ID.agent,
        name: 'Security Reviewer',
        description: 'Finds vulnerabilities',
        model: 'deepseek/deepseek-v4-flash',
        enabled: true,
      },
    ]);
    expect(JSON.stringify(agents)).not.toContain('TOP SECRET');
  });

  it('maps repos, pulls and active runs', async () => {
    const { api } = apiFor({
      ...allRoutes,
      [`GET /pulls/${ID.pr}/runs/active`]: () =>
        json([{ run_id: ID.run, agent_id: ID.agent, agent_name: 'Security Reviewer', ran_at: 'now' }]),
    });

    expect(await api.listRepos()).toEqual([{ id: ID.repo, fullName: 'acme/payments-api' }]);
    expect(await api.listPulls(ID.repo)).toEqual([{ id: ID.pr, number: 482, title: 'Add rate limiting' }]);
    expect(await api.listActiveRuns(ID.pr)).toEqual([
      { runId: ID.run, agentId: ID.agent, agentName: 'Security Reviewer', ranAt: 'now' },
    ]);
  });

  it('keeps a pull request without an id as null', async () => {
    const { api } = apiFor({
      [`GET /repos/${ID.repo}/pulls`]: () => json([{ number: 7, title: 'Draft' }]),
    });

    expect(await api.listPulls(ID.repo)).toEqual([{ id: null, number: 7, title: 'Draft' }]);
  });

  it('maps run summaries', async () => {
    const { api } = apiFor(allRoutes);

    expect(await api.listRuns(ID.pr)).toEqual([
      {
        runId: ID.run,
        agentId: ID.agent,
        agentName: 'Security Reviewer',
        status: 'done',
        error: null,
        model: 'deepseek/deepseek-v4-flash',
        ranAt: '2026-10-03T10:00:00.000Z',
        durationMs: 18000,
        costUsd: 0.0042,
        score: 70,
        blockers: 1,
      },
    ]);
  });

  it('maps reviews with findings, including dismissal', async () => {
    const dismissed = { ...wireFinding, id: ID.agent, dismissed_at: '2026-10-03T11:00:00.000Z', suggestion: null };
    const { api } = apiFor({
      ...allRoutes,
      [`GET /pulls/${ID.pr}/reviews`]: () =>
        json([{ ...wireReview, findings: [wireFinding, dismissed] }]),
    });

    const [review] = await api.listReviews(ID.pr);

    expect(review).toMatchObject({
      id: ID.review,
      runId: ID.run,
      verdict: 'request_changes',
      summary: 'One critical issue.',
      score: 70,
      createdAt: '2026-10-03T10:00:00.000Z',
    });
    expect(review?.findings).toEqual([
      {
        id: ID.finding,
        severity: 'CRITICAL',
        category: 'security',
        title: 'SQL injection',
        file: 'src/db.ts',
        startLine: 42,
        endLine: 47,
        rationale: 'User input reaches the query.',
        suggestion: 'Use a parameterized query.',
        confidence: 0.9,
        dismissed: false,
      },
      expect.objectContaining({ id: ID.agent, suggestion: null, dismissed: true }),
    ]);
  });

  it('parses a severity the contract enum does not know', async () => {
    const { api } = apiFor({
      ...allRoutes,
      [`GET /pulls/${ID.pr}/reviews`]: () =>
        json([{ ...wireReview, findings: [{ ...wireFinding, severity: 'MAJOR' }, { ...wireFinding, severity: '' }] }]),
    });

    const [review] = await api.listReviews(ID.pr);

    expect(review?.findings.map((f) => f.severity)).toEqual(['MAJOR', '']);
  });

  it('maps conventions with the scan time', async () => {
    const { api } = apiFor(allRoutes);

    expect(await api.getConventions(ID.repo)).toEqual({
      scannedAt: 'b',
      conventions: [
        {
          id: ID.convention,
          category: 'naming',
          rule: 'Use kebab-case file names.',
          rationale: 'All 40 modules follow it.',
          status: 'accepted',
          confidence: 0.8,
          evidencePath: 'server/src/app.ts',
          evidenceLineStart: 12,
          evidenceLineEnd: 18,
        },
      ],
    });
  });

  it('falls back to the scan start, and to null without a scan', async () => {
    const running = apiFor({
      [`GET /repos/${ID.repo}/conventions`]: () =>
        json({ scan: { started_at: 'started', finished_at: null }, candidates: [] }),
    });
    const never = apiFor({
      [`GET /repos/${ID.repo}/conventions`]: () => json({ scan: null, candidates: [] }),
    });

    expect((await running.api.getConventions(ID.repo)).scannedAt).toBe('started');
    expect(await never.api.getConventions(ID.repo)).toEqual({ scannedAt: null, conventions: [] });
  });

  it('returns the id of the started run', async () => {
    const { api } = apiFor(allRoutes);

    expect(await api.startReview(ID.pr, ID.agent)).toBe(ID.run);
  });

  it('rejects a start response that lists no run', async () => {
    const { api } = apiFor({
      [`POST /pulls/${ID.pr}/review`]: () => json({ pr_id: ID.pr, runs: [], reviews: [] }),
    });

    await expect(api.startReview(ID.pr, ID.agent)).rejects.toMatchObject({
      kind: 'shape',
      message: 'response lists no started run',
    });
  });
});

describe('HttpDevDigestApi: request shape', () => {
  it('sends startReview as JSON and cancelRun with no body and no content-type', async () => {
    const { api, calls } = apiFor(allRoutes);

    await api.startReview(ID.pr, ID.agent);
    await api.cancelRun(ID.run);

    const [start, cancel] = calls;
    expect(start?.method).toBe('POST');
    expect(start?.headers['content-type']).toBe('application/json');
    expect(JSON.parse(start?.body ?? '')).toEqual({ agentId: ID.agent });
    expect(cancel?.method).toBe('POST');
    expect(cancel?.body).toBeUndefined();
    expect(cancel?.headers['content-type']).toBeUndefined();
  });

  it('encodes ids into the path and tolerates a trailing slash on the base URL', async () => {
    const { fetchImpl, calls } = fakeFetch({
      'GET /repos/a%2Fb%20c/pulls': () => json([]),
      'GET /agents': () => json([]),
    });
    const api = new HttpDevDigestApi(`${BASE}/`, fetchImpl);

    await api.listPulls('a/b c');
    await api.listAgents();

    expect(calls.map((c) => c.path)).toEqual(['/repos/a%2Fb%20c/pulls', '/agents']);
  });

  it('exposes exactly two mutating endpoints, sends no credentials and always arms a signal', async () => {
    const { api, calls } = apiFor(allRoutes);

    await api.listAgents();
    await api.listRepos();
    await api.listPulls(ID.repo);
    await api.listActiveRuns(ID.pr);
    await api.startReview(ID.pr, ID.agent);
    await api.waitForRun(ID.run, new AbortController().signal);
    await api.listRuns(ID.pr);
    await api.listReviews(ID.pr);
    await api.cancelRun(ID.run);
    await api.getConventions(ID.repo);

    expect(calls).toHaveLength(10);
    const normalized = (c: Recorded) =>
      `${c.method} ${c.path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ':id')}`;
    const mutating = calls.filter((c) => c.method !== 'GET').map(normalized).sort();
    expect(mutating).toEqual(['POST /pulls/:id/review', 'POST /runs/:id/cancel']);
    for (const call of calls) {
      expect(Object.keys(call.headers)).not.toContain('authorization');
      expect(Object.keys(call.headers)).not.toContain('cookie');
      expect(call.hasSignal).toBe(true);
    }
  });
});

describe('HttpDevDigestApi: ApiError kinds', () => {
  it('maps a failed connection to unreachable', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.reject(new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:1') }));
    const api = new HttpDevDigestApi(BASE, fetchImpl);

    const err = await rejectionOf(api.listAgents());

    expect(err).toMatchObject({ kind: 'unreachable', method: 'GET', path: '/agents' });
    expect(err.message).toContain('ECONNREFUSED');
  });

  it('maps an unanswered request to timeout', async () => {
    const api = new HttpDevDigestApi(BASE, hangUntilAborted(), 20);

    await expect(api.listRepos()).rejects.toMatchObject({ kind: 'timeout', path: '/repos' });
  });

  it('maps a caller abort to aborted, in flight and before the call', async () => {
    const api = new HttpDevDigestApi(BASE, hangUntilAborted(), 60_000);
    const inFlight = new AbortController();
    const pending = expect(api.listAgents(inFlight.signal)).rejects.toMatchObject({ kind: 'aborted' });
    await sleep(5);
    inFlight.abort();
    await pending;

    const before = new AbortController();
    before.abort();
    await expect(api.listAgents(before.signal)).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('maps a non-2xx answer to http with status, code and message', async () => {
    const { api } = apiFor({
      'GET /agents': () =>
        json({ error: { code: 'internal_error', message: 'relation "agents" does not exist' } }, 500),
    });

    await expect(api.listAgents()).rejects.toMatchObject({
      kind: 'http',
      status: 500,
      code: 'internal_error',
      message: 'relation "agents" does not exist',
      method: 'GET',
      path: '/agents',
    });
  });

  it('keeps the status of a rate-limit answer', async () => {
    const { api } = apiFor({
      [`POST /pulls/${ID.pr}/review`]: () =>
        json({ error: { code: 'internal_error', message: 'Rate limit exceeded, retry in 1 minute' } }, 429),
    });

    await expect(api.startReview(ID.pr, ID.agent)).rejects.toMatchObject({ kind: 'http', status: 429 });
  });

  it('clips the server message to 200 characters and strips control characters', async () => {
    const { api } = apiFor({
      'GET /agents': () => json({ error: { message: `${'x'.repeat(500)}` } }, 500),
      'GET /repos': () => json({ error: { message: 'a\n\n\tb\u0007c' } }, 500),
    });

    const long = await rejectionOf(api.listAgents());
    const messy = await rejectionOf(api.listRepos());

    expect(long.message).toHaveLength(200);
    expect(messy.message).toBe('a b c');
  });

  it('uses the raw text of a non-JSON error and a generic line for an empty one', async () => {
    const { api } = apiFor({
      'GET /agents': () => new Response('Bad Gateway', { status: 502 }),
      'GET /repos': () => new Response('', { status: 503 }),
    });

    await expect(api.listAgents()).rejects.toMatchObject({
      kind: 'http',
      status: 502,
      code: undefined,
      message: 'Bad Gateway',
    });
    await expect(api.listRepos()).rejects.toMatchObject({ kind: 'http', status: 503, message: 'HTTP 503' });
  });

  it('maps a body that is not JSON to shape', async () => {
    const { api } = apiFor({ 'GET /agents': () => new Response('<html>oops</html>', { status: 200 }) });

    await expect(api.listAgents()).rejects.toMatchObject({
      kind: 'shape',
      message: 'response body is not valid JSON',
    });
  });

  it('maps a schema mismatch to shape and names the field', async () => {
    const { api } = apiFor({
      'GET /agents': () => json([{ ...wireAgent, name: 123 }]),
      'GET /repos': () => json([{ id: 'repo-1', full_name: 'acme/x' }]),
      [`GET /repos/${ID.repo}/pulls`]: () => json({ not: 'an array' }),
    });

    await expect(api.listAgents()).rejects.toMatchObject({ kind: 'shape', message: expect.stringContaining('0.name') });
    await expect(api.listRepos()).rejects.toMatchObject({ kind: 'shape', message: expect.stringContaining('0.id') });
    await expect(api.listPulls(ID.repo)).rejects.toMatchObject({
      kind: 'shape',
      message: expect.stringContaining('(root)'),
    });
  });
});

describe('HttpDevDigestApi.waitForRun', () => {
  const eventsPath = `GET /runs/${ID.run}/events`;

  it('resolves only when the stream closes and reads it as an event stream', async () => {
    const stream = controlledStream();
    const { api, calls } = apiFor({ [eventsPath]: () => stream.response() });
    let settled = false;

    const waiting = api.waitForRun(ID.run, new AbortController().signal).then(() => {
      settled = true;
    });
    stream.push('event: info\ndata: this is not json\n\n');
    await sleep(20);
    expect(settled).toBe(false);

    stream.close();
    await waiting;

    expect(settled).toBe(true);
    expect(calls[0]?.headers['accept']).toBe('text/event-stream');
  });

  it('is not cut by the per-request timeout', async () => {
    const stream = controlledStream();
    const { api } = apiFor(
      {
        [eventsPath]: (_req, signal) => {
          signal?.addEventListener('abort', () => stream.fail(new TypeError('terminated')), { once: true });
          return stream.response();
        },
      },
      20,
    );
    setTimeout(() => stream.close(), 80);

    await expect(api.waitForRun(ID.run, new AbortController().signal)).resolves.toBeUndefined();
  });

  it('rejects with aborted and releases the connection when the caller aborts', async () => {
    const stream = controlledStream();
    const { api } = apiFor({ [eventsPath]: () => stream.response() });
    const controller = new AbortController();

    const pending = expect(api.waitForRun(ID.run, controller.signal)).rejects.toMatchObject({
      kind: 'aborted',
      path: `/runs/${ID.run}/events`,
    });
    await sleep(10);
    controller.abort();
    await pending;

    expect(stream.wasCancelled()).toBe(true);
  });

  it('rejects with aborted when the signal is already aborted', async () => {
    const stream = controlledStream();
    const { api } = apiFor({ [eventsPath]: () => stream.response() });
    const controller = new AbortController();
    controller.abort();

    await expect(api.waitForRun(ID.run, controller.signal)).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('rejects with unreachable when the stream breaks before it closes', async () => {
    const stream = controlledStream();
    const { api } = apiFor({ [eventsPath]: () => stream.response() });

    const pending = expect(api.waitForRun(ID.run, new AbortController().signal)).rejects.toMatchObject({
      kind: 'unreachable',
    });
    await sleep(5);
    stream.fail(new TypeError('terminated'));
    await pending;
  });

  it('rejects with http when the events route answers with an error', async () => {
    const { api } = apiFor({
      [eventsPath]: () => json({ error: { code: 'not_found', message: 'Run not found' } }, 404),
    });

    await expect(api.waitForRun(ID.run, new AbortController().signal)).rejects.toMatchObject({
      kind: 'http',
      status: 404,
      code: 'not_found',
    });
  });
});
