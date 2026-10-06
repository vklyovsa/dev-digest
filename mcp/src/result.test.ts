import { describe, expect, it } from 'vitest';
import { ApiError, ToolError } from './errors.js';
import type { LogFields, Logger } from './ports.js';
import { fail, ok, toToolResult } from './result.js';

interface Line {
  level: string;
  event: string;
  fields?: LogFields;
}

function logger(): Logger & { lines: Line[] } {
  const lines: Line[] = [];
  const at =
    (level: string) =>
    (event: string, fields?: LogFields): void => {
      lines.push({ level, event, fields });
    };
  return { lines, info: at('info'), warn: at('warn'), error: at('error') };
}

const URL = 'http://127.0.0.1:3001';

async function run(thrown: unknown) {
  const log = logger();
  const result = await toToolResult(
    async () => {
      throw thrown;
    },
    { tool: 'get_findings', apiUrl: URL, log },
  );
  return { result, log };
}

const textOf = (result: Awaited<ReturnType<typeof toToolResult>>): string => {
  const [block] = result.content;
  return block?.type === 'text' ? block.text : '';
};

describe('ok / fail', () => {
  it('ok is one text block with compact JSON and nothing else', () => {
    const result = ok({ status: 'done', findings: [{ a: 1 }] });

    expect(result).toEqual({ content: [{ type: 'text', text: '{"status":"done","findings":[{"a":1}]}' }] });
    expect(result).not.toHaveProperty('structuredContent');
    expect(result).not.toHaveProperty('isError');
  });

  it('fail is one text block flagged isError', () => {
    expect(fail('nope')).toEqual({ isError: true, content: [{ type: 'text', text: 'nope' }] });
  });
});

describe('toToolResult', () => {
  it('wraps a resolved value with ok', async () => {
    const result = await toToolResult(async () => ({ total: 2 }), { tool: 't', apiUrl: URL, log: logger() });
    expect(textOf(result)).toBe('{"total":2}');
    expect(result.isError).toBeUndefined();
  });

  it('a ToolError becomes its own text', async () => {
    const { result, log } = await run(new ToolError('Agent "x" not found. Call list_agents and pass one of its ids.'));

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Agent "x" not found. Call list_agents and pass one of its ids.');
    expect(log.lines[0]).toMatchObject({ level: 'info', event: 'tool.refused' });
  });

  it('E9: an unreachable API names the URL and ./scripts/dev.sh', async () => {
    const { result, log } = await run(
      new ApiError('unreachable', { method: 'GET', path: '/agents', message: 'fetch failed: ECONNREFUSED' }),
    );

    expect(textOf(result)).toBe(
      'DevDigest API is not reachable at http://127.0.0.1:3001. Start it with ./scripts/dev.sh (or set DEVDIGEST_API_URL), then retry.',
    );
    expect(log.lines[0]).toMatchObject({ level: 'warn', event: 'tool.api_error' });
    expect(log.lines[0]?.fields).toMatchObject({ tool: 'get_findings', kind: 'unreachable', method: 'GET', path: '/agents' });
  });

  it('E10: HTTP 429 says to wait 60 seconds', async () => {
    const { result } = await run(
      new ApiError('http', { method: 'POST', path: '/pulls/p/review', status: 429, message: 'Too Many Requests' }),
    );

    expect(textOf(result)).toBe(
      'DevDigest rate limit reached (review starts are limited to 10 per minute). Wait 60 seconds before calling run_agent_on_pr again.',
    );
  });

  it('E13: a 5xx names the request, the status and the message, and says not to loop', async () => {
    const { result } = await run(
      new ApiError('http', { method: 'GET', path: '/pulls/p/runs', status: 500, message: 'boom.' }),
    );

    expect(textOf(result)).toBe(
      'DevDigest API returned an unexpected response for GET /pulls/p/runs (HTTP 500): boom. Do not retry in a loop; report it to the user.',
    );
  });

  it('E13: adds the migrations hint when the message says something does not exist', async () => {
    const { result } = await run(
      new ApiError('http', {
        method: 'GET',
        path: '/repos/r/pulls',
        status: 500,
        message: 'relation "pull_requests" does not exist',
      }),
    );

    expect(textOf(result)).toBe(
      'DevDigest API returned an unexpected response for GET /repos/r/pulls (HTTP 500): relation "pull_requests" does not exist. Do not retry in a loop; report it to the user. Migrations are probably not applied: cd server && pnpm db:migrate.',
    );
  });

  it('E13 also covers a changed response shape, a timeout and an abort, which carry no HTTP status', async () => {
    const shape = await run(new ApiError('shape', { method: 'GET', path: '/agents', message: 'unexpected response shape at 0.id' }));
    const timeout = await run(new ApiError('timeout', { method: 'GET', path: '/agents', message: 'no answer within 15000 ms' }));
    const aborted = await run(new ApiError('aborted', { method: 'GET', path: '/agents', message: 'request aborted by the caller' }));

    expect(textOf(shape.result)).toContain('(no HTTP status): unexpected response shape at 0.id. Do not retry in a loop');
    expect(textOf(timeout.result)).toContain('(no HTTP status): no answer within 15000 ms. Do not retry in a loop');
    expect(textOf(aborted.result)).toContain('for GET /agents (no HTTP status)');
    for (const { result } of [shape, timeout, aborted]) expect(result.isError).toBe(true);
  });

  it('clips a long API message', async () => {
    const { result } = await run(
      new ApiError('http', { method: 'GET', path: '/x', status: 502, message: `bad\n${'y'.repeat(2000)}` }),
    );
    expect(textOf(result).length).toBeLessThan(600);
  });

  it('an unexpected exception gets a generic text and its detail goes to the log only', async () => {
    const { result, log } = await run(new TypeError('Cannot read properties of undefined (reading "token=abc123")'));

    expect(result.isError).toBe(true);
    expect(textOf(result)).not.toContain('abc123');
    expect(textOf(result)).not.toContain('Cannot read');
    expect(textOf(result)).toContain('Do not retry in a loop; report it to the user.');
    expect(log.lines[0]).toMatchObject({ level: 'error', event: 'tool.crashed' });
    expect(String(log.lines[0]?.fields?.error)).toContain('Cannot read properties');
  });

  it('survives a non-Error throw', async () => {
    const { result } = await run('just a string');
    expect(result.isError).toBe(true);
    expect(textOf(result)).not.toContain('just a string');
  });

  it('catches a synchronous throw inside the callback', async () => {
    const result = await toToolResult(
      () => {
        throw new ToolError('sync refusal');
      },
      { tool: 't', apiUrl: URL, log: logger() },
    );
    expect(textOf(result)).toBe('sync refusal');
  });
});
