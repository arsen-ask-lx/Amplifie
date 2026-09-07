import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { setSessionTouchFailureReporter } from "../../kernel/identity/index.js";
import { setBusFailureReporter } from "../../platform/bus.js";
import { config } from "../../platform/config.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerBridgeRoutes } from "./routes/bridge.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerInviteRoutes } from "./routes/invites.js";
import { registerStreamRoutes } from "./routes/stream.js";
import { registerWorkRoutes } from "./routes/work.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    // Сквозной идентификатор запроса: попадает в каждую строку лога
    // и позже — в каждое событие журнала.
    genReqId: () => crypto.randomUUID(),
    // Доверяем заголовкам X-Forwarded-* только из приватных сетей —
    // то есть от Caddy внутри compose. `true` доверяет ЛЮБОМУ источнику,
    // и это отдельная уязвимость (GHSA-444r-cwp2-x5xf).
    trustProxy: "uniquelocal",
  });

  await app.register(cookie);

  // Ядро не знает, чем логирует витрина — поэтому получает не логгер,
  // а функцию (SOLID-D).
  setSessionTouchFailureReporter((error) => {
    app.log.warn({ err: error }, "не удалось обновить отметку сессии");
  });
  setBusFailureReporter((error) => {
    app.log.warn({ err: error }, "слушатель живых обновлений упал");
  });

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerBridgeRoutes(app);
  registerAgentRoutes(app);
  registerChatRoutes(app);
  registerInviteRoutes(app);
  registerStreamRoutes(app);
  registerWorkRoutes(app);

  return app;
}
