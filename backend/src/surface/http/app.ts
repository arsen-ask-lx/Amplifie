import { failure } from "@amplifie/contract/api";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "@fastify/type-provider-zod";
import Fastify, { type FastifyInstance } from "fastify";
import { setSessionTouchFailureReporter } from "../../kernel/identity/index.js";
import { audienceFor } from "../../kernel/talk/index.js";
import { setAudienceResolver, setBusFailureReporter } from "../../platform/bus.js";
import { config } from "../../platform/config.js";
import { countQueries, queriesSoFar } from "../../platform/db.js";
import { answered } from "../../platform/metrics.js";
import { answerKnownFailures } from "./failures.js";
import { OVERALL } from "./limits.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerAccountRoutes, registerAuthRoutes } from "./routes/auth.js";
import { registerBridgeHumanRoutes, registerBridgeMachineRoutes } from "./routes/bridge.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { registerStreamRoutes } from "./routes/stream.js";
import { requireSession, SESSION_COOKIE } from "./routes/viewer.js";
import { collectMethods } from "./wrongMethod.js";

/**
 * `describeApi` — собрать описание API (task-120, Р-049). Только для
 * `npm run openapi`: рабочему процессу сборщик описания не нужен, и дверей
 * `/docs` или `/openapi.json` наружу нет.
 */
export async function buildApp({ describeApi = false } = {}): Promise<FastifyInstance> {
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

  // Кому виден разговор — знает ядро; шина этого знать не должна и не может
  // (гейт границ ловит обратный импорт). Без этой строки шина молчит
  // и жалуется — закрывается, а не открывается (task-067).
  setAudienceResolver(audienceFor);

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
  // До маршрутов: сборщик описания видит только двери, объявленные после него.
  if (describeApi) await describeDoors(app);
  // До маршрутов: 405 знает методы только тех дверей, что объявлены после.
  const answerWrongMethods = collectMethods(app);

  /**
   * Всякий ответ — три числа RED разом: частота, доля неудачных,
   * время. Общим крюком, а не в каждой двери: тогда новая дверь
   * не может забыть себя посчитать.
   *
   * Имя двери — шаблон маршрута, а не адрес: иначе меток стало бы
   * столько же, сколько разговоров, и метрики съели бы память.
   */
  app.addHook("onResponse", async (request, reply) => {
    answered(request.routeOptions.url ?? "неизвестная", reply.statusCode, reply.elapsedTime / 1000);
  });

  // Открытые двери: здоровье, вход и машина моста со своим удостоверением.
  registerHealthRoutes(app);
  registerMetricsRoutes(app);
  registerAuthRoutes(app);
  registerBridgeMachineRoutes(app);

  // Всё остальное — только с сессией. Проверка стоит у области, а не
  // в каждой двери: новая дверь, объявленная здесь, не может её забыть.
  await app.register(async (signedIn) => {
    requireSession(signedIn);
    if (describeApi) markSessionRequired(signedIn);
    registerAccountRoutes(signedIn);
    registerBridgeHumanRoutes(signedIn);
    registerAgentRoutes(signedIn);
    registerChatRoutes(signedIn);
    registerStreamRoutes(signedIn);
  });
  answerWrongMethods();

  return app;
}

/** Схема безопасности описания — печенька сессии, та же, что ставит вход. */
const SESSION_SCHEME = "session";

async function describeDoors(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: "Amplifie API", version: "1" },
      components: {
        securitySchemes: {
          [SESSION_SCHEME]: { type: "apiKey", in: "cookie", name: SESSION_COOKIE },
          // Удостоверение машины моста: `Authorization: Bridge <токен>`, не сессия.
          bridge: { type: "apiKey", in: "header", name: "authorization" },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  app.addHook("onRoute", (route) => {
    const schema = route.schema ?? {};
    const own = (schema.response ?? {}) as Record<number, unknown>;
    // Отказы, которые дверь отдаёт по своему устройству, а не по делу:
    // порог частоты — общий потолок у всех; схема входа — там, где он есть;
    // «не видно» — у двери с номером в пути (чужое неотличимо от несуществующего).
    const general: Record<number, unknown> = { 429: failure };
    // Кривое тело (не JSON, длина не та) отвергает разборщик Fastify — до схемы.
    if (route.method !== "GET") general[400] = failure;
    if (schema.body || schema.querystring || schema.params) general[422] = failure;
    if (schema.params) general[404] = failure;
    route.schema = { ...schema, response: { ...general, ...own } };
  });
}

/**
 * Двери области сессии помечаются в описании как требующие её — крюком
 * самой области, а не списком адресов: новая дверь пометится сама, как сама
 * получает проверку сессии. Без пометки Schemathesis не проверит 401.
 */
function markSessionRequired(scope: FastifyInstance): void {
  scope.addHook("onRoute", (route) => {
    const response = { 401: failure, ...((route.schema?.response ?? {}) as object) };
    route.schema = { ...route.schema, response, security: [{ [SESSION_SCHEME]: [] }] };
  });
}
