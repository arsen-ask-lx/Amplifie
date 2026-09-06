import { db, type Executor, withTransaction } from "../../platform/db.js";
import { appendEvent } from "../journal/index.js";
import * as repo from "./repo.js";

/** Разговора нет ЛИБО он тебе не виден — снаружи это одно и то же. */
export class ConversationNotVisibleError extends Error {}

export interface Viewer {
  participantId: string;
  workspaceId: string;
}

export interface MessageView {
  id: string;
  conversationId: string;
  body: string;
  kind: string;
  seq: number;
  createdAt: Date;
  editedAt: Date | null;
  author: { id: string; name: string; kind: string };
}

function presentMessage(row: Awaited<ReturnType<typeof repo.listMessages>>[number]): MessageView {
  return {
    id: row.id,
    conversationId: row.conversationId,
    body: row.body,
    kind: row.kind,
    seq: Number(row.seq),
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    author: { id: row.authorId, name: row.authorName, kind: row.authorKind },
  };
}

/** Вид сообщения по идентификатору. Одно место, где он собирается. */
async function viewOf(tx: Executor, messageId: string): Promise<MessageView> {
  const row = await repo.findMessageViewById(tx, messageId);
  if (!row) throw new Error(`сообщение ${messageId} записано, но не читается обратно`);
  return presentMessage(row);
}

/** Нарушение UNIQUE(conversation_id, client_msg_id) — тот же ключ пришёл дважды. */
function isDuplicateClientMsgId(error: unknown): boolean {
  const candidate = error as { code?: unknown; constraint?: unknown; cause?: unknown };
  const code = candidate?.code ?? (candidate?.cause as { code?: unknown } | undefined)?.code;
  const constraint =
    candidate?.constraint ?? (candidate?.cause as { constraint?: unknown } | undefined)?.constraint;
  return code === "23505" && constraint === "message_conversation_client_msg_uq";
}

/**
 * Проверка доступа. Единственная точка, где решается «видно или нет».
 *
 * Право читается у КОРНЯ дерева разговоров: у ветки своих участников нет
 * (dock/06-разбор-мессенджеров.md). Не найдено и не видно — одна и та же
 * ошибка, чтобы по ответу нельзя было перебрать существующие разговоры.
 */
async function requireVisible(tx: Executor, viewer: Viewer, conversationId: string) {
  const found = await repo.findVisibleConversation(tx, conversationId, viewer.participantId);
  // Проверка арендатора остаётся, хотя членство её почти всегда покрывает:
  // это последний рубеж на случай, если участник когда-нибудь окажется
  // в разговоре чужого пространства.
  if (!found || found.workspaceId !== viewer.workspaceId) {
    throw new ConversationNotVisibleError();
  }
  return found;
}

export async function listConversations(viewer: Viewer) {
  const rows = await repo.listConversationsFor(db, viewer.participantId);
  return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, parentId: r.parentId }));
}

export async function listMessages(viewer: Viewer, conversationId: string, limit: number) {
  await requireVisible(db, viewer, conversationId);
  const rows = await repo.listMessages(db, conversationId, limit);
  return rows.map(presentMessage);
}

export interface SendResult {
  message: MessageView;
  /** true — сообщение уже было: клиент повторил отправку после разрыва. */
  replayed: boolean;
}

/**
 * Отправка сообщения.
 *
 * Идемпотентность доменная: ключ `clientMsgId` генерирует клиент в момент
 * набора. Повтор — не ошибка, а нормальная работа клиента после разрыва:
 * возвращаем то же самое сообщение и тот же номер.
 */
