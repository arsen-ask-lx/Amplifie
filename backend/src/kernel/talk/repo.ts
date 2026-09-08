import { and, asc, desc, eq, gt, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Executor } from "../../platform/db.js";
import { participant } from "../identity/schema.js";
import { workspace } from "../space/schema.js";
import { conversation, conversationMember, message } from "./schema.js";

/** Слой хранилища модуля talk. Только запросы, никакой логики. */

/**
 * Следующий номер в пространстве.
 *
 * Блокировка строки пространства выстраивает записи в очередь, поэтому номер
 * выдаётся в порядке ФИКСАЦИИ и без дыр. Вызывать только внутри транзакции,
 * которая тут же пишет объект с этим номером.
 */
export async function nextSeq(tx: Executor, workspaceId: string): Promise<number> {
  const rows = await tx
    .update(workspace)
    .set({ lastSeq: sql`${workspace.lastSeq} + 1` })
    .where(eq(workspace.id, workspaceId))
    .returning({ seq: workspace.lastSeq });
  const row = rows[0];
  if (!row) throw new Error("пространство не найдено");
  return Number(row.seq);
}

/**
 * Разговор, видимый данному участнику. Одним запросом, а не двумя.
 *
 * Право читается у КОРНЯ дерева: у ветки своих участников нет
 * (dock/06-разбор-мессенджеров.md). Соединение по COALESCE(parent_id, id)
 * и есть «подняться к корню».
 *
 * Не найдено и не видно — оба случая дают null: наружу это одна и та же
 * ошибка, иначе по ответу перебирают существующие разговоры.
 */
/**
 * ЕДИНСТВЕННОЕ условие видимости (Р-010). Всё, что спрашивает «можно ли
 * это читать», обязано спрашивать здесь — иначе ответов станет два.
 *
 * Два повода сказать «да», но арбитр по-прежнему один:
 *   ① канал открыт всему пространству, и участник — из этого пространства;
 *   ② есть строка членства в КОРНЕ дерева (ветка своих участников не имеет).
 *
 * Членство при этом продолжает отвечать на свой отдельный вопрос —
 * «канал у меня в списке», см. listConversationsFor.
 */
function visibleTo(participantId: string) {
  const rootOf = sql`COALESCE(${conversation.parentId}, ${conversation.id})`;

  const openToMyWorkspace = sql`
    ${conversation.visibility} = 'workspace'
    AND ${conversation.workspaceId} = (
      SELECT ${participant.workspaceId} FROM ${participant}
      WHERE ${participant.id} = ${participantId}
    )`;

  const iAmMemberOfRoot = sql`EXISTS (
    SELECT 1 FROM ${conversationMember}
    WHERE ${conversationMember.conversationId} = ${rootOf}
      AND ${conversationMember.participantId} = ${participantId}
  )`;

  // ⚠️ ВНЕШНИЕ СКОБКИ ОБЯЗАТЕЛЬНЫ. Без них `and(eq(id, ...), visibleTo(...))`
  // склеивается в `id = $1 AND A OR B`, а по приоритету это `(id = $1 AND A)
  // OR B` — и доступ начинает давать членство в ЛЮБОМ другом разговоре.
  // Так и было: чужой канал открывался тому, у кого есть свой.
  // Найдено приёмочным тестом «чужой канал не виден и не читается».
  return sql`((${openToMyWorkspace}) OR (${iAmMemberOfRoot}))`;
}

