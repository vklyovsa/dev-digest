import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CLIP } from './constants.js';
import { ApiError, ToolError } from './errors.js';
import type { Logger } from './ports.js';
import { clip } from './text.js';

export function ok(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export interface ResultContext {
  tool: string;
  apiUrl: string;
  log: Logger;
}

const UNEXPECTED =
  'The DevDigest MCP server hit an unexpected error; its stderr log has the details. Do not retry in a loop; report it to the user.';

function apiErrorText(err: ApiError, apiUrl: string): string {
  if (err.kind === 'unreachable') {
    return `DevDigest API is not reachable at ${apiUrl}. Start it with ./scripts/dev.sh (or set DEVDIGEST_API_URL), then retry.`;
  }
  if (err.status === 429) {
    return 'DevDigest rate limit reached (review starts are limited to 10 per minute). Wait 60 seconds before calling run_agent_on_pr again.';
  }
  const message = clip(err.message, CLIP.error).replace(/[.\s]+$/, '');
  const status = err.status === undefined ? 'no HTTP status' : `HTTP ${err.status}`;
  const migrations = /does not exist/i.test(message)
    ? ' Migrations are probably not applied: cd server && pnpm db:migrate.'
    : '';
  return `DevDigest API returned an unexpected response for ${err.method} ${err.path} (${status}): ${message}. Do not retry in a loop; report it to the user.${migrations}`;
}

export async function toToolResult(
  run: () => Promise<unknown>,
  ctx: ResultContext,
): Promise<CallToolResult> {
  try {
    return ok(await run());
  } catch (err) {
    if (err instanceof ToolError) {
      ctx.log.info('tool.refused', { tool: ctx.tool, message: err.message });
      return fail(err.message);
    }
    if (err instanceof ApiError) {
      ctx.log.warn('tool.api_error', {
        tool: ctx.tool,
        kind: err.kind,
        method: err.method,
        path: err.path,
        status: err.status,
        code: err.code,
        message: err.message,
      });
      return fail(apiErrorText(err, ctx.apiUrl));
    }
    ctx.log.error('tool.crashed', {
      tool: ctx.tool,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return fail(UNEXPECTED);
  }
}
