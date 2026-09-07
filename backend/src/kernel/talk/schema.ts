import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { participant } from "../identity/schema.js";
import { workspace } from "../space/schema.js";

/**
 * Разговор — ОДНА сущность на все виды: канал, ветка, встреча, обсуждение
 * документа, личка (Р-4).
 *
 * Одна, потому что «как агент слушает разговор» — одно знание. Заведи четыре
 * сущности — напишешь слушание четыре раза, и через полгода они разъедутся:
 * в каналах агент предлагает задачи, а в расшифровках встреч почему-то нет.
 */
export const conversation = pgTable(
  "conversation",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /**
     * Кому виден (Р-010). `workspace` — всему пространству, `private` —
     * только тем, у кого есть строка членства.
     *
     * Видимость — свойство КАНАЛА, а не список участников. Членство
     * отвечает на другой вопрос: «канал у меня в списке». Так же устроено
     * у Slack и Discord; слитые вместе, эти два вопроса ломают продукт
     * ровно в тот день, когда в пространстве появляется второй человек.
     *
     * У ветки поле не читается: ветка наследует видимость корня.
     */
    visibility: text("visibility").notNull().default("workspace"),
    /**
     * Ветка — это разговор с родителем. Отдельная сущность, а не строка
     * в сообщении: у Zulip тема хранится строкой, и они сами об этом жалеют —
     * переименование переписывает ВСЕ сообщения (их issue #1191).
     */
    parentId: uuid("parent_id").references((): AnyPgColumn => conversation.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversation_workspace_parent_idx").on(t.workspaceId, t.parentId)],
);

/**
 * Кто в разговоре. ⚠️ Заполняется ТОЛЬКО для корня (канал, личка).
 *
 * У ветки своих участников нет — ни у Zulip, ни у Slack. Право читается
 * у КОРНЯ дерева разговоров, а не у конкретного узла
 * (dock/06-разбор-мессенджеров.md). Это стережёт CHECK в миграции.
 */
export const conversationMember = pgTable(
  "conversation_member",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.participantId] }),
    // Ключ арендатора первым — иначе индекс не сработает под RLS (Р-7).
    index("conversation_member_workspace_participant_idx").on(t.workspaceId, t.participantId),
  ],
);

/**
 * Сообщение.
 *
 * `body` — исходная строка с разметкой, рисует клиент (Р-002). Ни HTML,
 * ни структурного документа: цитаты агента указывают на позиции внутри
 * этой строки, и они обязаны быть вечными.
 */
export const message = pgTable(
  "message",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    authorParticipantId: uuid("author_participant_id")
      .notNull()
      .references(() => participant.id),
    body: text("body").notNull(),
    /**
     * Что это за сообщение. Без этого поля саммари агента вернётся ему же
     * на вход следующим прогоном и получится петля.
     */
    kind: text("kind").notNull().default("human"),
    /**
     * Доверие к содержимому. Всё, что агент читает, — недоверенный ввод:
     * в теле может лежать текст, адресованный не людям, а ему.
     */
    trust: text("trust").notNull().default("trusted"),
    /**
     * Доменный ключ идемпотентности: генерирует КЛИЕНТ в момент набора.
     * Переживает то, чего не переживает Idempotency-Key заголовка —
     * перезапуск клиента и отправку с двух устройств (приём Slack).
     */
    clientMsgId: uuid("client_msg_id").notNull(),
    /** Порядок для клиента. Берётся из счётчика пространства, не из последовательности. */
    seq: bigint("seq", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  (t) => [
    unique("message_conversation_client_msg_uq").on(t.conversationId, t.clientMsgId),
    unique("message_workspace_seq_uq").on(t.workspaceId, t.seq),
    index("message_conversation_seq_idx").on(t.conversationId, t.seq),
  ],
);