export async function findVisibleConversation(
  tx: Executor,
  conversationId: string,
  participantId: string,
) {
  const rows = await tx
    .select({
      id: conversation.id,
      workspaceId: conversation.workspaceId,
      kind: conversation.kind,
      parentId: conversation.parentId,
      title: conversation.title,
      visibility: conversation.visibility,
    })
    .from(conversation)
    .where(and(eq(conversation.id, conversationId), visibleTo(participantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertConversation(
  tx: Executor,
  input: {
    workspaceId: string;
    kind: string;
    title: string;
    parentId?: string | null;
    visibility?: string;
  },
) {
  const rows = await tx
    .insert(conversation)
    .values({ ...input, parentId: input.parentId ?? null })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("не удалось создать разговор");
  return row;
}

export async function insertMember(
  tx: Executor,
  input: { conversationId: string; participantId: string; workspaceId: string; role?: string },
) {
  await tx.insert(conversationMember).values(input);
}

/** Разговоры, где участник состоит, плюс их ветки. */
/**
 * Список разговоров — по свежести (Р-011).
 *
 * Порядок по последней активности решает большую часть задачи «сто
 * каналов» сам по себе: в работе человеку почти всегда нужны те же
 * три-пять мест, и они всплывают наверх без всякой раскладки по папкам.
 *
 * Разговор без сообщений не проваливается вниз навсегда: за неимением
 * последнего сообщения берётся время создания. Иначе только что заведённый
 * канал оказывался бы в самом хвосте — там, где его никто не найдёт.
 */
export async function listConversationsFor(tx: Executor, participantId: string) {
  const lastAt = sql<Date>`GREATEST(
    ${conversation.createdAt},
    COALESCE((
      SELECT MAX(${message.createdAt}) FROM ${message}
      WHERE ${message.conversationId} = ${conversation.id}
    ), ${conversation.createdAt})
  )`;

  return tx
    .select({
      id: conversation.id,
      kind: conversation.kind,
      title: conversation.title,
      parentId: conversation.parentId,
      lastAt,
    })
    .from(conversation)
    .where(visibleTo(participantId))
    .orderBy(desc(lastAt));
}

export async function findMessageByClientId(
  tx: Executor,
  conversationId: string,
  clientMsgId: string,
) {
  const rows = await tx
    .select()
    .from(message)
    .where(and(eq(message.conversationId, conversationId), eq(message.clientMsgId, clientMsgId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertMessage(
  tx: Executor,
  input: {
    workspaceId: string;
    conversationId: string;
    authorParticipantId: string;
    body: string;
    clientMsgId: string;
    seq: number;
    kind?: string;
    trust?: string;
    replyToId?: string | null;
    forwardedFromId?: string | null;
  },
) {
  const rows = await tx.insert(message).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("не удалось записать сообщение");
  return row;
}

/**
 * Цитируемое сообщение и его автор — теми же таблицами, но под другими
 * именами (`alias`). Без псевдонима присоединить таблицу к самой себе
 * нельзя: два `message` в одном запросе неразличимы.
 */
const quoted = alias(message, "quoted");
const quotedAuthor = alias(participant, "quoted_author");
const source = alias(message, "source");
const sourceAuthor = alias(participant, "source_author");

/**
 * Единственный список полей сообщения. Все выборки берут его.
 *
 * ⚠️ ЦИТАТА ХРАНИТСЯ ССЫЛКОЙ, А ТЕКСТ ЧИТАЕТСЯ ПРИСОЕДИНЕНИЕМ. Копировать
 * кусок цитируемого текста в само сообщение было бы дешевле в чтении
 * и неверно по сути: правка исходной реплики не дошла бы до цитаты,
 * и две записи одного и того же разошлись бы навсегда.
 *
 * ⚠️ ЛЕВОЕ присоединение, а не внутреннее. Цитата не обязана существовать:
 * ссылка обнуляется при удалении исходной реплики, и внутреннее
 * присоединение выкинуло бы из ленты сам ответ — то есть чужие слова.
 */
const MESSAGE_VIEW = {
  id: message.id,
  conversationId: message.conversationId,
  body: message.body,
  kind: message.kind,
  seq: message.seq,
  createdAt: message.createdAt,
  editedAt: message.editedAt,
  pinnedAt: message.pinnedAt,
  authorId: participant.id,
  authorName: participant.displayName,
  authorKind: participant.kind,
  replyToId: quoted.id,
  replyToSeq: quoted.seq,
  replyToBody: quoted.body,
  replyToAuthorName: quotedAuthor.displayName,
  forwardedFromAuthorName: sourceAuthor.displayName,
} as const;

/**
 * Вид одного сообщения по идентификатору.
 *
 * Нужен там, где сообщение уже записано или уже существовало: строить вид,
 * выбирая «последние N» и разыскивая среди них нужное, — ошибка, из-за
 * которой у повтора терялся автор (найдено 2026-09-06).
 */
export async function findMessageViewById(tx: Executor, messageId: string) {
  const rows = await tx
    .select(MESSAGE_VIEW)
    .from(message)
    .innerJoin(participant, eq(participant.id, message.authorParticipantId))
    .leftJoin(quoted, eq(quoted.id, message.replyToId))
    .leftJoin(quotedAuthor, eq(quotedAuthor.id, quoted.authorParticipantId))
    .leftJoin(source, eq(source.id, message.forwardedFromId))
    .leftJoin(sourceAuthor, eq(sourceAuthor.id, source.authorParticipantId))
    .where(eq(message.id, messageId))
    .limit(1);
  return rows[0] ?? null;
}

/** Сама запись сообщения без вида — для проверок «моё ли, тут ли». */
export async function findMessage(tx: Executor, messageId: string) {
  const rows = await tx.select().from(message).where(eq(message.id, messageId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Правка тела. Отметка «изменено» ставится здесь и только здесь: разнесённая
 * по вызывающим, она однажды не поставится, и лента соврёт.
 */
export async function updateMessageBody(tx: Executor, messageId: string, body: string) {
  const rows = await tx
    .update(message)
    .set({ body, editedAt: new Date() })
    .where(and(eq(message.id, messageId), isNull(message.deletedAt)))
    .returning({ id: message.id });
  return rows[0] ?? null;
}

/** Мягкое удаление: тело стирается, строка остаётся ради ссылок на неё. */
export async function softDeleteMessage(tx: Executor, messageId: string) {
  const rows = await tx
    .update(message)
    // Тело стирается, а не остаётся «на всякий случай»: удалённое сообщение
    // не должно читаться ни из базы, ни из выгрузки.
    .set({ deletedAt: new Date(), body: "" })
    .where(and(eq(message.id, messageId), isNull(message.deletedAt)))
    .returning({ id: message.id, conversationId: message.conversationId });
  return rows[0] ?? null;
}

/** Закрепить или открепить. `null` снимает отметку. */
export async function setPinned(tx: Executor, messageId: string, at: Date | null) {
  const rows = await tx
    .update(message)
    .set({ pinnedAt: at })
    .where(and(eq(message.id, messageId), isNull(message.deletedAt)))
    .returning({ id: message.id });
  return rows[0] ?? null;
}

/** Закреплённые разговора, свежие сверху. Их единицы — предел не нужен. */
export async function listPinned(tx: Executor, conversationId: string) {
  return tx
    .select(MESSAGE_VIEW)
    .from(message)
    .innerJoin(participant, eq(participant.id, message.authorParticipantId))
    .leftJoin(quoted, eq(quoted.id, message.replyToId))
    .leftJoin(quotedAuthor, eq(quotedAuthor.id, quoted.authorParticipantId))
    .leftJoin(source, eq(source.id, message.forwardedFromId))
    .leftJoin(sourceAuthor, eq(sourceAuthor.id, source.authorParticipantId))
    .where(
      and(
        eq(message.conversationId, conversationId),
        isNotNull(message.pinnedAt),
        isNull(message.deletedAt),
      ),
    )
    .orderBy(desc(message.pinnedAt));
}

/**
 * Лента разговора: последние N, отдаются по возрастанию номера.
 *
 * `before` — номер, СТРОГО старше которого нужна страница. Курсор по
 * значению, а не смещение: смещение съезжает, когда во время листания
 * приходит новое сообщение, и страницы начинают и повторяться, и пропадать.
 */
export async function listMessages(
  tx: Executor,
  conversationId: string,
  limit: number,
  before?: number,
) {
  const rows = await tx
    .select(MESSAGE_VIEW)
    .from(message)
    .innerJoin(participant, eq(participant.id, message.authorParticipantId))
    .leftJoin(quoted, eq(quoted.id, message.replyToId))
    .leftJoin(quotedAuthor, eq(quotedAuthor.id, quoted.authorParticipantId))
    .leftJoin(source, eq(source.id, message.forwardedFromId))
    .leftJoin(sourceAuthor, eq(sourceAuthor.id, source.authorParticipantId))
    // ⚠️ Удалённые не отдаются НИ ЗДЕСЬ, НИ В ДОГОНЕ. Забыть одно из двух
    // мест — главный способ провалить мягкое удаление: реплика исчезает
    // из ленты и возвращается первым же обновлением.
    .where(
      and(
        eq(message.conversationId, conversationId),
        isNull(message.deletedAt),
        before === undefined ? undefined : lt(message.seq, before),
      ),
    )
    .orderBy(desc(message.seq))
    .limit(limit);
  return rows.reverse();
}

/**
 * Догон: всё, что появилось в пространстве после номера — но только в тех
 * разговорах, где участник состоит. Проверка членства идёт по КОРНЮ.
 *
 * Выборка ограничена сверху `upToSeq` — той самой границей, которую получит
 * клиент. Без верхней границы это два разных снимка базы: сообщение,
 * зафиксированное между чтением ленты и чтением границы, в ответ не попадёт,
 * а курсор клиента через него перепрыгнет. Проверено опытом: под нагрузкой
 * так терялось около 6% сообщений — навсегда.
 */
export async function listMessagesAfter(
  tx: Executor,
  workspaceId: string,
  participantId: string,
  afterSeq: number,
  upToSeq: number,
  limit: number,
) {
  return tx
    .select(MESSAGE_VIEW)
    .from(message)
    .innerJoin(participant, eq(participant.id, message.authorParticipantId))
    .innerJoin(conversation, eq(conversation.id, message.conversationId))
    .leftJoin(quoted, eq(quoted.id, message.replyToId))
    .leftJoin(quotedAuthor, eq(quotedAuthor.id, quoted.authorParticipantId))
    .leftJoin(source, eq(source.id, message.forwardedFromId))
    .leftJoin(sourceAuthor, eq(sourceAuthor.id, source.authorParticipantId))
    .where(
      and(
        eq(message.workspaceId, workspaceId),
        gt(message.seq, afterSeq),
        lte(message.seq, upToSeq),
        isNull(message.deletedAt),
        visibleTo(participantId),
      ),
    )
    .orderBy(asc(message.seq))
    .limit(limit);
}

/** Текущий номер пространства — верхняя граница догона. */
export async function currentSeq(tx: Executor, workspaceId: string): Promise<number> {
  const rows = await tx
    .select({ seq: workspace.lastSeq })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  return Number(rows[0]?.seq ?? 0);
}
