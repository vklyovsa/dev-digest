import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AgentPerf, AgentStats } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

const PeriodQuery = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .refine((q) => Date.parse(q.from) < Date.parse(q.to), {
    message: 'from must be before to',
    path: ['from'],
  });

const toRange = (q: z.infer<typeof PeriodQuery>) => ({ from: new Date(q.from), to: new Date(q.to) });

export default async function agentPerformanceRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = app.container.agentPerformanceService;

  app.get(
    '/agents/performance',
    { schema: { querystring: PeriodQuery, response: { 200: AgentPerf } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.performance(workspaceId, toRange(req.query));
    },
  );

  app.get(
    '/agents/:id/stats',
    { schema: { params: IdParams, querystring: PeriodQuery, response: { 200: AgentStats } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.agentStats(workspaceId, req.params.id, toRange(req.query));
    },
  );
}
