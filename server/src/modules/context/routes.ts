import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ContextAttachments,
  ContextAttachmentsInput,
  ContextDocumentList,
  SpecDocument,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

const DocumentQuery = z.object({ path: z.string() });

/**
 * context module (Project Context). No route calls a model.
 *   GET /repos/:id/context           → ContextDocumentList; no document text
 *   GET /repos/:id/context/document  → SpecDocument; 404 for a path the list does not hold
 *   GET|PUT /agents/:id/context      → ContextAttachments (+ `inherited` from linked skills)
 *   GET|PUT /skills/:id/context      → ContextAttachments
 */
export default async function contextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = app.container.contextService;

  app.get(
    '/repos/:id/context',
    { schema: { params: IdParams, response: { 200: ContextDocumentList } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listDocuments(workspaceId, req.params.id);
    },
  );

  app.get(
    '/repos/:id/context/document',
    { schema: { params: IdParams, querystring: DocumentQuery, response: { 200: SpecDocument } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getDocument(workspaceId, req.params.id, req.query.path);
    },
  );

  app.get(
    '/agents/:id/context',
    { schema: { params: IdParams, response: { 200: ContextAttachments } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getAgentContext(workspaceId, req.params.id);
    },
  );

  app.put(
    '/agents/:id/context',
    { schema: { params: IdParams, body: ContextAttachmentsInput, response: { 200: ContextAttachments } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setAgentContext(workspaceId, req.params.id, req.body.paths);
    },
  );

  app.get(
    '/skills/:id/context',
    { schema: { params: IdParams, response: { 200: ContextAttachments } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getSkillContext(workspaceId, req.params.id);
    },
  );

  app.put(
    '/skills/:id/context',
    { schema: { params: IdParams, body: ContextAttachmentsInput, response: { 200: ContextAttachments } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setSkillContext(workspaceId, req.params.id, req.body.paths);
    },
  );
}
