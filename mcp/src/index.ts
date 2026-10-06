import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HttpDevDigestApi } from './api/http-client.js';
import { loadConfig } from './config.js';
import { createStderrLogger } from './log.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const log = createStderrLogger();
  const config = loadConfig(process.env);
  const server = createServer({
    api: new HttpDevDigestApi(config.apiUrl),
    apiUrl: config.apiUrl,
    runBudgetMs: config.runBudgetMs,
    log,
  });

  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0));
  };
  process.stdin.once('end', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await server.connect(new StdioServerTransport());
  log.info('server.ready', { api_url: config.apiUrl, run_budget_ms: config.runBudgetMs });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${JSON.stringify({ level: 'error', event: 'server.startup_failed', message })}\n`);
  process.exit(1);
});
