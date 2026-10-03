import type { z } from 'zod';
import { REQUEST_TIMEOUT_MS } from '../constants.js';
import { ApiError } from '../errors.js';
import type {
  ActiveRun,
  AgentInfo,
  ConventionsInfo,
  DevDigestApi,
  FindingInfo,
  PullInfo,
  RepoInfo,
  ReviewInfo,
  RunInfo,
} from '../ports.js';
import {
  ApiActiveRun,
  ApiAgent,
  ApiConventionsPage,
  ApiErrorBody,
  ApiPull,
  ApiRepo,
  ApiReview,
  ApiRunSummary,
  ApiStartReview,
  type ApiFinding,
} from './schemas.js';

type Method = 'GET' | 'POST';

interface Attempt {
  signal: AbortSignal | undefined;
  fail(err: unknown): ApiError;
}

const HTTP_MESSAGE_MAX = 200;

const squash = (value: string, max: number): string =>
  value.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, max);

const enc = (id: string): string => encodeURIComponent(id);

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  return err.cause instanceof Error ? `${err.message}: ${err.cause.message}` : err.message;
}

function httpError(method: Method, path: string, status: number, text: string): ApiError {
  let envelope: ApiErrorBody['error'] | undefined;
  try {
    const parsed = ApiErrorBody.safeParse(JSON.parse(text));
    if (parsed.success) envelope = parsed.data.error;
  } catch {
    envelope = undefined;
  }
  const message = squash(envelope?.message ?? text, HTTP_MESSAGE_MAX) || `HTTP ${status}`;
  return new ApiError('http', { method, path, status, code: envelope?.code, message });
}

async function drain(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
  const reader = body.getReader();
  const stop = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    if (signal.aborted) stop();
    while (!(await reader.read()).done) {
      // chunks are discarded: the stream closing is the only signal that matters
    }
  } finally {
    signal.removeEventListener('abort', stop);
  }
  if (signal.aborted) throw new Error('aborted while draining the event stream');
}

const toFinding = (f: ApiFinding): FindingInfo => ({
  id: f.id,
  severity: f.severity,
  category: f.category,
  title: f.title,
  file: f.file,
  startLine: f.start_line,
  endLine: f.end_line,
  rationale: f.rationale,
  suggestion: f.suggestion ?? null,
  confidence: f.confidence,
  dismissed: f.dismissed_at !== null,
});

