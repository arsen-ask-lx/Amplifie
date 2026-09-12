import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { serializerCompiler, validatorCompiler } from "@fastify/type-provider-zod";
import Fastify, { type FastifyInstance } from "fastify";
import { setSessionTouchFailureReporter } from "../../kernel/identity/index.js";
import { setBusFailureReporter } from "../../platform/bus.js";
import { config } from "../../platform/config.js";
import { countQueries, queriesSoFar } from "../../platform/db.js";
import { answerKnownFailures } from "./failures.js";
import { OVERALL } from "./limits.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerAccountRoutes, registerAuthRoutes } from "./routes/auth.js";
import { registerBridgeHumanRoutes, registerBridgeMachineRoutes } from "./routes/bridge.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerStreamRoutes } from "./routes/stream.js";
import { requireSession } from "./routes/viewer.js";

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

  // Порог частоты (Р-025): общий потолок здесь, отдельные — на маршрутах.
  // После печенек — у половины порогов ключ сессия.
  await app.register(rateLimit, {
    ...OVERALL,
    // После разбора тела, а не на `onRequest`: ключ входа — «почта + адрес»,
    // а почта лежит в теле. Цена — сверх порога платят разбором JSON.
    hook: "preValidation",
    // Отказ одинаков при верном и неверном пароле. `statusCode` обязателен:
    // без него Fastify отдаёт 500.
    errorResponseBuilder: () => ({ statusCode: 429, error: "too_many_requests" }),
  });

  // Ядро получает не логгер, а функцию: оно не знает, чем логирует витрина.
  setSessionTouchFailureReporter((error) => {
    app.log.warn({ err: error }, "не удалось обновить отметку сессии");
  });
  setBusFailureReporter((error) => {
    app.log.warn({ err: error }, "слушатель живых обновлений упал");
  });

  // Счёт запросов к базе на обращение: стенд отдаёт его заголовком, и по нему
  // приёмочные ловят N+1. В коробке заголовка нет — устройство базы не наружу.
  app.addHook("onRequest", (_request, _reply, done) => countQueries(done));
  if (config.multiWorkspace) {
    app.addHook("onSend", async (_request, reply) => {
      const queries = queriesSoFar();
      if (queries !== null) reply.header("x-db-queries", String(queries));
    });
  }

  // Схемы дверей — zod (Р-034): одна схема проверяет вход и режет выход.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  answerKnownFailures(app);

  // Открытые двери: здоровье, вход и машина моста со своим удостоверением.
  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerBridgeMachineRoutes(app);

  // Всё остальное — только с сессией. Проверка стоит у области, а не
  // в каждой двери: новая дверь, объявленная здесь, не может её забыть.
  await app.register(async (signedIn) => {
    requireSession(signedIn);
    registerAccountRoutes(signedIn);
    registerBridgeHumanRoutes(signedIn);
    registerAgentRoutes(signedIn);
    registerChatRoutes(signedIn);
    registerStreamRoutes(signedIn);
  });

  return app;
}
