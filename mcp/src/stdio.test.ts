import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { INSTRUCTIONS, TOOL_NAMES } from './definitions.js';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const ENTRY_ARGS = ['--import', 'tsx', 'src/index.ts'];
const UNREACHABLE = 'http://127.0.0.1:1';

const childEnv = (extra: Record<string, string>): Record<string, string> => ({
  PATH: process.env.PATH ?? '',
  ...extra,
});

const open: Client[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((client) => client.close()));
});

describe('the real stdio entry with the API down', () => {
  it('initializes, lists the five tools and answers E9, leaving stdout to the protocol (AC2, AC12)', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ENTRY_ARGS,
      cwd: PACKAGE_DIR,
      env: childEnv({ DEVDIGEST_API_URL: UNREACHABLE }),
      stderr: 'pipe',
    });
    const stderr: string[] = [];
    transport.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')));
    const client = new Client({ name: 'stdio-test', version: '0.0.0' });
    const problems: Error[] = [];
    client.onerror = (err) => problems.push(err);
    open.push(client);

    await client.connect(transport);

    expect(client.getServerVersion()?.name).toBe('devdigest-mcp');
    expect(client.getInstructions()).toBe(INSTRUCTIONS);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    expect(JSON.stringify(tools)).not.toContain('_meta');

    const result = (await client.callTool({ name: 'list_agents', arguments: {} })) as CallToolResult;
    const [block] = result.content;
    expect(result.isError).toBe(true);
    expect(block?.type === 'text' && block.text).toBe(
      `DevDigest API is not reachable at ${UNREACHABLE}. Start it with ./scripts/dev.sh (or set DEVDIGEST_API_URL), then retry.`,
    );

    expect(problems).toEqual([]);

    await client.close();
    const lines = stderr.join('').split('\n').filter(Boolean);
    const events = lines.map((line) => (JSON.parse(line) as { event: string }).event);
    expect(events).toContain('server.ready');
    expect(events).toContain('tool.api_error');
  });

  it('exits 0 when the client closes stdin', async () => {
    const child = spawn(process.execPath, ENTRY_ARGS, {
      cwd: PACKAGE_DIR,
      env: childEnv({ DEVDIGEST_API_URL: UNREACHABLE }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    const exited = once(child, 'exit');

    for (let i = 0; i < 200 && !stderr.includes('server.ready'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(stderr).toContain('server.ready');

    child.stdin.end();
    const [code] = await exited;

    expect(code).toBe(0);
    expect(stdout).toBe('');
  });

  it.each([
    ['a non-loopback API URL', { DEVDIGEST_API_URL: 'http://example.com' }, 'DEVDIGEST_API_URL'],
    ['a malformed run timeout', { DEVDIGEST_MCP_RUN_TIMEOUT_MS: 'soon' }, 'DEVDIGEST_MCP_RUN_TIMEOUT_MS'],
  ])('refuses to start on %s: exit 1, a line on stderr, nothing on stdout', (_label, env, variable) => {
    const result = spawnSync(process.execPath, ENTRY_ARGS, {
      cwd: PACKAGE_DIR,
      env: childEnv(env),
      input: '',
      encoding: 'utf8',
      timeout: 15_000,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('server.startup_failed');
    expect(result.stderr).toContain(variable);
  });
});
