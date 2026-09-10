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
 * Проект — папка чатов и область чтения агента (Р-032).
 *
 * ⚠️ НЕ ВИД РАЗГОВОРА, ХОТЯ СОБЛАЗН БЫЛ. У разговора всегда есть лента;
 * у проекта её нет и быть не должно. Слив их, мы завели бы место,
 * куда нельзя писать, и объясняли бы это человеку словами.
 *
 * ⚠️ НИ СОСТАВА УЧАСТНИКОВ, НИ ВИДИМОСТИ. Проект отвечает на вопрос
 * «про что это», а не «кому можно»: права остаются у разговора (Р-010).
 * У Rocket.Chat команда носит свой состав поверх состава каналов —
 * и на вопрос «почему он это видит» там два ответа вместо одного.
 */
export const project = pgTable(
  "project",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Удаление мягкое — по той же причине, что у канала и реплики. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("project_workspace_idx").on(t.workspaceId)],
);

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
    /**
     * К какому проекту относится. `null` — вне проектов, и это законно:
     * «Общий», курилка и личка не про проект (Р-032).
     *
     * ⚠️ ОДНА ПРИНАДЛЕЖНОСТЬ, И НА НЕЙ СТОИТ ОБЛАСТЬ ЧТЕНИЯ АГЕНТА.
     * Разреши мы вторую — вопрос «в каком проекте он на самом деле»
     * останется без ответа, а вместе с ним и вопрос «что агенту читать».
     * Порог, при котором это меняется, назван в миграции 0020.
     *
     * `ON DELETE SET NULL`: удаление проекта снимает ярлык, а не уносит
     * переписку.
     */
    projectId: uuid("project_id").references(() => project.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Когда удалён. ⚠️ МЯГКО, ПО ТОЙ ЖЕ ПРИЧИНЕ, ЧТО И У РЕПЛИКИ:
     * на сообщения этого канала ссылаются ответы и пересылки из ДРУГИХ
     * каналов, и каскад превратил бы их в цитаты в пустоту.
     */
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
 * Пара «разговор и участник» — ключ сразу у двух таблиц: у членства
 * и у прочтения.
 *
 * ⚠️ ОДНО ОБЪЯВЛЕНИЕ, А НЕ ДВЕ КОПИИ. Колонки те же и связи те же,
 * а смысл у таблиц разный (права против взгляда) — но повтор от этого
 * повтором быть не перестаёт: разойдись у них правило каскадного
 * удаления, и осиротевшие отметки прочтения пережили бы удалённый канал.
 * Гейт повторов поймал это сразу, как только вторая таблица появилась.
 */
const параРазговораИЧеловека = () => ({
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversation.id, { onDelete: "cascade" }),
  participantId: uuid("participant_id")
    .notNull()
    .references(() => participant.id, { onDelete: "cascade" }),
});

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
    ...параРазговораИЧеловека(),
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
 * Докуда человек дочитал разговор (Р-029).
 *
 * ⚠️ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ КОЛОНКА У УЧАСТНИКА, И ЭТО ИСПРАВЛЕНИЕ
 * ПОСЛЕ ОТКАЗА. Сперва номер лежал колонкой в `conversation_member` —
 * ключ там ровно «разговор и участник», и это выглядело единственно
 * верным местом. Оно молча предполагало, что у читателя ВСЕГДА есть
 * строка участника. Её нет: канал открыт всему пространству, и человек
 * читает его, не будучи участником. У всех, кто вошёл позже заведения
 * канала, отметка не находила строки и глохла 404-й — число
 * непрочитанного не гасло никогда. Поймал владелец.
 *
 * ⚠️ ЧЛЕНСТВО И ПРОЧТЕНИЕ — РАЗНЫЕ ЗНАНИЯ. Первое про ПРАВА, второе
 * про ВЗГЛЯД. Дописывать строку участника при первом чтении было бы
 * дёшево и неверно: в списке участников канала оказались бы все,
 * кто туда заглянул.
 *
 * ⚠️ СТРОКА ПОЯВЛЯЕТСЯ ПРИ ПЕРВОЙ ОТМЕТКЕ, А НЕ ПРИ ВХОДЕ. Отсутствие
 * строки означает «не читал ничего» — то же, что ноль. Заводить её
 * заранее на каждую пару «человек и разговор» значило бы хранить
 * произведение двух списков ради нулей.
 */
export const conversationRead = pgTable(
  "conversation_read",
  {
    ...параРазговораИЧеловека(),
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
     * Когда реплика в последний раз менялась — номером из ТОГО ЖЕ счётчика
     * пространства.
     *
     * ⚠️ ЭТО ВТОРОЙ НОМЕР, А НЕ ДУБЛЬ ПЕРВОГО. `seq` отвечает на вопрос
     * «когда сказано» и определяет место в разговоре; `updated_seq` —
     * на вопрос «когда менялось» и определяет попадание в догон. Одним
     * числом обслужить оба нельзя: правка старой реплики либо не доедет
     * до чужой вкладки, либо уедет в конец ленты.
     *
     * Двигается при правке, удалении, закреплении и откреплении.
     * У новой реплики равен `seq`.
     */
    updatedSeq: bigint("updated_seq", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    /**
     * На какую реплику это ответ (task-014).
     *
     * ⚠️ `ON DELETE SET NULL`, а не каскад и не запрет. Удалённая цитата
     * обязана превращаться в ЕЁ ОТСУТСТВИЕ: каскад унёс бы вместе с ней
     * и сам ответ — то есть чужие слова, — а запрет сделал бы удаление
     * невозможным, стоило кому-то один раз процитировать.
     */
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => message.id, {
      onDelete: "set null",
    }),
    /** Откуда переслано. Та же логика ссылки, что у ответа. */
    forwardedFromId: uuid("forwarded_from_id").references((): AnyPgColumn => message.id, {
      onDelete: "set null",
    }),
    /**
     * Когда закреплено. Отметка времени, а не «да/нет»: закреплённых
     * бывает несколько, и полоска сверху показывает последнее из них.
     * Отдельной таблицы под это нет — закрепление свойство сообщения,
     * а не связь между сущностями.
     */
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    /**
     * Когда удалено. ⚠️ УДАЛЕНИЕ МЯГКОЕ, И ЭТО НЕ ОСТОРОЖНОСТЬ.
     * Жёсткое оборвало бы цитаты и пересылки на эту реплику; но главное —
     * о жёстком удалении нечем рассказать другим клиентам. Мягкое —
     * можно: строка остаётся, `updated_seq` двигается, и догон отдаёт
     * НАДГРОБИЕ — идентификатор с признаком удаления и без текста.
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
 * Кого позвали в сообщении (Р-031).
 *
 * ⚠️ ЭТО НЕ ВТОРАЯ РАЗМЕТКА. Само упоминание живёт в теле сообщения,
 * как жирный и ссылка (Р-020); здесь нет ни смещений, ни текста —
 * только «этого позвали здесь». Заведи мы тут смещения, они разошлись
 * бы с телом на первой же правке, и разошлись бы молча.
 *
 * ⚠️ БЕЗ ЭТОЙ ТАБЛИЦЫ СЧЁТЧИК СЧИТАЛСЯ БЫ ПОИСКОМ ПОДСТРОКИ по всей
 * переписке — и считался бы на каждом открытии списка каналов. Ровно
 * та цена, из-за которой Телеграм держит `unread_mentions_count`
 * отдельным числом, а не выводит его из текста.
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
