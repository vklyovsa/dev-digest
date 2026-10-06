import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BlastHistoryResponse, BlastRadiusResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

/**
 * blast module.
 *   GET /pulls/:id/blast          → BlastRadiusResponse; index read only, never a model call
 *   GET /pulls/:id/blast/history  → BlastHistoryResponse; merged PRs from GitHub, empty when unavailable
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = app.container.blastService;

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams, response: { 200: BlastRadiusResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.forPull(workspaceId, req.params.id);
    },
  );

  app.get(
    '/pulls/:id/blast/history',
    { schema: { params: IdParams, response: { 200: BlastHistoryResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.historyForPull(workspaceId, req.params.id);
    },
  );
}
