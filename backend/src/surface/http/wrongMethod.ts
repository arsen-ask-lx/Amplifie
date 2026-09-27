import type { FastifyInstance } from "fastify";

/** Метка своих дверей 405: их собственные методы собирать не надо. */
const OWN = "wrongMethod";

/**
 * Путь есть, а метода нет — 405 с заголовком `Allow`, как велит RFC 9110
 * (§15.5.6), а не 404 (task-120, найдено Schemathesis).
 *
 * ⚠️ СВОЁ, А НЕ ПЛАГИН. Fastify отвечает 404 намеренно (fastify/fastify#862).
 * Готовые `fastify-405` и `fastify-allow` почти никто не ставит (десятки
 * загрузок в неделю, 27.09), а `fastify-405` пишет в `Allow` один и тот же
 * список на все пути — то есть неправду. Приём тот же: собрать методы
 * каждого пути крюком `onRoute` и дорегистрировать остальные.
 *
 * Отказ 405 стоит у корня, без проверки сессии: он говорит только о форме
 * API, которая и так описана в `backend/openapi.json`.
 */
export function collectMethods(app: FastifyInstance): () => void {
  const byPath = new Map<string, Set<string>>();
  app.addHook("onRoute", (route) => {
    if ((route.config as Record<string, unknown> | undefined)?.[OWN]) return;
    const methods = byPath.get(route.url) ?? new Set<string>();
    for (const method of [route.method].flat()) methods.add(method);
    byPath.set(route.url, methods);
  });

  /** Звать после всех дверей: путь, объявленный позже, остался бы без 405. */
  return function answerWrongMethods(): void {
    for (const [url, allowed] of byPath) {
      const missing = app.supportedMethods.filter((method) => !allowed.has(method));
      if (missing.length === 0) continue;
      const allow = [...allowed].sort().join(", ");
      app.route({
        method: missing,
        url,
        config: { [OWN]: true },
        schema: { hide: true },
        handler: (_request, reply) =>
          reply.code(405).header("allow", allow).send({ error: "method_not_allowed" }),
      });
    }
  };
}
