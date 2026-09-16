import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from "fastify";
import { type Actor, resolveActor } from "../../../kernel/identity/index.js";
import { INVALID_SESSIONS } from "../limits.js";
import { gateWait, noteConfirmed, noteFailure } from "../sessionGate.js";

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
 * ⚠️ ПОСЛЕ ОБЩЕГО ПОРОГА И БАРЬЕРА, А НЕ ДО. Проверка ходит в базу. Перед ней
 * стоят: общий порог по адресу (у дверей без своего порога, в том же
 * `preValidation`, поэтому проверка дописывается В КОНЕЦ списка) и барьер
 * выдуманных печенек (`sessionGate.ts`). Пороги по человеку — после неё,
 * в `preHandler`: ключ им нужен настоящий, а не строка печеньки (task-093).
 */
async function checkSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  // Без печеньки база не спрашивается — и барьеру здесь нечего беречь.
  if (token) {
    const wait = gateWait(request.ip, token, INVALID_SESSIONS.max);
    if (wait !== null) {
      await reply
        .code(429)
        .header("retry-after", String(wait))
        .send({ error: "too_many_requests" });
      return;
    }
  }

  const actor = await resolveActor(token);
  if (!actor) {
    if (token) noteFailure(request.ip);
    await reply.code(401).send({ error: "not_authenticated" });
    return;
  }
  if (token) noteConfirmed(token);
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
