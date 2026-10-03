import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INSTRUCTIONS_MAX_CHARS, PROGRESS_INTERVAL_MS, TOOLS_LIST_MAX_CHARS } from './constants.js';
import { INSTRUCTIONS, TOOL_DEFINITIONS, TOOL_NAMES } from './definitions.js';
import { ApiError } from './errors.js';
import type { Logger } from './ports.js';
import { createServer, type ServerOptions } from './server.js';
import {
  FakeDevDigestApi,
  fakeAgent,
  fakeFinding,
  fakePull,
  fakeRepo,
  fakeReview,
  fakeRun,
} from './testing/fake-api.js';

const API_URL = 'http://127.0.0.1:3001';

const EXPECTED_LENGTHS = {
  list_agents: 207,
  run_agent_on_pr: 588,
  get_findings: 520,
  get_conventions: 406,
  get_blast_radius: 228,
} as const;
const EXPECTED_INSTRUCTIONS_LENGTH = 418;

const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

const open: Client[] = [];

function world(): FakeDevDigestApi {
  return new FakeDevDigestApi({
    agents: [fakeAgent({ id: 'a-sec', name: 'Security Reviewer' })],
    repos: [fakeRepo()],
    pulls: { 'repo-1': [fakePull()] },
    runs: { 'pr-1': [fakeRun({ runId: 'run-1', agentId: 'a-sec' })] },
    reviews: {
      'pr-1': [fakeReview({ runId: 'run-1', findings: [fakeFinding({ severity: 'CRITICAL', title: 'Injection' })] })],
    },
    conventions: {
      'repo-1': {
        scannedAt: null,
        conventions: [
          {
            id: 'c-1',
            category: 'naming',
            rule: 'Files are kebab-case',
            rationale: null,
            status: 'accepted',
            confidence: 0.9,
            evidencePath: 'a.ts',
            evidenceLineStart: null,
            evidenceLineEnd: null,
          },
        ],
      },
    },
    startFindings: [fakeFinding({ severity: 'WARNING', title: 'Weak hash' })],
  });
}

async function connect(api: FakeDevDigestApi = world(), over: Partial<ServerOptions> = {}) {
  const server = createServer({ api, apiUrl: API_URL, runBudgetMs: 5_000, log: silent, ...over });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  open.push(client);
  return { api, client, server };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(open.splice(0).map((client) => client.close()));
});

const textOf = (result: CallToolResult): string => {
  const [block] = result.content;
  if (result.content.length !== 1 || block?.type !== 'text') throw new Error('expected exactly one text block');
  return block.text;
};

const call = async (client: Client, name: string, args: Record<string, unknown>) =>
  (await client.callTool({ name, arguments: args })) as CallToolResult;

const until = async (condition: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !condition(); i += 1) await new Promise((resolve) => setImmediate(resolve));
  if (!condition()) throw new Error('condition not reached');
};

