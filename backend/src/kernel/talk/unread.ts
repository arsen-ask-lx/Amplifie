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

type ConversationRef = PgColumn | SQL | string;

/** Часть правила: реплика дальше номера прочтения этого человека. */
function afterReadMark(conversationId: ConversationRef, participantId: string): SQL {
  return sql`${message.seq} > COALESCE((
      SELECT ${conversationRead.readSeq} FROM ${conversationRead}
      WHERE ${conversationRead.conversationId} = ${conversationId}
        AND ${conversationRead.participantId} = ${participantId}
    ), 0)`;
}

/** Часть правила: реплика чужая и живая. */
function othersAlive(participantId: string): SQL {
  return sql`${message.authorParticipantId} <> ${participantId}
    AND ${message.deletedAt} IS NULL`;
}

/**
 * Единственное правило «человек этой реплики ещё не видел» (Р-029): чужая,
 * живая и дальше его номера прочтения — две части выше. Число не хранится,
 * а считается: хранимое разошлось бы с репликами при первом удалении.
 */
export function unseenBy(conversationId: ConversationRef, participantId: string): SQL {
  return sql`${othersAlive(participantId)} AND ${afterReadMark(conversationId, participantId)}`;
}

/**
 * Сколько не видел. Сначала по индексу `(conversation_id, seq)` берётся
 * не больше тысячи реплик после отметки, и только среди них отсеиваются
 * свои и удалённые. Вместе условия давали бы план по статистике: где один
 * человек написал почти всё, планировщик выбирал обход всей таблицы.
 * `LIMIT` во вложенном запросе — граница, через которую условия не перетекут;
 * псевдоним `message` — чтобы внешнее условие читало колонки вложенного.
 */
export function unreadOf(conversationId: ConversationRef, participantId: string) {
  return sql<number>`(
    SELECT count(*)::int FROM (
      SELECT ${message.authorParticipantId}, ${message.deletedAt} FROM ${message}
      WHERE ${message.conversationId} = ${conversationId}
        AND ${afterReadMark(conversationId, participantId)}
      ORDER BY ${message.seq}
      LIMIT ${UNREAD_CAP}
    ) AS ${message}
    WHERE ${othersAlive(participantId)}
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
 * Докуда человек дочитал и какая реплика первая непрочитанная (task-107).
 *
 * ⚠️ ДВА ЧИСЛА ОДНИМ ЗАПРОСОМ, И ОБА НУЖНЫ ЛЕНТЕ. По первому она рисует
 * черту, вокруг второго открывает окно. Отметки может не быть вовсе —
 * тогда ноль: «не читал ничего», и первой непрочитанной будет самая ранняя
 * чужая реплика.
 *
 * ⚠️ ПЕРВАЯ НЕПРОЧИТАННАЯ — ЧУЖАЯ. Своя непрочитанной не бывает (Р-029),
 * и открывать чат на собственной реплике значило бы врать чертой.
 *
 * Цена: 7 буферов на базе в 200 тыс. реплик — обе половины идут по индексу
 * `(conversation_id, seq)` (замер 18.09).
 */
export async function readStateOf(
  tx: Executor,
  conversationId: string,
  participantId: string,
): Promise<{ readSeq: number; firstUnread: number | null }> {
  const rows = await tx
    .select({
      readSeq: sql<number>`COALESCE((
        SELECT ${conversationRead.readSeq} FROM ${conversationRead}
        WHERE ${conversationRead.conversationId} = ${conversationId}
          AND ${conversationRead.participantId} = ${participantId}
      ), 0)::int`,
      firstUnread: sql<number | null>`(
        SELECT ${message.seq} FROM ${message}
        WHERE ${message.conversationId} = ${conversationId}
          AND ${unseenBy(conversationId, participantId)}
        ORDER BY ${message.seq}
        LIMIT 1
      )::int`,
    })
    .from(conversation)
    .where(eq(conversation.id, conversationId))
    .limit(1);
  const row = rows[0];
  return {
    readSeq: Number(row?.readSeq ?? 0),
    firstUnread:
      row?.firstUnread === null || row?.firstUnread === undefined ? null : Number(row.firstUnread),
  };
}

/**
 * Сколько раз в разговоре позвали этого человека и он этого не видел.
 * Своего «прочитано» у зова нет: он неувиден, пока не увидена реплика.
 */
export function mentionsOf(conversationId: ConversationRef, participantId: string) {
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
