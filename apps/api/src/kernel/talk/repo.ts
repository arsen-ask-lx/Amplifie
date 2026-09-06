import { and, asc, desc, eq, gt, isNull, lt, lte, sql } from "drizzle-orm";
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
export async function listConversationsFor(tx: Executor, participantId: string) {
  return tx
    .select({
      id: conversation.id,
      kind: conversation.kind,
      title: conversation.title,
      parentId: conversation.parentId,
    })
    .from(conversation)
    .where(visibleTo(participantId))
    .orderBy(asc(conversation.createdAt));
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
  },
) {
  const rows = await tx.insert(message).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("не удалось записать сообщение");
  return row;
}

const MESSAGE_VIEW = {
  id: message.id,
  conversationId: message.conversationId,
  body: message.body,
  kind: message.kind,
  seq: message.seq,
  createdAt: message.createdAt,
  editedAt: message.editedAt,
  authorId: participant.id,
  authorName: participant.displayName,
  authorKind: participant.kind,
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
    .where(eq(message.id, messageId))
    .limit(1);
  return rows[0] ?? null;
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
    .where(
      before === undefined
        ? eq(message.conversationId, conversationId)
        : and(eq(message.conversationId, conversationId), lt(message.seq, before)),
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
    .where(
      and(
        eq(message.workspaceId, workspaceId),
        gt(message.seq, afterSeq),
        lte(message.seq, upToSeq),
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

/** Единственный канал пространства — нужен при регистрации. */
export async function findRootChannel(tx: Executor, workspaceId: string) {
  const rows = await tx
    .select()
    .from(conversation)
    .where(
      and(
        eq(conversation.workspaceId, workspaceId),
        eq(conversation.kind, "channel"),
        isNull(conversation.parentId),
      ),
    )
    .orderBy(asc(conversation.createdAt))
    .limit(1);
  return rows[0] ?? null;
}
