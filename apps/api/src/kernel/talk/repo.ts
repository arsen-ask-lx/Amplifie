import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
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
    })
    .from(conversation)
    .innerJoin(
      conversationMember,
      and(
        sql`${conversationMember.conversationId} = COALESCE(${conversation.parentId}, ${conversation.id})`,
        eq(conversationMember.participantId, participantId),
      ),
    )
    .where(eq(conversation.id, conversationId))
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
  const roots = tx
    .select({ id: conversationMember.conversationId })
    .from(conversationMember)
    .where(eq(conversationMember.participantId, participantId));

  return tx
    .select({
      id: conversation.id,
      kind: conversation.kind,
      title: conversation.title,
      parentId: conversation.parentId,
    })
    .from(conversation)
    .where(sql`${conversation.id} IN ${roots} OR ${conversation.parentId} IN ${roots}`)
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

/** Лента разговора: последние N, отдаются по возрастанию номера. */
export async function listMessages(tx: Executor, conversationId: string, limit: number) {
  const rows = await tx
    .select(MESSAGE_VIEW)
    .from(message)
    .innerJoin(participant, eq(participant.id, message.authorParticipantId))
    .where(eq(message.conversationId, conversationId))
    .orderBy(desc(message.seq))
    .limit(limit);
  return rows.reverse();
}

/**
 * Догон: всё, что появилось в пространстве после номера — но только в тех
 * разговорах, где участник состоит. Проверка членства идёт по КОРНЮ.
 */
export async function listMessagesAfter(
  tx: Executor,
  workspaceId: string,
  participantId: string,
  afterSeq: number,
  limit: number,
) {
  const roots = tx
    .select({ id: conversationMember.conversationId })
    .from(conversationMember)
    .where(eq(conversationMember.participantId, participantId));

  return tx
    .select(MESSAGE_VIEW)
    .from(message)
    .innerJoin(participant, eq(participant.id, message.authorParticipantId))
    .innerJoin(conversation, eq(conversation.id, message.conversationId))
    .where(
      and(
        eq(message.workspaceId, workspaceId),
        gt(message.seq, afterSeq),
        sql`COALESCE(${conversation.parentId}, ${conversation.id}) IN ${roots}`,
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
