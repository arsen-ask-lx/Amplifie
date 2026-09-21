import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  customType,
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
 * Проект — папка чатов и область чтения агента (Р-032). Не вид разговора:
 * ленты у проекта нет. Ни состава, ни видимости: проект отвечает «про что»,
 * а «кому можно» — разговор (Р-010), иначе у прав было бы два ответа.
 */
export const project = pgTable(
  "project",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /**
     * Вид папки в панели: имена значка и цвета из `packages/contract`,
     * пусто — по умолчанию. Имена, а не значения: цвет — роль в теме.
     */
    icon: text("icon"),
    color: text("color"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Удаление мягкое — по той же причине, что у канала и реплики. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("project_workspace_idx").on(t.workspaceId)],
);

/**
 * Разговор — одна сущность на все виды: канал, ветка, встреча, обсуждение
 * документа, личка (Р-4). Одна, потому что «как агент слушает» — одно знание.
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
     * Кому виден (Р-010): `workspace` — всему пространству, `private` — тем,
     * у кого есть строка членства. Свойство канала, а не список участников,
     * как у Slack и Discord. У ветки не читается — она наследует корень.
     */
    visibility: text("visibility").notNull().default("workspace"),
    /**
     * Ветка — разговор с родителем, а не строка в сообщении: у Zulip тема
     * строкой, и переименование переписывает все сообщения (их issue #1191).
     */
    parentId: uuid("parent_id").references((): AnyPgColumn => conversation.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    /**
     * Проект; `null` — вне проектов, это законно (Р-032). Принадлежность
     * одна: на ней стоит область чтения агента (порог — в миграции 0020).
     * Удаление проекта снимает ярлык, а не уносит переписку.
     */
    projectId: uuid("project_id").references(() => project.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Удаление мягкое: на реплики канала ссылаются цитаты из других каналов. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("conversation_workspace_parent_idx").on(t.workspaceId, t.parentId),
    index("conversation_workspace_alive_idx").on(t.workspaceId).where(sql`${t.deletedAt} is null`),
    // Чатов вне проектов много и будет много: частичный индекс.
    index("conversation_project_idx").on(t.projectId).where(sql`${t.projectId} is not null`),
  ],
);

/**
 * Что человек закрепил в своей панели. Личное (Д-32), поэтому таблица,
 * а не колонка у разговора. Две настоящие ссылки вместо «тип и номер» —
 * ради внешних ключей; `CHECK` в миграции требует ровно одну.
 * Не путать с закреплённой репликой (`message.pinnedAt`) — та общая.
 */
export const pin = pgTable(
  "pin",
  {
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    /** Закреплённый разговор. `null` — закреплён проект. */
    conversationId: uuid("conversation_id").references(() => conversation.id, {
      onDelete: "cascade",
    }),
    /** Закреплённый проект. `null` — закреплён разговор. */
    projectId: uuid("project_id").references(() => project.id, { onDelete: "cascade" }),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pin_participant_idx").on(t.participantId)],
);

/**
 * Пара «разговор и участник» — ключ членства и прочтения. Одно объявление:
 * разойдись каскады, отметки прочтения пережили бы удалённый канал.
 */
const conversationParticipantPair = () => ({
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversation.id, { onDelete: "cascade" }),
  participantId: uuid("participant_id")
    .notNull()
    .references(() => participant.id, { onDelete: "cascade" }),
});

/**
 * Кто в разговоре — только у корня: у ветки своих участников нет, право
 * читается у корня (dock/reference/messaging-research.md). Стережёт CHECK в миграции.
 */
export const conversationMember = pgTable(
  "conversation_member",
  {
    ...conversationParticipantPair(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.participantId] }),
    // Ключ арендатора первым (Р-7).
    index("conversation_member_workspace_participant_idx").on(t.workspaceId, t.participantId),
  ],
);

