import { eq, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Executor } from "../../platform/db.js";
import { conversation, conversationRead, message, messageMention } from "./schema.js";

/**
 * Непрочитанное: сколько не видел, звали ли, докуда дочитал (Р-029, Р-031).
 * Счёт и отметка знают одно правило «дальше номера прочтения» — поэтому рядом.
 */

/**
 * Потолок счёта: выше тысячи экран всё равно пишет «999+», а `LIMIT`
 * превращает счёт по огромному каналу в первую тысячу строк индекса.
 */
const UNREAD_CAP = 1000;

/**
 * Единственное правило «человек этой реплики ещё не видел» (Р-029): чужая,
 * живая и дальше его номера прочтения. Число не хранится, а считается —
 * хранимое разошлось бы с репликами при первом удалении. Свои не считаются.
 */
export function unseenBy(conversationId: PgColumn | SQL | string, participantId: string): SQL {
  return sql`${message.authorParticipantId} <> ${participantId}
    AND ${message.deletedAt} IS NULL
    AND ${message.seq} > COALESCE((
      SELECT ${conversationRead.readSeq} FROM ${conversationRead}
      WHERE ${conversationRead.conversationId} = ${conversationId}
        AND ${conversationRead.participantId} = ${participantId}
    ), 0)`;
}

export function unreadOf(conversationId: PgColumn | SQL | string, participantId: string) {
  return sql<number>`(
    SELECT count(*)::int FROM (
      SELECT 1 FROM ${message}
      WHERE ${message.conversationId} = ${conversationId}
        AND ${unseenBy(conversationId, participantId)}
      LIMIT ${UNREAD_CAP}
    ) AS unseen
  )`;
}

/**
 * Непрочитанное в одном разговоре — после отметки. Через `select`, а не
 * `execute`: `execute` отдаёт ответ драйвера целиком, и `[0]` молча давал ноль.
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
 * Своего «прочитано» у зова нет: он неувиден, пока не увидена реплика.
 */
export function mentionsOf(conversationId: PgColumn | SQL | string, participantId: string) {
  return sql<number>`(
    SELECT count(*)::int FROM (
      SELECT 1 FROM ${message}
      JOIN ${messageMention} ON ${messageMention.messageId} = ${message.id}
      WHERE ${message.conversationId} = ${conversationId}
        AND ${messageMention.participantId} = ${participantId}
        AND ${unseenBy(conversationId, participantId)}
      LIMIT ${UNREAD_CAP}
    ) AS unnoticed
  )`;
}

/**
 * Отметить прочитанным всё до номера включительно.
 *
 * Только вперёд (`GREATEST`): две вкладки шлют «дочитал» вразнобой,
 * и отставшая не должна воскресить прочитанное (Р-029).
 *
 * Вставка с дописыванием, а не `UPDATE` строки участника: канал открыт
 * всему пространству, и у вошедшего позже строки участника нет. Право
 * проверяет служба видимостью разговора — до вызова.
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
