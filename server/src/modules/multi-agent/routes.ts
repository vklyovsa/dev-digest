import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { MultiAgentRunRequest } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { START_RATE_LIMIT } from './constants.js';
import { MultiAgentService } from './service.js';

/**
 * multi-agent module.
 *   POST /pulls/:id/multi-agent-run       {agent_ids} → start one run over several agents
 *   GET  /multi-agent-runs/estimates                  → per-agent duration/cost of the last done run
 *   GET  /multi-agent-runs/:id                        → columns + grouped findings
 *   GET  /repos/:id/multi-agent-runs/latest           → newest run of a repository, or null
 */
export default async function multiAgentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new MultiAgentService(container);

  app.post(
    '/pulls/:id/multi-agent-run',
    { schema: { params: IdParams, body: MultiAgentRunRequest }, config: { rateLimit: START_RATE_LIMIT } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.start(workspaceId, req.params.id, req.body.agent_ids);
    },
  );

  app.get('/multi-agent-runs/estimates', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.estimates(workspaceId);
  });

  app.get('/multi-agent-runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.get(workspaceId, req.params.id);
  });

  app.get('/repos/:id/multi-agent-runs/latest', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.latest(workspaceId, req.params.id);
  });
}
