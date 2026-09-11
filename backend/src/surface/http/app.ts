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

  /**
   * Порог частоты (Р-025). Общий потолок здесь, отдельные — на маршрутах.
   *
   * ⚠️ ПОСЛЕ ПЕЧЕНЕК, А НЕ ДО. Ключ у половины порогов — сессия, и без
   * разбора печенек все запросы одного человека выглядели бы как разные
   * (или все люди — как один).
   *
   * ⚠️ ХРАНИЛИЩЕ — ПАМЯТЬ ПРОЦЕССА. Процесс один; появится второй —
   * счётчики разъедутся, и понадобится общее хранилище. Это тот же день,
   * когда понадобится общая раздача событий, и он назван порогом
   * в реестре, а не «когда-нибудь».
   */
  await app.register(rateLimit, {
    ...OVERALL,
    /**
     * ⚠️ ПОСЛЕ РАЗБОРА ТЕЛА, А НЕ ДО (по умолчанию `onRequest`).
     *
     * Порогу входа нужен ключ «почта + адрес», иначе сосед по общему
     * выходу в интернет теряет попытки из-за чужого подбора. А почта
     * лежит в теле запроса, и на `onRequest` тела ещё нет: ключ у всех
     * получался одинаковый, и первый же перебор запирал вход всей
     * компании. Поймано приёмочной П-2, из кода не видно вовсе.
     *
     * Цена названа: поток запросов сверх порога теперь платит разбором
     * JSON, прежде чем получить отказ. Для подбора пароля это ничего
     * не меняет, для наводнения — меняет, и на этот случай перед нами
     * стоит Caddy. Настройка общая на весь плагин: поменять её у одного
     * маршрута нельзя.
     */
    hook: "preValidation",
    /**
     * Отказ одинаков для верного и неверного пароля: иначе по разнице
     * ответов узнают, какой пароль верен, ровно в тот миг, когда порог
     * сработал.
     *
     * ⚠️ `statusCode` ОБЯЗАТЕЛЕН. Без него Fastify считает наш ответ
     * необработанной поломкой и отдаёт 500 — то есть порог срабатывает,
     * а снаружи это выглядит как сломанный сервер. Поймано живым
     * прогоном: семь ответов 500 подряд с телом «too_many_requests».
     */
    errorResponseBuilder: () => ({ statusCode: 429, error: "too_many_requests" }),
  });

  // Ядро не знает, чем логирует витрина — поэтому получает не логгер,
  // а функцию (SOLID-D).
  setSessionTouchFailureReporter((error) => {
    app.log.warn({ err: error }, "не удалось обновить отметку сессии");
  });
  setBusFailureReporter((error) => {
    app.log.warn({ err: error }, "слушатель живых обновлений упал");
  });

  /**
   * Счёт запросов к базе на каждое обращение (task-039, шаг 5). Стенд
   * отдаёт его заголовком `x-db-queries`, и приёмочные ловят по нему N+1:
   * число, растущее вместе с данными. В коробке заголовка нет — наружу
   * устройство базы не рассказываем.
   */
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
    registerWorkRoutes(signedIn);
  });

  return app;
}
