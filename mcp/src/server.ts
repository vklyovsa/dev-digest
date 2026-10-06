import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FINAL_READ_TIMEOUT_MS } from './constants.js';
import {
  GET_BLAST_RADIUS,
  GET_CONVENTIONS,
  GET_FINDINGS,
  INSTRUCTIONS,
  LIST_AGENTS,
  RUN_AGENT_ON_PR,
  SERVER_INFO,
  getBlastRadiusShape,
  getConventionsShape,
  getFindingsShape,
  runAgentOnPrShape,
  type ToolDefinition,
} from './definitions.js';
import type { DevDigestApi, Logger } from './ports.js';
import { toToolResult } from './result.js';
import { getBlastRadius } from './tools/get-blast-radius.js';
import { getConventions } from './tools/get-conventions.js';
import { getFindings } from './tools/get-findings.js';
import { listAgents } from './tools/list-agents.js';
import { runAgentOnPr } from './tools/run-agent-on-pr.js';

export interface ServerOptions {
  api: DevDigestApi;
  apiUrl: string;
  runBudgetMs: number;
  log: Logger;
}

type ToolSpec = Pick<ToolDefinition, 'title' | 'description' | 'annotations'>;

const spec = ({ title, description, annotations }: ToolDefinition): ToolSpec => ({
  title,
  description,
  annotations,
});

export function createServer(opts: ServerOptions): McpServer {
  const { api, apiUrl, runBudgetMs, log } = opts;
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  const result = (tool: ToolDefinition['name'], run: () => Promise<unknown>) =>
    toToolResult(run, { tool, apiUrl, log });

  server.registerTool(LIST_AGENTS.name, spec(LIST_AGENTS), (extra) =>
    result(LIST_AGENTS.name, () => listAgents(api, extra.signal)),
  );

  server.registerTool(
    RUN_AGENT_ON_PR.name,
    { ...spec(RUN_AGENT_ON_PR), inputSchema: runAgentOnPrShape() },
    ({ repo, pr, agent }, extra) =>
      result(RUN_AGENT_ON_PR.name, () => {
        const progressToken = extra._meta?.progressToken;
        return runAgentOnPr(
          api,
          { repo, pr, agent },
          {
            signal: extra.signal,
            budgetMs: runBudgetMs,
            finalReadTimeoutMs: FINAL_READ_TIMEOUT_MS,
            now: Date.now,
            log,
            onProgress:
              progressToken === undefined
                ? undefined
                : (elapsedMs) => {
                    void extra
                      .sendNotification({
                        method: 'notifications/progress',
                        params: {
                          progressToken,
                          progress: Math.round(elapsedMs / 1000),
                          total: Math.round(runBudgetMs / 1000),
                          message: 'Waiting for the review run to finish',
                        },
                      })
                      .catch(() => undefined);
                  },
          },
        );
      }),
  );

  server.registerTool(
    GET_FINDINGS.name,
    { ...spec(GET_FINDINGS), inputSchema: getFindingsShape() },
    ({ repo, pr, run_id, agent, min_severity, limit, detailed }, extra) =>
      result(GET_FINDINGS.name, () =>
        getFindings(
          api,
          { repo, pr, runId: run_id, agent, minSeverity: min_severity, limit, detailed },
          extra.signal,
        ),
      ),
  );

  server.registerTool(
    GET_CONVENTIONS.name,
    { ...spec(GET_CONVENTIONS), inputSchema: getConventionsShape() },
    ({ repo, limit, detailed }, extra) =>
      result(GET_CONVENTIONS.name, () => getConventions(api, { repo, limit, detailed }, extra.signal)),
  );

  server.registerTool(
    GET_BLAST_RADIUS.name,
    { ...spec(GET_BLAST_RADIUS), inputSchema: getBlastRadiusShape() },
    ({ repo, pr }, extra) =>
      result(GET_BLAST_RADIUS.name, () => getBlastRadius(api, { repo, pr }, extra.signal)),
  );

  return server;
}
