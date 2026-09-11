import { eq, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Executor } from "../../platform/db.js";
import { conversation, conversationRead, message, messageMention } from "./schema.js";

/**
 * Непрочитанное: сколько не видел, звали ли, докуда дочитал (Р-029, Р-031).
 *
 * ⚠️ СВОЙ ФАЙЛ, ПОТОМУ ЧТО СВОЙ ВОПРОС. Хранилище разговоров отвечает
 * на «какие есть и что в них», а здесь — «что человек ещё не видел».
 * Счёт и отметка обязаны знать одно правило — «дальше номера прочтения», —
 * и держать их рядом — единственный способ его не развести.
 */

/**
 * Сколько чужих реплик человек ещё не видел в НАЗВАННОМ разговоре.
 *
 * ⚠️ СЧИТАЕТСЯ, А НЕ ХРАНИТСЯ (Р-029). Хранимое число — второй источник
 * правды о том же факте, и оно разойдётся с репликами при первом же
 * удалении. Индекс `(conversation_id, seq)` для этого счёта уже есть.
 *
 * ⚠️ СВОИ РЕПЛИКИ НЕ СЧИТАЮТСЯ. Автор уже видел то, что написал, —
 * иначе счётчик рос бы от собственного письма.
 *
 * ⚠️ ПОТОЛОК В ТЫСЯЧУ, И ОН НЕ ДЛЯ КРАСОТЫ. Выше тысячи число на экране
 * всё равно показывается как «999+», а `LIMIT` внутри превращает счёт
 * по огромному каналу в счёт по первой тысяче строк индекса.
 */
const UNREAD_CAP = 1000;

export function unreadOf(conversationId: PgColumn | SQL | string, participantId: string) {
  return sql<number>`(
    SELECT count(*)::int FROM (
      SELECT 1 FROM ${message}
      WHERE ${message.conversationId} = ${conversationId}
        AND ${message.authorParticipantId} <> ${participantId}
        AND ${message.deletedAt} IS NULL
        AND ${message.seq} > COALESCE((
          SELECT ${conversationRead.readSeq} FROM ${conversationRead}
          WHERE ${conversationRead.conversationId} = ${conversationId}
            AND ${conversationRead.participantId} = ${participantId}
        ), 0)
      LIMIT ${UNREAD_CAP}
    ) AS невидённые
  )`;
}

/**
 * Непрочитанное в одном разговоре — после отметки.
 *
 * ⚠️ ЧЕРЕЗ `select`, А НЕ ЧЕРЕЗ `execute`, И ЭТО НЕ ВКУСОВЩИНА. Сперва
 * здесь стоял `tx.execute(sql...)` — он возвращает не список строк,
 * а ответ драйвера целиком, и чтение `[0]` давало `undefined`. Счётчик
 * молча оказывался нулём: ни ошибки, ни исключения, просто «всё
 * прочитано». Ровно тот отказ, от которого мы защищаемся всей задачей.
 *
 * Теперь путь один и тот же, что у списка разговоров, — значит и ломаться
 * им предстоит вместе, а не по отдельности.
 */
export async function countUnread(
  tx: Executor,
  conversationId: string,
  participantId: string,
): Promise<number> {
  const rows = await tx
    .select({ n: unreadOf(conversationId, participantId) })
    .from(conversation)
    .where(eq(conversation.id, conversationId))
    .limit(1);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Сколько раз в разговоре позвали этого человека и он этого не видел.
 *
 * ⚠️ СВОИ ЗОВЫ НЕ СЧИТАЮТСЯ — по той же причине, что и свои реплики
 * в непрочитанном: человек уже видел то, что написал сам.
 *
 * ⚠️ ВТОРОГО СОСТОЯНИЯ ПРОЧТЕНИЯ НЕТ. Упоминание неувидено ровно до тех
 * пор, пока номер прочтения не прошёл дальше номера сообщения (Р-029).
 * Заведи мы отдельную отметку — у человека появилось бы два разных
 * «прочитано», и они разошлись бы молча.
 */
export function mentionsOf(conversationId: PgColumn | SQL | string, participantId: string) {
  return sql<number>`(
    SELECT count(*)::int FROM (
      SELECT 1 FROM ${message}
      JOIN ${messageMention} ON ${messageMention.messageId} = ${message.id}
      WHERE ${message.conversationId} = ${conversationId}
        AND ${messageMention.participantId} = ${participantId}
        AND ${message.authorParticipantId} <> ${participantId}
        AND ${message.deletedAt} IS NULL
        AND ${message.seq} > COALESCE((
          SELECT ${conversationRead.readSeq} FROM ${conversationRead}
          WHERE ${conversationRead.conversationId} = ${conversationId}
            AND ${conversationRead.participantId} = ${participantId}
        ), 0)
      LIMIT ${UNREAD_CAP}
    ) AS незамеченные
  )`;
}

/**
 * Отметить прочитанным всё до номера включительно.
 *
 * ⚠️ ТОЛЬКО ВПЕРЁД, И ЭТО ГЛАВНАЯ СТРОКА ВСЕЙ ЗАТЕИ. `GREATEST` вместо
 * присваивания — защита от того, что две вкладки одного человека шлют
 * «дочитал» вразнобой: первая долистала до конца, вторая стояла на
 * старом месте и отправила свой номер ПОЗЖЕ. Присваивание откатило бы
 * прочитанное, и непрочитанное воскресло бы само (Р-029).
 *
 * Отметить прочитанным то, чего человек не видел, нечем отменить —
 * поэтому откат запрещён базой, а не порядком вызовов.
 *
 * ⚠️ ВСТАВКА С ДОПИСЫВАНИЕМ, А НЕ `UPDATE`, И ЭТО ИСПРАВЛЕНИЕ ОТКАЗА.
 * Сперва здесь стоял `UPDATE conversation_member`, и его пустой результат
 * служил заодно проверкой права. Приём хороший, но опора неверная:
 * строки участника у читателя может не быть вовсе — канал открыт всему
 * пространству. У всех, кто вошёл позже заведения канала, отметка
 * не находила строки, отвечала 404 и глохла; число непрочитанного
 * не гасло никогда. Поймал владелец на «Демо».
 *
 * Право теперь проверяется ВИДИМОСТЬЮ разговора — до вызова, в службе.
 * Здесь только запись.
 */
export async function markRead(
  tx: Executor,
  conversationId: string,
  participantId: string,
  seq: number,
): Promise<void> {
  await tx
    .insert(conversationRead)
    .values({ conversationId, participantId, readSeq: seq })
    .onConflictDoUpdate({
      target: [conversationRead.conversationId, conversationRead.participantId],
      set: { readSeq: sql`GREATEST(${conversationRead.readSeq}, ${seq})` },
    });
}
