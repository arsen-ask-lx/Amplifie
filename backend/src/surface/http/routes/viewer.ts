import type { FastifyReply, FastifyRequest } from "fastify";
import { type Actor, resolveActor } from "../../../kernel/identity/index.js";

/**
 * Имя печеньки сессии.
 *
 * ⚠️ ЖИВЁТ ЗДЕСЬ, А НЕ В `auth.ts`, И ЭТО НЕ ВКУСОВЩИНА. Печеньку ставит
 * вход, а ЧИТАЮТ её все ручки до одной. Пока имя лежало у входа, каждая
 * ручка тянула за собой весь модуль входа, а когда вход потянул обратно
 * проверку права — получился цикл, и гейт границ его поймал. Здесь модуль
 * листовой: он не импортирует ничего из соседей и потому не может замкнуть
 * ни один клубок.
 */
export const SESSION_COOKIE = "amplifie_session";

/**
 * Кто спрашивает. Одно место на все ручки.
 *
 * ⚠️ БЫЛО ЧЕТЫРЕ КОПИИ — в `agents`, `work`, `bridge` и `auth`, — и гейт
 * повторов был прав. Опасность здесь не в лишних строках: это ПРОВЕРКА
 * ПРАВА. Четыре копии означают четыре места, где однажды забудут ответить
 * отказом, и три из них никто не заметит. Ровно этот класс ошибки описан
 * в Р-009: путей входа оказалось больше одного, и лишний забыли проверить.
 *
 * Отказ отправляется ЗДЕСЬ, а наружу отдаётся `null`: вызывающему остаётся
 * `if (!who) return reply;` — забыть эту строку нельзя, TypeScript
 * не даст обратиться к полям `null`.
 */
export async function viewerOf(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Actor | null> {
  const actor = await resolveActor(request.cookies[SESSION_COOKIE]);
  if (!actor) {
    reply.code(401).send({ error: "not_authenticated" });
    return null;
  }
  return actor;
}
