import { sql } from "drizzle-orm";
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Журнал. Только вставка, никогда не обновляется и не удаляется.
 *
 * Правило Р-2: изменение состояния и событие пишутся в ОДНОЙ транзакции,
 * единственным путём записи. Если есть хоть один путь в обход — журналу
 * нельзя доверять никогда, и чинится это аудитом всех путей записи разом.
 *
 * Очередь (outbox) появится вместе с дренажем на срезе агента. Смешивать
 * вечный журнал и очередь в одной таблице через UPDATE нельзя: это мёртвые
 * версии строк на самой горячей таблице (dock/decisions.md#foundation, пункт 3).
 */
export const event = pgTable(
  "event",
  {
    // Внутренний порядок журнала. Наружу НЕ отдаётся: номер выдаётся при
    // вставке, а видимым событие становится при фиксации — это разный
    // порядок, и клиентский курсор по нему теряет события (§2②).
    seq: bigserial("seq", { mode: "bigint" }).primaryKey(),
    id: uuid("id").notNull().default(sql`uuidv7()`),
    // Пусто у событий вне пространства — например, у самой регистрации.
    workspaceId: uuid("workspace_id"),
    kind: text("kind").notNull(),
    // Закон Хайрама: форма события станет чужой зависимостью, как только
    // на неё подпишется первая интеграция. Версия — с первого дня.
    schemaVersion: integer("schema_version").notNull().default(1),
    actorParticipantId: uuid("actor_participant_id"),
    // Чьей властью действовали (влияет на права).
    originatorAccountId: uuid("originator_account_id"),
    // Кто отвечает за результат (влияет на аудит). Это РАЗНЫЕ люди (Р-3).
    accountableAccountId: uuid("accountable_account_id"),
    attribution: text("attribution").notNull().default("direct_human"),
    subjectType: text("subject_type"),
    subjectId: uuid("subject_id"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("event_workspace_seq_idx").on(t.workspaceId, t.seq)],
);
