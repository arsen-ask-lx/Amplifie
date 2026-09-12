import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from "fastify";
import { type Actor, resolveActor } from "../../../kernel/identity/index.js";

/**
 * Имя печеньки сессии.
 *
 * Живёт в листовом модуле: печеньку ставит вход, а читают её все двери.
 * Лежи имя у входа — каждая дверь тянула бы весь модуль входа, и гейт
 * границ уже ловил на этом цикл.
 */
export const SESSION_COOKIE = "amplifie_session";

declare module "fastify" {
  interface FastifyRequest {
    /** Кто пришёл. Заполняет `requireSession`; вне его области — `null`. */
    actor: Actor | null;
  }
}

/**
 * Проверить сессию и положить человека в запрос. Нет сессии — 401.
 *
 * ⚠️ ПОСЛЕ ПОРОГА ЧАСТОТЫ, А НЕ ДО. Проверка ходит в базу; стоит она
 * раньше порога — поток запросов с выдуманными печеньками оплачивался бы
 * запросом к базе на каждую попытку. Порог вешается на маршрут в том же
 * `preValidation` при его объявлении, поэтому проверка дописывается
 * В КОНЕЦ того же списка, а не общим хуком области: общий хук области
 * выполняется раньше хуков маршрута.
 */
async function checkSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const actor = await resolveActor(request.cookies[SESSION_COOKIE]);
  if (!actor) {
    await reply.code(401).send({ error: "not_authenticated" });
    return;
  }
  request.actor = actor;
}

/**
 * Все двери этой области требуют сессии (task-039, шаг 2).
 *
 * Одно место на все двери вместо двух строк в каждой. Строк было
 * тридцать девять в шести файлах, и одна из копий жила своей жизнью.
 */
export function requireSession(scope: FastifyInstance): void {
  scope.decorateRequest("actor", null);
  scope.addHook("onRoute", (route: RouteOptions) => {
    const before = route.preValidation;
    route.preValidation = [
      ...(before === undefined ? [] : Array.isArray(before) ? before : [before]),
      checkSession,
    ];
  });
}

/**
 * Кто пришёл — в двери области `requireSession`.
 *
 * Бросает, а не отдаёт `null`: попасть сюда без сессии можно только
 * ошибкой в раскладке дверей, и такая ошибка обязана быть громкой.
 */
export function actorOf(request: FastifyRequest): Actor {
  if (!request.actor) throw new Error("дверь объявлена вне области requireSession");
  return request.actor;
}
