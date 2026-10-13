import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { pullRequests } from "../../db/schema.js";
import type { Container } from "../../platform/container.js";

export async function pullsRoutes(app: FastifyInstance, container: Container) {
  app.get<{ Params: { id: string } }>("/pulls/:id", async (req) => {
    return container.pullsService.get(req.params.id);
  });

  app.post<{ Params: { id: string } }>("/pulls/:id/refresh", async (req) => {
    const { id } = req.params;
    const github = await container.github();
    const fresh = await github.getPullRequest(id);
    await container.db
      .update(pullRequests)
      .set({ title: fresh.title, headSha: fresh.headSha })
      .where(eq(pullRequests.id, id));
    return { refreshed: true };
  });
}
