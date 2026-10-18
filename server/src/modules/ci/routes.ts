import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CiExport, CiExportInput, CiInstallation, CiRun, CiSyncResult } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

const PreviewInput = CiExportInput.pick({ repo: true, triggers: true, post_as: true });
const PreviewResponse = z.object({ files: CiExport.shape.files });
const RunsQuery = z.object({ agent_id: z.string().uuid().optional() });

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = app.container.ciService;

  app.post(
    '/agents/:id/ci/preview',
    { schema: { params: IdParams, body: PreviewInput, response: { 200: PreviewResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return { files: await service.preview(workspaceId, req.params.id, req.body) };
    },
  );

  app.post(
    '/agents/:id/export-ci',
    { schema: { params: IdParams, body: CiExportInput, response: { 200: CiExport } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.exportToGithub(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/agents/:id/ci/zip',
    { schema: { params: IdParams, body: CiExportInput } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const archive = await service.zip(workspaceId, req.params.id, req.body);
      return reply
        .header('content-type', 'application/zip')
        .header('content-disposition', 'attachment; filename="devdigest-ci.zip"')
        .send(archive);
    },
  );

  app.get(
    '/agents/:id/ci/installations',
    { schema: { params: IdParams, response: { 200: z.array(CiInstallation) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listInstallations(workspaceId, req.params.id);
    },
  );

  app.get(
    '/ci/runs',
    { schema: { querystring: RunsQuery, response: { 200: z.array(CiRun) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listRuns(workspaceId, req.query.agent_id);
    },
  );

  app.post('/ci/sync', { schema: { response: { 200: CiSyncResult } } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.sync(workspaceId);
  });
}