describe('tools/list', () => {
  it('returns exactly the five tools, in the documented order (AC1)', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name)).toEqual([
      'list_agents',
      'run_agent_on_pr',
      'get_findings',
      'get_conventions',
      'get_blast_radius',
    ]);
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
  });

  it('serves the A.2 descriptions character for character: exact lengths, equal to the definitions, each under 2,048', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();

    for (const tool of tools) {
      const length = EXPECTED_LENGTHS[tool.name as keyof typeof EXPECTED_LENGTHS];
      expect(tool.description?.length, tool.name).toBe(length);
      expect(tool.description?.length ?? 0, tool.name).toBeLessThanOrEqual(2_048);
      expect(tool.description, tool.name).toBe(TOOL_DEFINITIONS.find((d) => d.name === tool.name)?.description);
    }
  });

  it('serves the instructions as written, 418 characters and under the 600 ceiling', async () => {
    const { client } = await connect();
    const instructions = client.getInstructions();

    expect(instructions).toBe(INSTRUCTIONS);
    expect(instructions?.length).toBe(EXPECTED_INSTRUCTIONS_LENGTH);
    expect(instructions?.length ?? 0).toBeLessThanOrEqual(INSTRUCTIONS_MAX_CHARS);
  });

  it('every input property is a flat scalar and no schema uses $ref, $defs, anyOf, oneOf or allOf (AC10)', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();

    for (const tool of tools) {
      const schema = tool.inputSchema as { type: string; properties?: Record<string, Record<string, unknown>> };
      expect(schema.type, tool.name).toBe('object');
      for (const [field, property] of Object.entries(schema.properties ?? {})) {
        expect(['string', 'integer', 'number', 'boolean'], `${tool.name}.${field}`).toContain(property.type);
        expect(property, `${tool.name}.${field}`).not.toHaveProperty('properties');
        expect(property, `${tool.name}.${field}`).not.toHaveProperty('items');
      }
      expect(JSON.stringify(tool.inputSchema), tool.name).not.toMatch(/\$ref|\$defs|anyOf|oneOf|allOf/);
    }
  });

  it('list_agents has the empty object schema', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'list_agents')?.inputSchema).toEqual({ type: 'object', properties: {} });
  });

  it('declares the required arguments of each tool (A.1)', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const required = Object.fromEntries(tools.map((t) => [t.name, (t.inputSchema.required as string[] | undefined) ?? []]));
    const fields = Object.fromEntries(tools.map((t) => [t.name, Object.keys(t.inputSchema.properties ?? {})]));

    expect(required).toEqual({
      list_agents: [],
      run_agent_on_pr: ['repo', 'pr', 'agent'],
      get_findings: ['repo', 'pr'],
      get_conventions: ['repo'],
      get_blast_radius: ['repo', 'pr'],
    });
    expect(fields.get_findings).toEqual(['repo', 'pr', 'run_id', 'agent', 'min_severity', 'limit', 'detailed']);
    expect(fields.get_conventions).toEqual(['repo', 'limit', 'detailed']);
    expect(fields.get_blast_radius).toEqual(['repo', 'pr']);
  });

  it('carries no _meta, outputSchema or alwaysLoad hint on any tool', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();

    for (const tool of tools as (Tool & Record<string, unknown>)[]) {
      expect(tool._meta, tool.name).toBeUndefined();
      expect(tool.outputSchema, tool.name).toBeUndefined();
    }
    expect(JSON.stringify(tools)).not.toMatch(/_meta|outputSchema|alwaysLoad/);
  });

  it(`serializes to at most ${TOOLS_LIST_MAX_CHARS} characters as listed by the real SDK (AC10)`, async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();

    expect(JSON.stringify(tools).length).toBeLessThanOrEqual(TOOLS_LIST_MAX_CHARS);
  });

  it('annotates run_agent_on_pr as the only tool without readOnlyHint (A.1, AC9)', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const annotations = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));

    expect(annotations).toEqual({
      list_agents: { readOnlyHint: true, openWorldHint: false },
      run_agent_on_pr: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      get_findings: { readOnlyHint: true, openWorldHint: false },
      get_conventions: { readOnlyHint: true, openWorldHint: false },
      get_blast_radius: { readOnlyHint: true, openWorldHint: false },
    });
    expect(tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name)).toEqual(['run_agent_on_pr']);
  });

  it('uses the documented titles', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.title)).toEqual([
      'List reviewer agents',
      'Run agent on PR',
      'Get findings',
      'Get conventions',
      'Get blast radius (not implemented)',
    ]);
  });
});

describe('initialize', () => {
  it('advertises tools only: no resources, prompts or logging, and the package version', async () => {
    const { client } = await connect();

    expect(Object.keys(client.getServerCapabilities() ?? {})).toEqual(['tools']);
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(client.getServerVersion()).toMatchObject({ name: 'devdigest-mcp', version: packageJson.version });
  });
});

