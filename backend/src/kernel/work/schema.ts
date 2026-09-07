import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { participant } from "../identity/schema.js";
import { workspace } from "../space/schema.js";
import { conversation, message } from "../talk/schema.js";

/**
 * Ядро продукта: договорённость, задача, цитата (04-каркас §4).
 *
 * Почему `agreement`, а не `decision` с эффектами и сроками: движок
 * процессов в ядре — яма. Но если предложение агента сразу становится
 * задачей, то договорённости, из которых работы НЕ следует, записать
 * некуда: «решили не делать мобильную версию» тоже надо помнить.
 */

/**
 * Договорённость: то, о чём условились, своими словами.
 *
 * Человек подтверждает ТЕКСТ, который прочитал, — не машинный эффект под
 * ним. Отсюда и обратимость: передумал — сменил статус, никакой машинерии
 * отмены не нужно.
 */
export const agreement = pgTable(
  "agreement",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    /** Кто предложил — участник вида «агент», а позже и человек. */
    proposedBy: uuid("proposed_by")
      .notNull()
      .references(() => participant.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    status: text("status").notNull().default("proposed"),
    /** Только человек. Пусто, пока не подтверждена. */
    confirmedBy: uuid("confirmed_by").references(() => participant.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    /**
     * Отпечаток исходных реплик. По нему повторный разбор узнаёт,
     * что это та же самая договорённость, и не плодит вторую.
     */
    sourceFingerprint: text("source_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("agreement_workspace_idx").on(table.workspaceId, table.createdAt),
    unique("agreement_conversation_fingerprint_uq").on(
      table.conversationId,
      table.sourceFingerprint,
    ),
  ],
);

/**
 * Задача: работа, следующая из подтверждённой договорённости.
 *
 * Договорённость может не дать ни одной задачи — и это нормальное
 * состояние, а не недоделка.
 */
export const task = pgTable(
  "task",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    /**
     * Откуда взялась. Пусто — задачу завели руками (task-010).
     *
     * До task-010 источник был обязателен: задача рождалась только
     * из подтверждённой договорённости. Ограничение первого среза снято,
     * но связь осталась — задача из чата по-прежнему указывает на неё.
     */
    agreementId: uuid("agreement_id").references(() => agreement.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    /**
     * Колонка доски. Список закрыт проверкой в базе, см. миграцию.
     *
     * Имя столбца осталось `status`, хотя по смыслу это стадия.
     * Переименование потребовало бы у генератора миграций ответа
     * «это переименование или новый столбец», а он спрашивает только
     * в терминале — которого в нашей сборке нет. Выигрыш в ясности
     * меньше, чем цена сломанного инструмента миграций (task-010).
     */
    status: text("status").notNull().default("к работе"),
    /**
     * Кто отвечает за результат. ТОЛЬКО ЧЕЛОВЕК, и это держит база.
     *
     * Рядом лежит `responsibleKind` — сгенерированная константа «human»,
     * и составной внешний ключ на `participant (id, kind)`. Записать сюда
     * агента невозможно физически: пары (id_агента, 'human') в участниках
     * не существует. Правило владельца «за результат отвечает человек»
     * перестаёт быть договорённостью на словах.
     */
    responsibleId: uuid("responsible_id").references(() => participant.id, {
      onDelete: "restrict",
    }),
    /** Кому. Пусто, пока не назначена. */
    assignedTo: uuid("assigned_to").references(() => participant.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("task_workspace_idx").on(table.workspaceId, table.createdAt),
    // Одна договорённость — одна задача в первом срезе. Когда понадобится
    // несколько, ограничение снимается миграцией; обратный порядок дороже.
    unique("task_agreement_uq").on(table.agreementId),
  ],
);

/**
 * Цитата: на чём основано утверждение агента.
 *
 * НАСТОЯЩАЯ ссылка на сообщение, а не слепок текста. Слепок не даёт
 * ответить на обратный вопрос «какие предложения опирались на сообщение
 * X», и база не проверит, что источник существует.
 *
 * Это фундамент главной метрики продукта — «доля выдуманного». Без цитат
 * её не на чем считать, и «агент не выдумывает» остаётся обещанием.
 */
export const citation = pgTable(
  "citation",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => agreement.id, { onDelete: "cascade" }),
    /** Источник. Удалили сообщение — цитата уходит вместе с ним. */
    messageId: uuid("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    /**
     * Что именно процитировано. Хранится текстом, потому что сообщение
     * могут отредактировать: тогда видно, что цитата разошлась
     * с источником, и это само по себе сведение.
     */
    quote: text("quote").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("citation_agreement_idx").on(table.agreementId),
    // Обратный вопрос: на какие сообщения опирались. Ради него и индекс.
    index("citation_message_idx").on(table.messageId),
  ],
);