/**
 * Докуда человек дочитал разговор (Р-029). Таблица, а не колонка
 * у членства: открытый канал читают и те, кто в нём не состоит, а членство —
 * про права, не про взгляд. Строка появляется при первой отметке;
 * её отсутствие — то же, что ноль.
 */
export const conversationRead = pgTable(
  "conversation_read",
  {
    ...conversationParticipantPair(),
    /** Ноль значит «не читал ничего»: номера реплик начинаются с единицы. */
    readSeq: bigint("read_seq", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.participantId] })],
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
    /**
     * Номер последнего изменения из того же счётчика пространства. `seq` —
     * место в ленте, `updated_seq` — попадание в догон; одним числом оба
     * не обслужить. Двигается при правке, удалении и закреплении; у новой = `seq`.
     */
    updatedSeq: bigint("updated_seq", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    /**
     * На какую реплику ответ. `SET NULL`: каскад унёс бы чужой ответ,
     * запрет не дал бы удалить однажды процитированное.
     */
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => message.id, {
      onDelete: "set null",
    }),
    /** Откуда переслано. Та же логика ссылки, что у ответа. */
    forwardedFromId: uuid("forwarded_from_id").references((): AnyPgColumn => message.id, {
      onDelete: "set null",
    }),
    /** Время, а не «да/нет»: полоска сверху показывает последнее закреплённое. */
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    /**
     * Удаление мягкое: о жёстком нечем рассказать другим клиентам, а так
     * `updated_seq` двигается, и догон отдаёт надгробие без текста.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("message_conversation_client_msg_uq").on(t.conversationId, t.clientMsgId),
    unique("message_workspace_seq_uq").on(t.workspaceId, t.seq),
    index("message_conversation_seq_idx").on(t.conversationId, t.seq),
    // Догон отбирает по пространству и номеру изменения. Ключ арендатора
    // первым полем (Р-7) — тем же порядком, что и в остальных индексах.
    index("message_workspace_updated_seq_idx").on(t.workspaceId, t.updatedSeq),
    // Закреплённых в разговоре единицы, а ищутся они на каждом открытии.
    index("message_conversation_pinned_idx")
      .on(t.conversationId, t.pinnedAt)
      .where(sql`${t.pinnedAt} is not null`),
  ],
);

/**
 * Кого позвали в сообщении (Р-031). Не вторая разметка: упоминание живёт
 * в теле (Р-020), здесь только «этого позвали здесь» — чтобы счётчик
 * не искал подстроку по всей переписке.
 */
export const messageMention = pgTable(
  "message_mention",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.participantId] }),
    // Счёт идёт всегда от человека: «сколько раз позвали МЕНЯ».
    index("message_mention_participant_idx").on(t.participantId, t.messageId),
  ],
);

/** Вектор полнотекстового поиска Postgres: у drizzle своего типа нет. */
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/**
 * Поиск по сообщениям (task-100) — таблица-ПРОИЗВОДНАЯ от `message`.
 *
 * ⚠️ ПИШЕТ ЕЁ ТОЛЬКО ТРИГГЕР В БАЗЕ, а не код (миграция 0027). Так ни один
 * путь записи — служба, засев гейта, выкладка, будущий импорт — не оставит
 * реплику ненайденной. Испортилась — сносится и собирается заново той же
 * выборкой, что в миграции: переписка при этом цела.
 *
 * Копии полей реплики законны: пространство, разговор и номер у реплики
 * не меняются никогда. Прав здесь нет — они проверяются в момент поиска.
 */
export const messageSearch = pgTable(
  "message_search",
  {
    messageId: uuid("message_id")
      .primaryKey()
      .references(() => message.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    doc: tsvector("doc").notNull(),
  },
  (t) => [
    index("message_search_doc_idx").using("gin", t.doc),
    // Обход «новые сверху» для частого слова (замер шага 0).
    index("message_search_workspace_seq_idx").on(t.workspaceId, t.seq),
  ],
);