describe('tools/call results', () => {
  it('every successful call is exactly one text block holding compact JSON, with no structuredContent (AC11)', async () => {
    const { client } = await connect();
    const calls: [string, Record<string, unknown>][] = [
      ['list_agents', {}],
      ['run_agent_on_pr', { repo: 'acme/payments-api', pr: 482, agent: 'a-sec' }],
      ['get_findings', { repo: 'acme/payments-api', pr: 482, run_id: 'run-1' }],
      ['get_conventions', { repo: 'acme/payments-api' }],
    ];

    for (const [name, args] of calls) {
      const result = await call(client, name, args);
      const text = textOf(result);
      expect(result.isError, name).toBeFalsy();
      expect(result.structuredContent, name).toBeUndefined();
      expect(JSON.parse(text), name).toBeTypeOf('object');
      expect(text, name).toBe(JSON.stringify(JSON.parse(text)));
      expect(text.length, name).toBeLessThanOrEqual(20_000);
    }
  });

  it('list_agents returns the agents', async () => {
    const { client } = await connect();
    const payload = JSON.parse(textOf(await call(client, 'list_agents', {})));
    expect(payload).toMatchObject({ total: 1, agents: [{ id: 'a-sec', name: 'Security Reviewer' }] });
  });

  it('run_agent_on_pr returns the verdict, counts and findings with the run id (AC3)', async () => {
    const { client, api } = await connect();
    const payload = JSON.parse(
      textOf(await call(client, 'run_agent_on_pr', { repo: 'acme/payments-api', pr: 482, agent: 'Security Reviewer' })),
    );

    expect(payload).toMatchObject({
      status: 'done',
      run_id: 'run-started-1',
      verdict: 'comment',
      counts: { critical: 0, warning: 1, suggestion: 0 },
      findings: [{ severity: 'WARNING', title: 'Weak hash' }],
    });
    expect(api.callsTo('startReview')).toHaveLength(1);
  });

  it('get_findings maps its snake_case arguments (run_id, min_severity) and honours them (AC5)', async () => {
    const { client } = await connect();
    const none = JSON.parse(
      textOf(
        await call(client, 'get_findings', { repo: 'acme/payments-api', pr: 482, run_id: 'run-1', min_severity: 'CRITICAL' }),
      ),
    );
    expect(none).toMatchObject({ run_id: 'run-1', matched: 1, findings: [{ title: 'Injection' }] });

    const detailed = JSON.parse(
      textOf(await call(client, 'get_findings', { repo: 'acme/payments-api', pr: 482, agent: 'a-sec', detailed: true })),
    );
    expect(detailed.findings[0]).toHaveProperty('rationale');
    expect(detailed).toHaveProperty('summary');
  });

  it('get_conventions returns accepted conventions', async () => {
    const { client } = await connect();
    const payload = JSON.parse(textOf(await call(client, 'get_conventions', { repo: 'acme/payments-api' })));
    expect(payload).toMatchObject({ total: 1, conventions: [{ category: 'naming', rule: 'Files are kebab-case' }] });
  });

  it('get_blast_radius is an error saying not to retry, and never reaches the API (AC7)', async () => {
    const { client, api } = await connect();
    const result = await call(client, 'get_blast_radius', { repo: 'acme/payments-api', pr: 482 });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'get_blast_radius is not implemented yet in this DevDigest build. Do not retry. No other tool on this server returns impact data; tell the user it is unavailable.',
    );
    expect(api.calls).toEqual([]);
  });

  it('a refusal from a use case is an isError result carrying its text (AC8)', async () => {
    const { client } = await connect();
    const result = await call(client, 'run_agent_on_pr', { repo: 'acme/payments-api', pr: 482, agent: 'Nobody' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Agent "Nobody" not found. Call list_agents and pass one of its ids.');
  });
});

describe('invalid arguments', () => {
  it('a call missing pr is an error result that names the field', async () => {
    const { client, api } = await connect();
    const result = await call(client, 'get_findings', { repo: 'acme/payments-api' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/\bpr\b/);
    expect(api.calls).toEqual([]);
  });

  it('a value outside the schema is rejected before any use case runs', async () => {
    const { client, api } = await connect();

    const severity = await call(client, 'get_findings', {
      repo: 'acme/payments-api',
      pr: 482,
      agent: 'a-sec',
      min_severity: 'FATAL',
    });
    const negative = await call(client, 'run_agent_on_pr', { repo: 'acme/payments-api', pr: -3, agent: 'a-sec' });
    const wrongType = await call(client, 'run_agent_on_pr', { repo: 'acme/payments-api', pr: '482', agent: 'a-sec' });

    expect(severity.isError).toBe(true);
    expect(textOf(severity)).toContain('min_severity');
    expect(negative.isError).toBe(true);
    expect(textOf(negative)).toMatch(/\bpr\b/);
    expect(wrongType.isError).toBe(true);
    expect(api.calls).toEqual([]);
  });

  it('a repo that is not owner/name is refused with the format', async () => {
    const { client } = await connect();
    const result = await call(client, 'get_conventions', { repo: 'payments-api' });
    expect(textOf(result)).toBe('repo must look like "owner/name" (got "payments-api").');
  });
});

describe('failures behind the tools', () => {
  it('maps an unreachable API to E9 with the configured URL (AC8)', async () => {
    const api = world();
    api.listAgents = async () => {
      throw new ApiError('unreachable', { method: 'GET', path: '/agents', message: 'ECONNREFUSED' });
    };
    const { client } = await connect(api);

    const result = await call(client, 'list_agents', {});

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      `DevDigest API is not reachable at ${API_URL}. Start it with ./scripts/dev.sh (or set DEVDIGEST_API_URL), then retry.`,
    );
  });

  it('never lets the message of an unexpected exception reach the model', async () => {
    const api = world();
    api.listAgents = async () => {
      throw new Error('password=hunter2 at /home/klov/secret.ts:12');
    };
    const { client } = await connect(api);

    const result = await call(client, 'list_agents', {});

    expect(result.isError).toBe(true);
    expect(textOf(result)).not.toContain('hunter2');
    expect(textOf(result)).not.toContain('/home/klov');
    expect(textOf(result)).toContain('report it to the user');
  });
});

describe('cancellation and progress', () => {
  it('cancels the DevDigest run when the client cancels the call (AC13)', async () => {
    const api = new FakeDevDigestApi({
      agents: [fakeAgent({ id: 'a-sec' })],
      repos: [fakeRepo()],
      pulls: { 'repo-1': [fakePull()] },
      onStart: 'hang',
    });
    const { client } = await connect(api);
    const controller = new AbortController();

    const pending = client
      .callTool({ name: 'run_agent_on_pr', arguments: { repo: 'acme/payments-api', pr: 482, agent: 'a-sec' } }, undefined, {
        signal: controller.signal,
      })
      .then(
        () => 'resolved',
        (err: unknown) => err,
      );
    await until(() => api.callsTo('waitForRun').length === 1);

    controller.abort();
    await pending;
    await until(() => api.callsTo('cancelRun').length === 1);

    expect(api.callsTo('cancelRun')).toEqual([{ method: 'cancelRun', args: ['run-started-1'] }]);
    expect((await api.listRuns('pr-1'))[0]?.status).toBe('cancelled');
  });

  it('returns status running with the run id when the budget ends before the run does (AC4)', async () => {
    const api = new FakeDevDigestApi({
      agents: [fakeAgent({ id: 'a-sec' })],
      repos: [fakeRepo()],
      pulls: { 'repo-1': [fakePull()] },
      onStart: 'hang',
    });
    const { client } = await connect(api, { runBudgetMs: 50 });

    const payload = JSON.parse(
      textOf(await call(client, 'run_agent_on_pr', { repo: 'acme/payments-api', pr: 482, agent: 'a-sec' })),
    );

    expect(payload).toMatchObject({ status: 'running', run_id: 'run-started-1' });
    expect(api.callsTo('cancelRun')).toHaveLength(0);
  });

  it('sends progress notifications only when the client asked for them', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const api = new FakeDevDigestApi({
      agents: [fakeAgent({ id: 'a-sec' })],
      repos: [fakeRepo()],
      pulls: { 'repo-1': [fakePull()] },
      onStart: 'hang',
    });
    const { client } = await connect(api);
    const args = { repo: 'acme/payments-api', pr: 482, agent: 'a-sec' };
    const seen: { progress: number; total?: number }[] = [];

    const watched = client.callTool({ name: 'run_agent_on_pr', arguments: args }, undefined, {
      onprogress: (p) => seen.push({ progress: p.progress, total: p.total }),
    });
    await until(() => api.callsTo('waitForRun').length === 1);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(PROGRESS_INTERVAL_MS);
    await until(() => seen.length === 1);
    expect(seen).toEqual([{ progress: expect.any(Number), total: 5 }]);
    api.finishRun('run-started-1', 'done');
    expect(textOf((await watched) as CallToolResult)).toContain('"status":"done"');
    expect(vi.getTimerCount()).toBe(0);

    const quiet = client.callTool({ name: 'run_agent_on_pr', arguments: args });
    await until(() => api.callsTo('waitForRun').length === 2);
    expect(vi.getTimerCount()).toBe(0);
    api.finishRun('run-started-2', 'done');
    await quiet;
  });
});
