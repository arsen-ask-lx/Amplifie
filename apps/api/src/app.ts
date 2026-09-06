import Fastify, { type FastifyInstance } from "fastify";
import { config } from "./config.js";
import { pingDatabase } from "./db.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: config.logLevel },
    // Сквозной идентификатор запроса: попадает в каждую строку лога
    // и позже — в каждое событие журнала.
    genReqId: () => crypto.randomUUID(),
    disableRequestLogging: false,
    // Доверяем заголовкам X-Forwarded-* только из приватных сетей —
    // то есть от Caddy внутри compose. `true` доверяет ЛЮБОМУ источнику,
    // и это отдельная уязвимость (GHSA-444r-cwp2-x5xf).
    trustProxy: "uniquelocal",
  });

  app.get("/health", async (_request, reply) => {
    try {
      await pingDatabase();
      return { status: "ok", database: "ok" };
    } catch (error) {
      app.log.error({ err: error }, "health: база недоступна");
      return reply.code(503).send({ status: "degraded", database: "unreachable" });
    }
  });

  return app;
}
