import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EvalCase,
  EvalCaseCreateInput,
  EvalCaseDraftResponse,
  EvalCaseTryInput,
  EvalCaseTryResult,
  EvalCaseUpdateInput,
  EvalDashboard,
  EvalRun,
  EvalRunCompare,
  EvalRunDetail,
  EvalSkillCaseTryInput,
  EvalSkillRunCompare,
  EvalSkillRunStartInput,
} from '@devdigest/shared';
import { EVAL_RUN_RATE_LIMIT } from './constants.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = app.container.evalService;

  app.get(
    '/findings/:id/eval-case-draft',
    { schema: { params: IdParams, response: { 200: EvalCaseDraftResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.draftFromFinding(workspaceId, req.params.id);
    },
  );

  app.post(
    '/findings/:id/eval-case',
    {
      schema: {
        params: IdParams,
        body: EvalCaseUpdateInput,
        response: { 200: EvalCase, 201: EvalCase },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const { case: evalCase, created } = await service.createCaseFromFinding(
        workspaceId,
        req.params.id,
        req.body,
      );
      reply.status(created ? 201 : 200);
      return evalCase;
    },
  );

  app.post(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, body: EvalCaseCreateInput, response: { 201: EvalCase } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const created = await service.createCase(workspaceId, req.params.id, req.body);
      reply.status(201);
      return created;
    },
  );

  app.get(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, response: { 200: z.array(EvalCase) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listCases(workspaceId, req.params.id);
    },
  );

  app.post(
    '/skills/:id/eval-cases',
    { schema: { params: IdParams, body: EvalCaseCreateInput, response: { 201: EvalCase } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const created = await service.createSkillCase(workspaceId, req.params.id, req.body);
      reply.status(201);
      return created;
    },
  );

  app.get(
    '/skills/:id/eval-cases',
    { schema: { params: IdParams, response: { 200: z.array(EvalCase) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listSkillCases(workspaceId, req.params.id);
    },
  );

  app.post(
    '/skills/:id/eval-cases/try',
    {
      schema: { params: IdParams, body: EvalSkillCaseTryInput, response: { 200: EvalCaseTryResult } },
      config: { rateLimit: EVAL_RUN_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.trySkillCase(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/skills/:id/eval-runs',
    {
      schema: { params: IdParams, body: EvalSkillRunStartInput, response: { 202: EvalRun } },
      config: { rateLimit: EVAL_RUN_RATE_LIMIT },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const run = await service.startSkillRun(workspaceId, req.params.id, req.body.host_agent_id);
      reply.status(202);
      return run;
    },
  );

  app.get(
    '/skills/:id/eval-runs',
    { schema: { params: IdParams, response: { 200: z.array(EvalRun) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listSkillRuns(workspaceId, req.params.id);
    },
  );

  app.get(
    '/skills/:id/eval-runs/compare',
    {
      schema: {
        params: IdParams,
        querystring: z.object({ base: z.string().uuid(), head: z.string().uuid() }),
        response: { 200: EvalSkillRunCompare },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.compareSkillRuns(workspaceId, req.params.id, req.query.base, req.query.head);
    },
  );

  app.put(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: EvalCaseUpdateInput, response: { 200: EvalCase } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.updateCase(workspaceId, req.params.id, req.body);
    },
  );

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.deleteCase(workspaceId, req.params.id);
    return { ok: true };
  });

  app.post(
    '/agents/:id/eval-cases/try',
    {
      schema: { params: IdParams, body: EvalCaseTryInput, response: { 200: EvalCaseTryResult } },
      config: { rateLimit: EVAL_RUN_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.tryCase(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams, response: { 202: EvalRun } }, config: { rateLimit: EVAL_RUN_RATE_LIMIT } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const run = await service.startRun(workspaceId, req.params.id);
      reply.status(202);
      return run;
    },
  );

  app.get(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams, response: { 200: z.array(EvalRun) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listRuns(workspaceId, req.params.id);
    },
  );

  app.get(
    '/agents/:id/eval-runs/compare',
    {
      schema: {
        params: IdParams,
        querystring: z.object({ base: z.string().uuid(), head: z.string().uuid() }),
        response: { 200: EvalRunCompare },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.compareRuns(workspaceId, req.params.id, req.query.base, req.query.head);
    },
  );

  app.get('/eval/dashboard', { schema: { response: { 200: EvalDashboard } } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.dashboard(workspaceId);
  });

  app.get(
    '/eval-runs/:id',
    { schema: { params: IdParams, response: { 200: EvalRunDetail } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getRun(workspaceId, req.params.id);
    },
  );
}