export async function sendMessage(
  viewer: Viewer,
  conversationId: string,
  input: { body: string; clientMsgId: string },
): Promise<SendResult> {
  try {
    return await withTransaction(async (tx) => {
      const target = await requireVisible(tx, viewer, conversationId);

      const already = await repo.findMessageByClientId(tx, conversationId, input.clientMsgId);
      if (already) return { replayed: true, message: await viewOf(tx, already.id) };

      // Номер берётся ТОЛЬКО так и только внутри этой же транзакции.
      // Важно, что это UPDATE строки, а не последовательность: при откате
      // номер возвращается обратно и дыры не остаётся.
      const seq = await repo.nextSeq(tx, target.workspaceId);

      const created = await repo.insertMessage(tx, {
        workspaceId: target.workspaceId,
        conversationId,
        authorParticipantId: viewer.participantId,
        body: input.body,
        clientMsgId: input.clientMsgId,
        seq,
      });

      // Состояние и событие — в одной транзакции. Всегда (Р-2).
      await appendEvent(tx, {
        kind: "message.sent",
        workspaceId: target.workspaceId,
        actorParticipantId: viewer.participantId,
        subjectType: "message",
        subjectId: created.id,
        payload: { conversationId, seq },
      });

      return { replayed: false, message: await viewOf(tx, created.id) };
    });
  } catch (error) {
    // Гонка: два запроса с одним ключом ушли одновременно и оба прошли
    // проверку «уже есть». Проигравший откатывается — номер возвращается
    // счётчику, дыры не остаётся, — и получает то же сообщение.
    // Без этой ветки двойной клик давал бы пятисотку.
    if (!isDuplicateClientMsgId(error)) throw error;

    const existing = await repo.findMessageByClientId(db, conversationId, input.clientMsgId);
    if (!existing) throw error;
    return { replayed: true, message: await viewOf(db, existing.id) };
  }
}

export async function createThread(viewer: Viewer, parentId: string, title: string) {
  return withTransaction(async (tx) => {
    const parent = await requireVisible(tx, viewer, parentId);
    if (parent.parentId) {
      // Ветка от ветки не заводится: дерево ровно двухуровневое, иначе
      // «корень» перестаёт быть однозначным.
      throw new ConversationNotVisibleError();
    }

    const created = await repo.insertConversation(tx, {
      workspaceId: parent.workspaceId,
      kind: "thread",
      title,
      parentId,
    });

    // ⚠️ Участников ветке НЕ заводим: право наследуется от канала.
    // База это и не позволит — триггер conversation_member_root_only.

    await appendEvent(tx, {
      kind: "thread.created",
      workspaceId: parent.workspaceId,
      actorParticipantId: viewer.participantId,
      subjectType: "conversation",
      subjectId: created.id,
      payload: { parentId, title },
    });

    return { id: created.id, kind: created.kind, title: created.title, parentId };
  });
}

/** Догон: что появилось после номера, и текущая верхняя граница. */
export async function sync(viewer: Viewer, afterSeq: number, limit: number) {
  const [rows, seq] = await Promise.all([
    repo.listMessagesAfter(db, viewer.workspaceId, viewer.participantId, afterSeq, limit),
    repo.currentSeq(db, viewer.workspaceId),
  ]);
  return { messages: rows.map(presentMessage), seq };
}

/**
 * Первый канал пространства. Заводится при регистрации, а не миграцией:
 * миграция не знает идентификатор пространства.
 */
export async function createDefaultChannel(
  tx: Executor,
  input: { workspaceId: string; participantId: string; title: string },
) {
  const channel = await repo.insertConversation(tx, {
    workspaceId: input.workspaceId,
    kind: "channel",
    title: input.title,
  });
  await repo.insertMember(tx, {
    conversationId: channel.id,
    participantId: input.participantId,
    workspaceId: input.workspaceId,
    role: "owner",
  });

  // Изменение состояния и событие — в одной транзакции. Без исключений (Р-2):
  // первая же «мелочь без события» превращает журнал в тот, которому нельзя
  // доверять. Эта строка была пропущена и найдена проверкой журнала.
  await appendEvent(tx, {
    kind: "conversation.created",
    workspaceId: input.workspaceId,
    actorParticipantId: input.participantId,
    subjectType: "conversation",
    subjectId: channel.id,
    payload: { kind: "channel", title: channel.title },
  });

  return channel;
}
