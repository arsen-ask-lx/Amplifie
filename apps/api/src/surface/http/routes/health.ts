import type { FastifyInstance } from "fastify";
import { pingDatabase } from "../../../platform/db.js";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/health", async (_request, reply) => {
    try {
      await pingDatabase();
      return { status: "ok", database: "ok" };
    } catch (error) {
      app.log.error({ err: error }, "health: база недоступна");
      return reply.code(503).send({ status: "degraded", database: "unreachable" });
    }
  });
}