export class HttpDevDigestApi implements DevDigestApi {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly requestTimeoutMs: number = REQUEST_TIMEOUT_MS,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async listAgents(signal?: AbortSignal): Promise<AgentInfo[]> {
    const rows = await this.getJson('/agents', ApiAgent.array(), signal);
    return rows.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      model: a.model,
      enabled: a.enabled,
    }));
  }

  async listRepos(signal?: AbortSignal): Promise<RepoInfo[]> {
    const rows = await this.getJson('/repos', ApiRepo.array(), signal);
    return rows.map((r) => ({ id: r.id, fullName: r.full_name }));
  }

  async listPulls(repoId: string, signal?: AbortSignal): Promise<PullInfo[]> {
    const rows = await this.getJson(`/repos/${enc(repoId)}/pulls`, ApiPull.array(), signal);
    return rows.map((p) => ({ id: p.id ?? null, number: p.number, title: p.title }));
  }

  async listActiveRuns(prId: string, signal?: AbortSignal): Promise<ActiveRun[]> {
    const rows = await this.getJson(`/pulls/${enc(prId)}/runs/active`, ApiActiveRun.array(), signal);
    return rows.map((r) => ({
      runId: r.run_id,
      agentId: r.agent_id,
      agentName: r.agent_name,
      ranAt: r.ran_at,
    }));
  }

  async startReview(prId: string, agentId: string, signal?: AbortSignal): Promise<string> {
    const path = `/pulls/${enc(prId)}/review`;
    const text = await this.exchange('POST', path, { signal, body: { agentId } });
    const started = this.parse(ApiStartReview, text, 'POST', path);
    const first = started.runs[0];
    if (!first) {
      throw new ApiError('shape', { method: 'POST', path, message: 'response lists no started run' });
    }
    return first.run_id;
  }

  async waitForRun(runId: string, signal: AbortSignal): Promise<void> {
    const path = `/runs/${enc(runId)}/events`;
    const attempt = this.begin('GET', path, signal, null);
    try {
      const res = await this.send('GET', path, attempt.signal, undefined, 'text/event-stream');
      if (!res.ok) throw httpError('GET', path, res.status, await res.text());
      if (res.body) await drain(res.body, signal);
    } catch (err) {
      throw attempt.fail(err);
    }
  }

  async listRuns(prId: string, signal?: AbortSignal): Promise<RunInfo[]> {
    const rows = await this.getJson(`/pulls/${enc(prId)}/runs`, ApiRunSummary.array(), signal);
    return rows.map((r) => ({
      runId: r.run_id,
      agentId: r.agent_id,
      agentName: r.agent_name,
      status: r.status,
      error: r.error,
      model: r.model,
      ranAt: r.ran_at,
      durationMs: r.duration_ms,
      costUsd: r.cost_usd,
      score: r.score,
      blockers: r.blockers,
    }));
  }

  async listReviews(prId: string, signal?: AbortSignal): Promise<ReviewInfo[]> {
    const rows = await this.getJson(`/pulls/${enc(prId)}/reviews`, ApiReview.array(), signal);
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      verdict: r.verdict,
      summary: r.summary,
      score: r.score,
      model: r.model,
      createdAt: r.created_at,
      findings: r.findings.map(toFinding),
    }));
  }

  async cancelRun(runId: string, signal?: AbortSignal): Promise<void> {
    await this.exchange('POST', `/runs/${enc(runId)}/cancel`, { signal });
  }

  async getConventions(repoId: string, signal?: AbortSignal): Promise<ConventionsInfo> {
    const page = await this.getJson(`/repos/${enc(repoId)}/conventions`, ApiConventionsPage, signal);
    return {
      scannedAt: page.scan ? (page.scan.finished_at ?? page.scan.started_at) : null,
      conventions: page.candidates.map((c) => ({
        id: c.id,
        category: c.category,
        rule: c.rule,
        rationale: c.rationale ?? null,
        status: c.status,
        confidence: c.confidence,
        evidencePath: c.evidence_path,
        evidenceLineStart: c.evidence_line_start ?? null,
        evidenceLineEnd: c.evidence_line_end ?? null,
      })),
    };
  }

  private async getJson<S extends z.ZodTypeAny>(
    path: string,
    schema: S,
    signal: AbortSignal | undefined,
  ): Promise<z.infer<S>> {
    const text = await this.exchange('GET', path, { signal });
    return this.parse(schema, text, 'GET', path);
  }

  private parse<S extends z.ZodTypeAny>(
    schema: S,
    text: string,
    method: Method,
    path: string,
  ): z.infer<S> {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ApiError('shape', { method, path, message: 'response body is not valid JSON' });
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue && issue.path.length > 0 ? issue.path.join('.') : '(root)';
      throw new ApiError('shape', {
        method,
        path,
        message: squash(`unexpected response shape at ${where}: ${issue?.message ?? 'invalid'}`, HTTP_MESSAGE_MAX),
      });
    }
    return parsed.data;
  }

  private begin(
    method: Method,
    path: string,
    caller: AbortSignal | undefined,
    timeoutMs: number | null,
  ): Attempt {
    const timeout = timeoutMs === null ? undefined : AbortSignal.timeout(timeoutMs);
    const parts = [caller, timeout].filter((s): s is AbortSignal => s !== undefined);
    return {
      signal: parts.length > 0 ? AbortSignal.any(parts) : undefined,
      fail: (err) => {
        if (err instanceof ApiError) return err;
        if (caller?.aborted) {
          return new ApiError('aborted', { method, path, message: 'request aborted by the caller' });
        }
        if (timeout?.aborted) {
          return new ApiError('timeout', { method, path, message: `no answer within ${timeoutMs} ms` });
        }
        return new ApiError('unreachable', { method, path, message: describeError(err) });
      },
    };
  }

  private send(
    method: Method,
    path: string,
    signal: AbortSignal | undefined,
    body: unknown,
    accept = 'application/json',
  ): Promise<Response> {
    const headers: Record<string, string> = { accept };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const doFetch = this.fetchImpl;
    return doFetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  }

  private async exchange(
    method: Method,
    path: string,
    opts: { signal: AbortSignal | undefined; body?: unknown },
  ): Promise<string> {
    const attempt = this.begin(method, path, opts.signal, this.requestTimeoutMs);
    try {
      const res = await this.send(method, path, attempt.signal, opts.body);
      const text = await res.text();
      if (!res.ok) throw httpError(method, path, res.status, text);
      return text;
    } catch (err) {
      throw attempt.fail(err);
    }
  }
}
