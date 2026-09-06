import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { workspace } from "../space/schema.js";

/**
 * Аккаунт — ГЛОБАЛЬНЫЙ вход, не привязан к пространству.
 *
 * Почему не «пользователь внутри пространства»: подрядчик, работающий с двумя
 * компаниями, — это один вход и ДВА лица. Если привязать вход к пространству,
 * гости (функция 88) становятся невозможны, а чинится это только миграцией
 * всех данных. Разбор — dock/04-каркас.md, слой I.
 */
export const account = pgTable("account", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  // Хранится уже приведённой к нижнему регистру — нормализация на границе,
  // а не citext: расширение ради одного поля не берём.
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Участник — лицо в ОДНОМ пространстве. Человек ИЛИ агент, одна сущность (Р-1).
 *
 * Поля для отрисовки (display_name, kind) лежат здесь, а не в спутнике:
 * лента сообщений рисуется без единого соединения. Редкое (бюджет агента,
 * среда запуска) уедет в participant_agent, когда появится агент.
 */
export const participant = pgTable(
  "participant",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // У агента аккаунта нет — он не входит по паролю.
    accountId: uuid("account_id").references(() => account.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Один вход = одно лицо в пространстве.
    unique("participant_workspace_account_uq").on(t.workspaceId, t.accountId),
    // Ключ арендатора ПЕРВЫМ полем — иначе индекс не сработает под RLS (Р-7).
    index("participant_workspace_kind_idx").on(t.workspaceId, t.kind),
  ],
);

/**
 * Сессия. В базе лежит ХЕШ токена, а не токен: утечка дампа не даёт войти.
 * Отзыв — обычный DELETE, поэтому никаких JWT с их вечной проблемой отзыва.
 */
export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (t) => [index("session_account_idx").on(t.accountId)],
);
